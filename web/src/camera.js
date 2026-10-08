// Вкладка «Камера»: AR по умолчанию, заморозка кадра и фото как запасной путь. Любой снимок хранит
// гомографию «мм платы → снимок», поэтому метки на нём всегда считаются из текущего плана.
// Любая ошибка ведёт в фото-режим, тупиков нет (docs/design-doc.md, раздел 5).
import { ARSession, CameraAccessError, isARSupported, isInAppBrowser, loadEngine, loadTarget } from "./ar.js";
import { applyHomography, boardCorners, checkQuad, homographyFromPoints } from "./homography.js";
import { rectCorners } from "./layout.js";
import { boardMarkers, currentStep } from "./markers.js";
import { downscale, loadOrientedImage, recognizeBoard } from "./photo-recognition.js";
import { BoardPhotoView } from "./photo-view.js";

const TIPS_AFTER_MS = 10_000;
const PHOTO_OFFER_AFTER_MS = 25_000;
const DISPLAY_MAX_SIDE = 2048;

const HINTS = {
  searching: "Наведите камеру так, чтобы плата целиком попала в кадр",
  limited: "Плата потеряна — наведите камеру снова",
};

const CAMERA_DENIED = "Нет доступа к камере. Разрешите его в настройках сайта: значок слева от адреса → «Камера» → «Разрешить» "
  + "(iPhone: «Настройки» → Safari → «Камера»), затем нажмите «Повторить». Или отметьте плату на фото.";

// Углы платы по часовой стрелке от верхнего левого (у задней панели I/O, со стороны процессора).
const CORNER_HINTS = [
  "у задней панели, со стороны процессора",
  "напротив задней панели, со стороны процессора",
  "напротив задней панели, со стороны слотов PCIe",
  "у задней панели, со стороны слотов PCIe",
];

const CORNER_PROBLEMS = {
  crossed: "Похоже, углы перепутаны — проверьте порядок",
  mirrored: "Похоже, углы перепутаны — проверьте порядок",
  concave: "Углы стоят неровно — перетащите их на края платы",
};

/** Мини-схема платы для подсказки «какой угол ставить»: задняя панель слева, процессор сверху. */
function cornerSchema(active) {
  const corners = [[8, 8], [92, 8], [92, 92], [8, 92]];
  return '<rect class="board" x="8" y="8" width="84" height="84" rx="3"/>'
    + '<rect class="part" x="12" y="14" width="10" height="34"/>'
    + '<rect class="part" x="42" y="18" width="22" height="22"/>'
    + '<rect class="part" x="16" y="62" width="62" height="5"/><rect class="part" x="16" y="76" width="62" height="5"/>'
    + corners.map(([x, y], i) => {
      const cls = i < active ? " done" : i === active ? " active" : "";
      return `<circle class="corner${cls}" cx="${x}" cy="${y}" r="7"/>`;
    }).join("");
}

/**
 * Снимок по EXIF, уменьшенный до DISPLAY_MAX_SIDE. Полноразмерный bitmap (48 Мп ≈ 190 МБ) освобождается сразу:
 * и показ, и распознавание идут по этой копии.
 */
async function decodePhoto(file) {
  const image = await loadOrientedImage(file);
  try {
    return downscale(image, DISPLAY_MAX_SIDE);
  } finally {
    image.close?.();
  }
}

async function canvasUrl(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("canvas.toBlob вернул пустой результат");
  return URL.createObjectURL(blob);
}

// Safari ограничивает суммарную память холстов и держит её до сборки мусора; нулевой размер отдаёт её сразу.
function releaseCanvas(canvas) {
  if (canvas) canvas.width = canvas.height = 0;
}

export class CameraTab {
  /**
   * @param {object} o
   * @param {(step: object) => void} o.openStep — открыть экран инструкции
   * @param {(text: string) => void} o.toast
   */
  constructor({ openStep, toast }) {
    this.openStep = openStep;
    this.toast = toast;
    this.$ = (id) => document.getElementById(id);
    this.mode = "idle"; // idle | loading | ar | frozen | photo
    this.active = false;
    this.token = 0;
    this.photoToken = 0;

    this.photoView = new BoardPhotoView(this.$("photo-view"), {
      onSelect: (marker) => this.openStep(marker.step),
      onPlace: (point) => this.placeCorner(point),
      onCornerMove: (index, point) => this.moveCorner(index, point),
    });

    this.$("freeze").addEventListener("click", () => this.freeze());
    this.$("to-photo").addEventListener("click", () => this.enterPhoto());
    this.$("back-to-ar").addEventListener("click", () => this.backToAR());
    this.$("take-photo").addEventListener("click", () => this.$("file-capture").click());
    this.$("pick-photo").addEventListener("click", () => this.$("file-gallery").click());
    this.$("torch").addEventListener("click", async () => {
      await this.ar?.toggleTorch();
      this.render();
    });
    this.$("fix-corners").addEventListener("click", () => {
      if (this.photo) this.photo.editing = true;
      this.render();
    });
    this.$("corners-done").addEventListener("click", () => {
      if (this.photo?.homography) this.photo.editing = false;
      this.render();
    });
    this.$("corners-restart").addEventListener("click", () => {
      if (!this.photo) return;
      this.photo.corners = [];
      this.updateCorners();
    });
    for (const id of ["file-capture", "file-gallery"]) {
      this.$(id).addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) this.loadPhoto(file);
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.ar?.pause();
      else if (this.active && this.mode === "ar") this.ar?.resume();
    });
  }

  setBoard(board, session, targetUrl) {
    this.reset();
    this.board = board;
    this.session = session;
    this.targetUrl = targetUrl;
    this.unsubscribe?.();
    this.unsubscribe = session.subscribe(() => this.refresh());
    if (this.active) this.show();
  }

  show() {
    this.active = true;
    if (this.mode === "idle") this.startAR();
    else if (this.mode === "ar") this.ar?.resume();
    this.render();
  }

  hide() {
    this.active = false;
    this.ar?.pause();
    this.clearSearchTimers();
  }

  reset() {
    this.token++;
    this.photoToken++;
    this.ar?.stop();
    this.ar = null;
    this.clearSearchTimers();
    this.dropFrozen();
    this.dropPhoto();
    this.notice = null;
    this.mode = "idle";
  }

  dropFrozen() {
    if (this.frozen) URL.revokeObjectURL(this.frozen.url);
    this.frozen = null;
  }

  dropPhoto() {
    if (this.photo) URL.revokeObjectURL(this.photo.url);
    this.photo = null;
  }

  /** Метки на плате для текущего плана (locked отброшены, одинаковые прямоугольники склеены). */
  entries() {
    return boardMarkers(this.board, this.session.plan, this.session.done);
  }

  // ——— AR ———

  async startAR() {
    const token = ++this.token;
    this.notice = null;
    if (!this.board.target || !this.targetUrl) {
      return this.enterPhoto({ text: "AR для этой платы пока недоступен: нет эталонного фото. Сделайте снимок и отметьте 4 угла платы." });
    }
    if (isInAppBrowser()) {
      return this.enterPhoto({ text: "Встроенный браузер приложения может не поддерживать камеру и AR. Откройте страницу в Safari или Chrome.", retry: "Всё равно попробовать AR" });
    }
    if (!isARSupported()) {
      return this.enterPhoto({ text: "Этот браузер не поддерживает AR: нужны доступ к камере (HTTPS) и WebGL. Можно найти плату на фото." });
    }

    this.mode = "loading";
    this.setLoading("Загрузка распознавания…", null);
    this.render();

    let targetSrc;
    try {
      const [, target] = await Promise.all([
        loadEngine(),
        loadTarget(this.targetUrl, (p) => this.setLoading("Загрузка эталона платы…", p)),
      ]);
      targetSrc = URL.createObjectURL(new Blob([target]));
    } catch (e) {
      console.error(e);
      if (token === this.token && this.mode === "loading") {
        this.enterPhoto({ text: "Не удалось загрузить данные распознавания платы.", retry: "Повторить" });
      }
      return;
    }
    if (token !== this.token) return URL.revokeObjectURL(targetSrc);

    this.setLoading("Запуск камеры…", null);
    const ar = new ARSession({
      container: this.$("ar-view"),
      labelsLayer: this.$("ar-labels"),
      targetSrc,
      physical: this.board.physical,
      onState: (state) => this.onTrackingState(state),
      onSelect: (entry) => this.openStep(entry.step),
      onTorchChange: () => this.render(),
    });
    ar.setEntries(this.entries());
    try {
      await ar.start();
    } catch (e) {
      console.error(e);
      ar.stop();
      URL.revokeObjectURL(targetSrc);
      if (token !== this.token || this.mode !== "loading") return;
      const text = e instanceof CameraAccessError
        ? (e.message === "Нет доступа к камере" ? CAMERA_DENIED : `${e.message}. Можно найти плату на фото.`)
        : "Не удалось запустить распознавание.";
      return this.enterPhoto({ text, retry: "Повторить" });
    }
    if (token !== this.token) return ar.stop();

    this.ar = ar;
    // Пока AR запускался, пользователь мог уйти в фото — тогда AR ждёт на паузе до «Вернуться в AR».
    if (this.mode === "loading") this.mode = "ar";
    if (!this.active || this.mode !== "ar") ar.pause();
    this.render();
  }

  onTrackingState(state) {
    this.trackingState = state;
    if (state === "tracking") this.clearSearchTimers();
    else this.startSearchTimers();
    this.render();
  }

  startSearchTimers() {
    if (this.searchTimers) return;
    this.searchLevel = 0;
    this.searchTimers = [
      setTimeout(() => { this.searchLevel = 1; this.render(); }, TIPS_AFTER_MS),
      setTimeout(() => { this.searchLevel = 2; this.render(); }, PHOTO_OFFER_AFTER_MS),
    ];
  }

  clearSearchTimers() {
    this.searchTimers?.forEach(clearTimeout);
    this.searchTimers = null;
    this.searchLevel = 0;
  }

  async freeze() {
    const { ar } = this;
    if (!ar?.isTracking) return;
    const token = this.photoToken;
    // Пока кадр сохраняется, могли уйти в фото или сменить плату — тогда кадр не нужен.
    const current = () => this.ar === ar && this.mode === "ar" && token === this.photoToken;
    let frozen;
    let shown = false;
    try {
      frozen = await ar.freeze();
      shown = current() && await this.photoView.setImage(frozen.url, current);
    } catch (e) {
      console.error(e);
      if (frozen) URL.revokeObjectURL(frozen.url);
      if (current()) this.toast("Не удалось сохранить кадр");
      return;
    }
    if (!shown || !current()) return URL.revokeObjectURL(frozen.url);
    this.dropFrozen();
    this.frozen = frozen;
    ar.pause();
    this.clearSearchTimers();
    this.mode = "frozen";
    this.render();
  }

  backToAR() {
    this.photoToken++;
    this.dropFrozen();
    if (this.ar) {
      this.mode = "ar";
      this.ar.resume();
      this.render();
    } else {
      this.startAR();
    }
  }

  // ——— Фото ———

  /** notice — причина, по которой AR недоступен; retry — подпись кнопки повторного запуска AR. */
  enterPhoto(notice = null) {
    const token = ++this.photoToken;
    this.ar?.pause();
    this.clearSearchTimers();
    this.notice = notice;
    this.mode = "photo";
    this.dropFrozen();
    const photo = this.photo;
    const current = () => token === this.photoToken && this.mode === "photo" && this.photo === photo;
    if (photo) this.photoView.setImage(photo.url, current).then((shown) => {
      if (shown && current()) this.render();
    }).catch((e) => {
      console.error(e);
      if (current()) this.toast("Не удалось открыть фото");
    });
    this.render();
  }

  /** Фото → поворот по EXIF → показ → распознавание; не нашли — ручная разметка по 4 углам. */
  async loadPhoto(file) {
    if (this.mode !== "photo") this.enterPhoto();
    else this.photoToken++;
    const token = this.photoToken;
    // Пока снимок готовится, могли выбрать другой, вернуться в AR или сменить плату — тогда он не нужен.
    const current = () => token === this.photoToken && this.mode === "photo";
    let display;
    try {
      let url;
      try {
        display = await decodePhoto(file);
        url = await canvasUrl(display);
        if (!current() || !(await this.photoView.setImage(url, current)) || !current()) {
          URL.revokeObjectURL(url);
          return;
        }
      } catch (e) {
        console.error(e);
        if (url) URL.revokeObjectURL(url);
        if (current()) this.toast("Не удалось открыть фото");
        return;
      }
      this.dropPhoto();
      const photo = { url, size: [display.width, display.height], status: "recognizing", corners: [], editing: false, homography: null, problem: null, missed: false };
      this.photo = photo;
      this.render();

      const result = await this.recognize(display);
      // Результат принадлежит снимку: если из фото-режима ушли, он дождётся возвращения, но без тоста.
      if (this.photo !== photo) return;
      if (result) {
        const corners = boardCorners(this.board.physical).map((p) => applyHomography(result.homography, p));
        Object.assign(photo, { status: "found", homography: result.homography, corners });
      } else {
        Object.assign(photo, { status: "manual", editing: true, missed: Boolean(this.board.target) });
        if (this.board.target && this.active && this.mode === "photo") this.toast("Плату на фото не нашли — отметьте 4 угла");
      }
      this.render();
    } finally {
      releaseCanvas(display);
    }
  }

  async recognize(image) {
    const { board, targetUrl } = this;
    if (!board.target || !targetUrl) return null;
    try {
      return await recognizeBoard(image, await loadTarget(targetUrl), board.physical);
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  placeCorner(point) {
    const { photo } = this;
    if (this.mode !== "photo" || !photo?.editing || photo.corners.length >= 4) return;
    photo.corners.push(point);
    this.updateCorners();
  }

  moveCorner(index, point) {
    if (!this.photo?.editing) return;
    this.photo.corners[index] = point;
    // pointermove приходит чаще кадров, а при перетаскивании меняются только углы, метки и подсказка:
    // пересчёт раз в кадр и без полного render().
    this.cornerFrame ??= requestAnimationFrame(() => {
      this.cornerFrame = null;
      if (this.mode !== "photo" || !this.photo?.editing) return;
      this.fitCorners();
      this.renderPhotoLayers();
      this.renderPlaceBar();
    });
  }

  updateCorners() {
    this.fitCorners();
    this.render();
  }

  // Четыре угла → гомография. Ручные углы проверяются только на порядок и форму: мелкая или вытянутая
  // плата на фото допустима, а «бантик» почти всегда значит, что перепутаны соседние углы.
  fitCorners() {
    const { photo } = this;
    photo.homography = null;
    photo.problem = null;
    if (photo.corners.length === 4) {
      const [w, h] = photo.size;
      const px = photo.corners.map(([u, v]) => [u * w, v * h]);
      const check = checkQuad(px, [w, h], this.board.physical, { minArea: 0, maxAspectError: Infinity });
      if (check.ok) photo.homography = homographyFromPoints(boardCorners(this.board.physical), photo.corners);
      else photo.problem = CORNER_PROBLEMS[check.reason];
    }
  }

  /**
   * Метки текущего плана на снимке: прямоугольники разъёмов через гомографию снимка. Разъёма с центром
   * за краем снимка на фото нет — его метка не показывается.
   */
  photoMarkers() {
    const snapshot = this.mode === "frozen" ? this.frozen : this.photo;
    const H = snapshot?.homography;
    if (!H) return [];
    const inside = ([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1;
    return this.entries().flatMap((m) => {
      const r = m.rectMm;
      const center = applyHomography(H, [r.x + r.w / 2, r.y + r.h / 2]);
      return inside(center) ? [{ ...m, polygon: rectCorners(r).map((p) => applyHomography(H, p)), center }] : [];
    });
  }

  // ——— Отрисовка ———

  refresh() {
    if (!this.board) return;
    this.ar?.setEntries(this.entries());
    this.render();
  }

  setLoading(text, progress) {
    this.$("camera-loading-text").textContent = text;
    const bar = this.$("camera-progress");
    if (progress == null) bar.removeAttribute("value");
    else bar.value = progress;
  }

  render() {
    if (!this.board) return;
    const { mode, photo } = this;
    const inPhoto = mode === "photo" && Boolean(photo);
    const recognizing = inPhoto && photo.status === "recognizing";
    const editing = inPhoto && photo.editing;
    const showPhoto = mode === "frozen" || inPhoto;
    this.$("ar-view").hidden = mode !== "ar" && mode !== "loading";
    this.$("ar-labels").hidden = mode !== "ar" || this.trackingState !== "tracking";
    if (recognizing) this.setLoading("Ищем плату на фото…", null);
    this.$("camera-loading").hidden = !(mode === "loading" || recognizing);
    this.$("photo-view").hidden = !showPhoto;
    this.photoView.setPlacing(editing && photo.corners.length < 4);
    if (showPhoto) this.renderPhotoLayers();

    const hint = this.$("camera-hint");
    const searching = mode === "ar" && this.trackingState !== "tracking";
    hint.hidden = !searching;
    if (searching) {
      this.$("camera-hint-text").textContent = HINTS[this.trackingState] ?? HINTS.searching;
      this.$("camera-tips").hidden = this.searchLevel < 1;
      this.$("camera-tips-board").textContent = this.board.name;
    }
    this.$("to-photo").classList.toggle("prominent", searching && this.searchLevel >= 2);

    const notice = this.$("camera-notice");
    notice.hidden = !(mode === "photo" && !photo);
    this.$("camera-notice-text").textContent = this.notice?.text
      ?? "Сделайте фото платы сверху или выберите его из галереи — плату на снимке найдём сами.";
    const retry = this.$("camera-retry");
    retry.hidden = !this.notice?.retry;
    retry.textContent = this.notice?.retry ?? "";
    retry.onclick = () => this.startAR();

    const torch = this.$("torch");
    torch.hidden = !(mode === "ar" && this.ar?.torchSupported);
    torch.setAttribute("aria-pressed", String(Boolean(this.ar?.torchWanted)));
    this.$("freeze").hidden = mode !== "ar";
    this.$("freeze").disabled = !this.ar?.isTracking;
    this.$("to-photo").hidden = mode !== "ar";
    this.$("back-to-ar").hidden = !(mode === "frozen" || (mode === "photo" && this.ar));
    this.$("take-photo").hidden = mode !== "photo";
    this.$("pick-photo").hidden = mode !== "photo";
    this.$("fix-corners").hidden = !(inPhoto && !editing && !recognizing);

    const note = this.$("frozen-note");
    note.textContent = mode === "frozen"
      ? "Кадр заморожен — приближайте и нажимайте на метки"
      : "Нажимайте на метки. Если они не на месте — «Поправить углы»";
    note.hidden = !(mode === "frozen" || (inPhoto && !editing && photo.homography));
    this.renderPlaceBar();
    this.renderCurrentStep();
  }

  /** Подсветка разъёмов, подписи и ручки углов на снимке. */
  renderPhotoLayers() {
    const editing = this.mode === "photo" && Boolean(this.photo?.editing);
    const markers = this.photoMarkers();
    // Пока правятся углы, подписи закрывали бы ручки — видна только подсветка разъёмов.
    this.photoView.setMarkers(editing ? markers.map((m) => ({ ...m, showLabel: false })) : markers);
    this.photoView.setCorners(editing ? this.photo.corners : [], editing);
  }

  renderPlaceBar() {
    const { photo } = this;
    const show = this.mode === "photo" && Boolean(photo?.editing);
    this.$("place-bar").hidden = !show;
    if (!show) return;
    const n = photo.corners.length;
    const hint = this.$("place-hint");
    hint.classList.toggle("problem", Boolean(photo.problem));
    hint.textContent = n < 4
      ? `${photo.missed && n === 0 ? "Плату на фото не нашли. " : ""}Коснитесь угла платы ${n + 1} из 4: ${CORNER_HINTS[n]}`
      : photo.problem ?? "Перетащите углы, если метки не на месте";
    this.$("place-schema").innerHTML = cornerSchema(n);
    this.$("corners-restart").hidden = n === 0;
    this.$("corners-done").disabled = !photo.homography;
  }

  /** Плашка «Сейчас: …» под камерой; у шага без разъёмов — пометка, что на плате его не подсветить. */
  renderCurrentStep() {
    const step = currentStep(this.session.plan, this.session.done);
    const bar = this.$("current-step");
    bar.hidden = !step;
    if (!step) return;
    this.$("current-step-title").textContent = step.title;
    this.$("current-step-note").hidden = step.connectorIds.length > 0;
    bar.onclick = () => this.openStep(step);
  }
}
