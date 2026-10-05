// BoardPhotoView(image, markers): обобщённый фото-режим. В ручном режиме метки ставит пользователь,
// в замороженном кадре они приходят из AR. Зум, перемещение, тапы и подсветка текущего шага — здесь.
import { clampLabel, hitTest } from "./markers.js";

const MAX_SCALE = 6;
const TAP_SLOP = 8;
const TAP_RADIUS = 28;
const SVG_NS = "http://www.w3.org/2000/svg";

export class BoardPhotoView {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {(marker: object) => void} o.onSelect — тап по метке
   * @param {(point: [number, number]) => void} o.onPlace — тап по фото в режиме расстановки
   */
  constructor(root, { onSelect, onPlace }) {
    this.root = root;
    this.onSelect = onSelect;
    this.onPlace = onPlace;
    this.markers = [];
    this.placing = false;
    this.view = { scale: 1, tx: 0, ty: 0 };
    this.natural = { width: 1, height: 1 };

    root.classList.add("photo-view");
    root.innerHTML = `
      <div class="pv-stage"><img alt="Фото платы" draggable="false"><svg class="pv-shapes" preserveAspectRatio="none"></svg></div>
      <div class="pv-labels"></div>
      <div class="pv-zoom">
        <button type="button" data-zoom="in" aria-label="Приблизить">+</button>
        <button type="button" data-zoom="out" aria-label="Отдалить">−</button>
        <button type="button" data-zoom="fit" aria-label="Показать целиком">⤢</button>
      </div>`;
    this.stage = root.querySelector(".pv-stage");
    this.img = root.querySelector("img");
    this.svg = root.querySelector("svg");
    this.labels = root.querySelector(".pv-labels");

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

  async setImage(url) {
    this.img.src = url;
    await this.img.decode();
    this.natural = { width: this.img.naturalWidth, height: this.img.naturalHeight };
    this.svg.setAttribute("viewBox", `0 0 ${this.natural.width} ${this.natural.height}`);
    this.fit();
  }

  /** markers: { id, label, state, center: [u, v], polygon?: [[u, v] ×4] }, координаты нормированы 0…1. */
  setMarkers(markers) {
    this.markers = markers;
    const { width: W, height: H } = this.natural;
    this.svg.replaceChildren(...markers.filter((m) => m.polygon).map((m) => {
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", m.polygon.map(([u, v]) => `${u * W},${v * H}`).join(" "));
      poly.setAttribute("class", `pv-shape ${m.state}`);
      return poly;
    }));
    this.labels.replaceChildren(...markers.map((m) => {
      const label = document.createElement("button");
      label.type = "button";
      label.className = `marker-label ${m.state}${m.polygon ? "" : " point"}`;
      label.textContent = m.label;
      label.addEventListener("click", () => this.onSelect(m));
      m.element = label;
      return label;
    }));
    this.layoutLabels();
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
    this.layoutLabels();
  }

  toScreen([u, v]) {
    const base = this.baseSize();
    return [this.view.tx + u * base.width * this.view.scale, this.view.ty + v * base.height * this.view.scale];
  }

  toImage(x, y) {
    const base = this.baseSize();
    return [(x - this.view.tx) / (base.width * this.view.scale), (y - this.view.ty) / (base.height * this.view.scale)];
  }

  layoutLabels() {
    const size = [this.root.clientWidth, this.root.clientHeight];
    for (const m of this.markers) {
      const [x, y] = clampLabel(this.toScreen(m.center), [m.element.offsetWidth, m.element.offsetHeight], size);
      m.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  tap(x, y) {
    const [u, v] = this.toImage(x, y);
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    if (this.placing) {
      this.onPlace([u, v]);
      return;
    }
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
      pointers.set(e.pointerId, local(e));
      gesture = pointers.size === 1
        ? { start: local(e), last: local(e), moved: false }
        : { ...pinch(), moved: true };
    });

    this.root.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, local(e));
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
      if (this.placing || e.target.closest("button")) return;
      const [x, y] = local(e);
      if (this.view.scale > 1) this.fit();
      else this.zoomAt(x, y, 2.5);
    });
  }
}
