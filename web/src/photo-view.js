// BoardPhotoView(image, markers): снимок платы — замороженный кадр AR или загруженное фото. Метки приходят
// уже спроецированными по гомографии; углы платы можно ставить тапами и перетаскивать ручками.
// Зум, перемещение, тапы, раскладка подписей и выноски — здесь.
import { createLeadersLayer, renderLeaders } from "./leaders.js";
import { hitTest, layoutLabels } from "./markers.js";

const MAX_SCALE = 6;
const TAP_SLOP = 8;
const TAP_RADIUS = 28;
const SVG_NS = "http://www.w3.org/2000/svg";

export class BoardPhotoView {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {(marker: object) => void} o.onSelect — тап по метке
   * @param {(point: [number, number]) => void} o.onPlace — тап по фото в режиме расстановки углов
   * @param {(index: number, point: [number, number]) => void} o.onCornerMove — перетаскивание ручки угла
   */
  constructor(root, { onSelect, onPlace, onCornerMove }) {
    this.root = root;
    this.onSelect = onSelect;
    this.onPlace = onPlace;
    this.onCornerMove = onCornerMove;
    this.markers = [];
    this.corners = [];
    this.cornersEditable = false;
    this.placing = false;
    this.view = { scale: 1, tx: 0, ty: 0 };
    this.natural = { width: 1, height: 1 };

    root.classList.add("photo-view");
    root.innerHTML = `
      <div class="pv-stage"><img alt="Фото платы" draggable="false"><svg class="pv-shapes" preserveAspectRatio="none"></svg></div>
      <div class="pv-labels"></div>
      <div class="pv-corners"></div>
      <div class="pv-zoom">
        <button type="button" data-zoom="in" aria-label="Приблизить">+</button>
        <button type="button" data-zoom="out" aria-label="Отдалить">−</button>
        <button type="button" data-zoom="fit" aria-label="Показать целиком">⤢</button>
      </div>`;
    this.stage = root.querySelector(".pv-stage");
    this.img = root.querySelector("img");
    this.svg = root.querySelector("svg");
    this.labels = root.querySelector(".pv-labels");
    this.cornersLayer = root.querySelector(".pv-corners");
    this.leaders = createLeadersLayer();
    this.labels.before(this.leaders);

    root.querySelector(".pv-zoom").addEventListener("click", (e) => {
      const action = e.target.closest("button")?.dataset.zoom;
      const cx = root.clientWidth / 2;
      const cy = root.clientHeight / 2;
      if (action === "in") this.zoomAt(cx, cy, 1.6);
      if (action === "out") this.zoomAt(cx, cy, 1 / 1.6);
      if (action === "fit") this.fit();
    });
    this.bindGestures();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(root);
  }

  /**
   * Показывает снимок, когда он декодирован. При наложении вызовов остаётся последний: false — этот вызов
   * перебит следующим, и на экране не его снимок. isCurrent проверяет запрос владельца перед заменой DOM.
   */
  async setImage(url, isCurrent = () => true) {
    const request = (this.imageRequest = (this.imageRequest ?? 0) + 1);
    const img = new Image();
    img.alt = this.img.alt;
    img.draggable = false;
    img.src = url;
    await img.decode();
    if (request !== this.imageRequest || !isCurrent()) return false;
    this.img.replaceWith(img);
    this.img = img;
    this.natural = { width: img.naturalWidth, height: img.naturalHeight };
    this.svg.setAttribute("viewBox", `0 0 ${this.natural.width} ${this.natural.height}`);
    this.fit();
    return true;
  }

  /**
   * markers: { id, label, showLabel, state, order, center: [u, v], polygon: [[u, v] ×4] } — координаты
   * нормированы 0…1. Подпись есть только у showLabel.
   */
  setMarkers(markers) {
    this.markers = markers;
    this.labels.replaceChildren(...markers.filter((m) => m.showLabel).map((m) => {
      const label = document.createElement("button");
      label.type = "button";
      label.className = `marker-label ${m.state}`;
      label.textContent = m.label;
      label.addEventListener("click", () => this.onSelect(m));
      m.element = label;
      return label;
    }));
    this.drawShapes();
    this.layout();
  }

  /** Углы платы (нормированные, 0–4 шт. по часовой от верхнего левого); editable — ручки перетаскиваются. */
  setCorners(corners, editable) {
    this.corners = corners;
    this.cornersEditable = editable;
    // Пока угол тащат, число ручек не меняется — их узлы остаются, двигает их layout().
    const count = editable ? corners.length : 0;
    if (this.cornersLayer.childElementCount !== count) {
      this.cornersLayer.replaceChildren(...corners.slice(0, count).map((_, i) => {
        const handle = document.createElement("div");
        handle.className = "pv-corner";
        handle.textContent = String(i + 1);
        handle.setAttribute("aria-label", `Угол ${i + 1}`);
        handle.dataset.index = String(i);
        return handle;
      }));
    }
    this.drawShapes();
    this.layout();
  }

  drawShapes() {
    const { width: W, height: H } = this.natural;
    const points = (list) => list.map(([u, v]) => `${u * W},${v * H}`).join(" ");
    const shapes = this.markers.map((m) => {
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", points(m.polygon));
      poly.setAttribute("class", `pv-shape ${m.state}`);
      return poly;
    });
    if (this.cornersEditable && this.corners.length > 1) {
      const quad = document.createElementNS(SVG_NS, this.corners.length === 4 ? "polygon" : "polyline");
      quad.setAttribute("points", points(this.corners));
      quad.setAttribute("class", "pv-quad");
      shapes.push(quad);
    }
    this.svg.replaceChildren(...shapes);
  }

  setPlacing(placing) {
    this.placing = placing;
    this.root.classList.toggle("placing", placing);
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.root.replaceChildren();
  }

  // Базовый размер — «вписать»; view.scale ≥ 1 — зум поверх него.
  baseSize() {
    const k = Math.min(this.root.clientWidth / this.natural.width, this.root.clientHeight / this.natural.height);
    return { width: this.natural.width * k, height: this.natural.height * k };
  }

  fit() {
    const base = this.baseSize();
    this.view = {
      scale: 1,
      tx: (this.root.clientWidth - base.width) / 2,
      ty: (this.root.clientHeight - base.height) / 2,
    };
    this.apply();
  }

  zoomAt(cx, cy, factor) {
    const scale = Math.min(MAX_SCALE, Math.max(1, this.view.scale * factor));
    const k = scale / this.view.scale;
    this.view = { scale, tx: cx - (cx - this.view.tx) * k, ty: cy - (cy - this.view.ty) * k };
    this.apply();
  }

  // Изображение не уезжает с экрана: если оно меньше вьюпорта — по центру, иначе края не отрываются.
  clamp() {
    const base = this.baseSize();
    const w = base.width * this.view.scale;
    const h = base.height * this.view.scale;
    const vw = this.root.clientWidth;
    const vh = this.root.clientHeight;
    this.view.tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, this.view.tx));
    this.view.ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, this.view.ty));
  }

  apply() {
    this.clamp();
    const base = this.baseSize();
    const { scale, tx, ty } = this.view;
    this.stage.style.width = `${base.width}px`;
    this.stage.style.height = `${base.height}px`;
    this.stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    this.layout();
  }

  toScreen([u, v]) {
    const base = this.baseSize();
    return [this.view.tx + u * base.width * this.view.scale, this.view.ty + v * base.height * this.view.scale];
  }

  toImage(x, y) {
    const base = this.baseSize();
    return [(x - this.view.tx) / (base.width * this.view.scale), (y - this.view.ty) / (base.height * this.view.scale)];
  }

  // Снимок статичен: один детерминированный проход раскладки без истории (previous = null).
  layout() {
    const size = [this.root.clientWidth, this.root.clientHeight];
    const onScreen = ([x, y]) => x >= 0 && x <= size[0] && y >= 0 && y <= size[1];
    // При зуме разъём может уйти за край экрана — его подпись скрыта, а не прижата к краю (как в AR).
    const labeled = this.markers.filter((m) => m.element);
    const anchors = labeled.map((m) => this.toScreen(m.center));
    const items = labeled.flatMap((m, i) => (onScreen(anchors[i]) ? [{
      id: m.id, anchor: anchors[i], size: [m.element.offsetWidth, m.element.offsetHeight], state: m.state, order: m.order,
    }] : []));
    const byId = new Map(items.map((item) => [item.id, item]));
    const { labels } = layoutLabels(items, size, null);
    const lines = [];
    labeled.forEach((m) => {
      const place = labels.get(m.id);
      const item = byId.get(m.id);
      const visible = Boolean(place?.visible);
      m.element.style.visibility = visible ? "visible" : "hidden"; // не hidden: размер нужен для раскладки
      if (!visible) return;
      m.element.style.transform = `translate(${place.x}px, ${place.y}px) translate(-50%, -50%)`;
      if (place.leader) lines.push({ from: item.anchor, to: [place.x, place.y], size: item.size, state: m.state });
    });
    renderLeaders(this.leaders, lines);

    [...this.cornersLayer.children].forEach((handle, i) => {
      const [x, y] = this.toScreen(this.corners[i]);
      handle.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    });
  }

  tap(x, y) {
    const [u, v] = this.toImage(x, y);
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    if (this.placing) {
      this.onPlace([u, v]);
      return;
    }
    if (this.cornersEditable) return; // правка углов: тап мимо ручки не открывает шаг
    // Попадание считаем в пикселях снимка, чтобы радиус не зависел от пропорций.
    const { width: W, height: H } = this.natural;
    const toPx = ([a, b]) => [a * W, b * H];
    const radius = TAP_RADIUS / (this.baseSize().width * this.view.scale) * W;
    const hit = hitTest(
      this.markers.map((m) => ({ ...m, center: toPx(m.center), polygon: m.polygon?.map(toPx), source: m })),
      toPx([u, v]),
      radius,
    );
    if (hit) this.onSelect(hit.source);
  }

  bindGestures() {
    const pointers = new Map();
    let gesture = null;

    const local = (e) => {
      const r = this.root.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pinch = () => {
      const [a, b] = [...pointers.values()];
      return { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    };

    this.root.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      this.root.setPointerCapture(e.pointerId);
      const handle = e.target.closest(".pv-corner");
      if (handle && pointers.size === 0) {
        pointers.set(e.pointerId, local(e));
        gesture = { corner: Number(handle.dataset.index), moved: true };
        return;
      }
      pointers.set(e.pointerId, local(e));
      gesture = pointers.size === 1
        ? { start: local(e), last: local(e), moved: false }
        : { ...pinch(), moved: true };
    });

    this.root.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, local(e));
      if (gesture.corner !== undefined) {
        this.onCornerMove(gesture.corner, this.toImage(...local(e)));
        return;
      }
      if (pointers.size >= 2) {
        const now = pinch();
        this.view.tx += now.mid[0] - gesture.mid[0];
        this.view.ty += now.mid[1] - gesture.mid[1];
        this.zoomAt(now.mid[0], now.mid[1], now.distance / gesture.distance);
        gesture = { ...now, moved: true };
        return;
      }
      const p = local(e);
      if (Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > TAP_SLOP) gesture.moved = true;
      if (gesture.moved) {
        this.view.tx += p[0] - gesture.last[0];
        this.view.ty += p[1] - gesture.last[1];
        this.apply();
      }
      gesture.last = p;
    });

    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (e.type === "pointerup" && pointers.size === 0 && gesture && !gesture.moved) this.tap(...p);
      if (pointers.size === 0) gesture = null;
      else if (pointers.size === 1) {
        const rest = [...pointers.values()][0];
        gesture = { start: rest, last: rest, moved: true };
      }
    };
    this.root.addEventListener("pointerup", end);
    this.root.addEventListener("pointercancel", end);

    this.root.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY / 300));
    }, { passive: false });

    this.root.addEventListener("dblclick", (e) => {
      if (this.placing || e.target.closest("button, .pv-corner")) return;
      const [x, y] = local(e);
      if (this.view.scale > 1) this.fit();
      else this.zoomAt(x, y, 2.5);
    });
  }
}
