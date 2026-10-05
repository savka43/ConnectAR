// Вкладка «Камера»: AR по умолчанию, заморозка кадра и ручной фото-режим как запасной путь.
// Любая ошибка ведёт в фото-режим, тупиков нет (docs/design-doc.md, раздел 4).
import { ARSession, CameraAccessError, fetchTarget, isARSupported, isInAppBrowser, loadEngine } from "./ar.js";
import { connectorStates } from "./markers.js";
import { BoardPhotoView } from "./photo-view.js";

const TIPS_AFTER_MS = 10_000;
const PHOTO_OFFER_AFTER_MS = 25_000;

const HINTS = {
  searching: "Наведите камеру так, чтобы плата целиком попала в кадр",
  limited: "Плата потеряна — наведите камеру снова",
};

const CAMERA_DENIED = "Нет доступа к камере. Разрешите его в настройках сайта: значок слева от адреса → «Камера» → «Разрешить» "
  + "(iPhone: «Настройки» → Safari → «Камера»), затем нажмите «Повторить». Или отметьте разъёмы на фото.";

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

    this.photoView = new BoardPhotoView(this.$("photo-view"), {
      onSelect: (marker) => this.select(marker.id),
      onPlace: (point) => this.place(point),
    });

    this.$("freeze").addEventListener("click", () => this.freeze());
    this.$("to-photo").addEventListener("click", () => this.enterPhoto());
    this.$("back-to-ar").addEventListener("click", () => this.backToAR());
    this.$("take-photo").addEventListener("click", () => this.$("file-capture").click());
    this.$("pick-photo").addEventListener("click", () => this.$("file-gallery").click());
    for (const id of ["file-capture", "file-gallery"]) {
      this.$(id).addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) this.loadManualPhoto(file);
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
    this.ar?.stop();
    this.ar = null;
    this.clearSearchTimers();
    if (this.frozen) URL.revokeObjectURL(this.frozen.url);
    if (this.manual) URL.revokeObjectURL(this.manual.url);
    this.frozen = null;
    this.manual = null;
    this.placingId = null;
    this.notice = null;
    this.mode = "idle";
  }

  /** Разъёмы выбранных компонентов с состоянием и шагом. */
  allEntries() {
    return connectorStates(this.board, this.session.selected, this.session.done);
  }

  /** То же для AR: без rectMm разъём на плате не показать. */
  entries() {
    return this.allEntries().filter((e) => e.connector.rectMm);
  }

  select(connectorId) {
    const entry = this.allEntries().find((e) => e.connector.id === connectorId);
    if (entry) this.openStep(entry.step);
  }

  // ——— AR ———

  async startAR() {
    const token = ++this.token;
    this.notice = null;
    if (!this.board.target || !this.targetUrl) {
      return this.enterPhoto({ text: "AR для этой платы пока недоступен: нет эталонного фото. Сделайте снимок и отметьте разъёмы вручную." });
    }
    if (isInAppBrowser()) {
      return this.enterPhoto({ text: "Встроенный браузер приложения может не поддерживать камеру и AR. Откройте страницу в Safari или Chrome.", retry: "Всё равно попробовать AR" });
    }
    if (!isARSupported()) {
      return this.enterPhoto({ text: "Этот браузер не поддерживает AR: нужны доступ к камере (HTTPS) и WebGL. Можно отметить разъёмы на фото." });
    }

    this.mode = "loading";
    this.setLoading("Загрузка распознавания…", null);
    this.render();

    let targetSrc;
    try {
      [, targetSrc] = await Promise.all([
        loadEngine(),
        fetchTarget(this.targetUrl, (p) => this.setLoading("Загрузка эталона платы…", p)),
      ]);
    } catch (e) {
      console.error(e);
      if (token === this.token) this.enterPhoto({ text: "Не удалось загрузить данные распознавания платы.", retry: "Повторить" });
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
    });
    ar.setEntries(this.entries());
    try {
      await ar.start();
    } catch (e) {
      console.error(e);
      ar.stop();
      URL.revokeObjectURL(targetSrc);
      if (token !== this.token) return;
      const text = e instanceof CameraAccessError
        ? (e.message === "Нет доступа к камере" ? CAMERA_DENIED : `${e.message}. Можно отметить разъёмы на фото.`)
        : "Не удалось запустить распознавание.";
      return this.enterPhoto({ text, retry: "Повторить" });
    }
    if (token !== this.token) return ar.stop();

    this.ar = ar;
    this.mode = "ar";
    if (!this.active) ar.pause();
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
    if (!this.ar?.isTracking) return;
    try {
      this.frozen = await this.ar.freeze();
      await this.photoView.setImage(this.frozen.url);
    } catch (e) {
      console.error(e);
      this.frozen = null;
      this.toast("Не удалось сохранить кадр");
      return;
    }
    this.ar.pause();
    this.clearSearchTimers();
    this.mode = "frozen";
    this.render();
  }

  backToAR() {
    if (this.frozen) URL.revokeObjectURL(this.frozen.url);
    this.frozen = null;
    this.placingId = null;
    if (this.ar) {
      this.mode = "ar";
      this.ar.resume();
      this.render();
    } else {
      this.startAR();
    }
  }

  // ——— Фото-режим ———

  /** notice — причина, по которой AR недоступен; retry — подпись кнопки повторного запуска AR. */
  enterPhoto(notice = null) {
    this.ar?.pause();
    this.clearSearchTimers();
    this.notice = notice;
    this.mode = "photo";
    if (this.frozen) URL.revokeObjectURL(this.frozen.url);
    this.frozen = null;
    if (this.manual) this.photoView.setImage(this.manual.url).then(() => this.render());
    this.render();
  }

  async loadManualPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      await this.photoView.setImage(url);
    } catch {
      URL.revokeObjectURL(url);
      this.toast("Не удалось открыть фото");
      return;
    }
    if (this.manual) URL.revokeObjectURL(this.manual.url);
    this.manual = { url, positions: new Map() };
    this.placingId = this.allEntries()[0]?.connector.id ?? null;
    this.mode = "photo";
    this.render();
  }

  place(point) {
    if (!this.placingId || !this.manual) return;
    this.manual.positions.set(this.placingId, point);
    this.placingId = this.allEntries().find((e) => !this.manual.positions.has(e.connector.id))?.connector.id ?? null;
    this.render();
  }

  photoMarkers() {
    const byId = new Map(this.allEntries().map((e) => [e.connector.id, e]));
    const toMarker = (id, geometry) => {
      const entry = byId.get(id);
      return entry && { id, label: entry.connector.name, state: entry.state, ...geometry };
    };
    if (this.mode === "frozen") return this.frozen.markers.map((m) => toMarker(m.id, m)).filter(Boolean);
    if (this.manual) return [...this.manual.positions].map(([id, center]) => toMarker(id, { center })).filter(Boolean);
    return [];
  }

  renderPlaceBar() {
    const bar = this.$("place-bar");
    const show = this.mode === "photo" && this.manual;
    bar.hidden = !show;
    if (!show) return;
    const entries = this.allEntries();
    const chips = entries.map(({ connector, state }) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `chip ${state}`;
      chip.classList.toggle("placed", this.manual.positions.has(connector.id));
      chip.setAttribute("aria-pressed", String(this.placingId === connector.id));
      chip.textContent = connector.name;
      chip.addEventListener("click", () => {
        this.placingId = this.placingId === connector.id ? null : connector.id;
        this.render();
      });
      return chip;
    });
    this.$("place-chips").replaceChildren(...chips);
    const placing = entries.find((e) => e.connector.id === this.placingId);
    this.$("place-hint").textContent = placing
      ? `Коснитесь фото там, где находится ${placing.connector.name}`
      : "Выберите разъём, чтобы поставить или переставить метку";
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
    const { mode } = this;
    const showPhoto = mode === "frozen" || (mode === "photo" && this.manual);
    this.$("ar-view").hidden = mode !== "ar" && mode !== "loading";
    this.$("ar-labels").hidden = mode !== "ar" || this.trackingState !== "tracking";
    this.$("camera-loading").hidden = mode !== "loading";
    this.$("photo-view").hidden = !showPhoto;
    this.photoView.setPlacing(mode === "photo" && Boolean(this.placingId));
    if (showPhoto) this.photoView.setMarkers(this.photoMarkers());

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
    notice.hidden = !(mode === "photo" && !this.manual);
    this.$("camera-notice-text").textContent = this.notice?.text ?? "Сделайте фото платы сверху или выберите его из галереи, затем отметьте разъёмы.";
    const retry = this.$("camera-retry");
    retry.hidden = !this.notice?.retry;
    retry.textContent = this.notice?.retry ?? "";
    retry.onclick = () => this.startAR();

    this.$("freeze").hidden = mode !== "ar";
    this.$("freeze").disabled = !this.ar?.isTracking;
    this.$("to-photo").hidden = mode !== "ar";
    this.$("back-to-ar").hidden = !(mode === "frozen" || (mode === "photo" && this.ar));
    this.$("take-photo").hidden = mode !== "photo";
    this.$("pick-photo").hidden = mode !== "photo";
    this.$("frozen-note").hidden = mode !== "frozen";
    this.renderPlaceBar();
  }
}
