// AR-сессия на MindAR: Tracker (якорь платы), Highlight (плоскости three.js на разъёмах),
// Labels (HTML-кнопки в проекции центров разъёмов) и снимок кадра для заморозки.
import { webAnchorPosition, webCorners, webSize } from "./layout.js";
import { clampLabel } from "./markers.js";

const MINDAR_SRC = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

const HIGHLIGHT = {
  current: { color: 0xffb300, opacity: 0.6 },
  pending: { color: 0x0f9d8f, opacity: 0.35 },
  done: { color: 0x8a9399, opacity: 0.15 },
};

export class CameraAccessError extends Error {}

let enginePromise;

/** three.js и MindAR грузятся только при первом открытии камеры. */
export function loadEngine() {
  enginePromise ??= Promise.all([import("three"), import(MINDAR_SRC)])
    .then(([THREE, { MindARThree }]) => ({ THREE, MindARThree }))
    .catch((e) => {
      enginePromise = undefined;
      throw e;
    });
  return enginePromise;
}

/** Камера + WebGL; в небезопасном контексте getUserMedia недоступен. */
export function isARSupported() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Встроенные браузеры мессенджеров и соцсетей часто не дают камеру или WebGL. */
export function isInAppBrowser(ua = navigator.userAgent) {
  return /Telegram|FBAN|FBAV|Instagram|Line\/|VKClient|; wv\)|MicroMessenger/i.test(ua);
}

/** Скачивает .mind с прогрессом; возвращает blob-URL для MindAR. */
export async function fetchTarget(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) return URL.createObjectURL(await res.blob());
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) onProgress(loaded / total);
  }
  return URL.createObjectURL(new Blob(chunks));
}

/** Отдельный запрос камеры, чтобы отличить отказ в доступе от остальных ошибок (MindAR их не различает). */
async function checkCameraAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    throw new CameraAccessError(e?.name === "NotFoundError" ? "Камера не найдена" : "Нет доступа к камере");
  }
}

export class ARSession {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container — сюда MindAR кладёт видео и canvas
   * @param {HTMLElement} o.labelsLayer — слой для HTML-меток поверх камеры
   * @param {string} o.targetSrc — URL файла .mind
   * @param {{widthMm:number,heightMm:number}} o.physical
   * @param {(state: "searching"|"tracking"|"limited") => void} o.onState
   * @param {(entry: object) => void} o.onSelect — тап по метке
   */
  constructor({ container, labelsLayer, targetSrc, physical, onState, onSelect }) {
    Object.assign(this, { container, labelsLayer, targetSrc, physical, onState, onSelect });
    this.entries = [];
    this.items = [];
  }

  async start() {
    await checkCameraAccess();
    const { THREE, MindARThree } = await loadEngine();
    this.THREE = THREE;
    this.mindar = new MindARThree({
      container: this.container,
      imageTargetSrc: this.targetSrc,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
    });
    this.anchor = this.mindar.addAnchor(0);
    // После stopProcessVideo MindAR дорабатывает текущий кадр — его события на паузе игнорируем.
    this.anchor.onTargetFound = () => {
      if (!this.paused) this.onState("tracking");
    };
    this.anchor.onTargetLost = () => {
      if (!this.paused) this.onState("limited");
    };
    this.buildItems();

    try {
      await this.mindar.start();
    } catch {
      throw new CameraAccessError("Нет доступа к камере");
    }
    this.onState("searching");
    this.loop();
  }

  loop() {
    const { renderer, scene, camera } = this.mindar;
    renderer.setAnimationLoop(() => {
      // Контейнер мог быть скрыт (фото-режим) или поменять размер — MindAR подстраивается только на window.resize.
      const size = `${this.container.clientWidth}x${this.container.clientHeight}`;
      if (size !== this.lastSize) {
        this.lastSize = size;
        this.mindar.resize();
      }
      renderer.render(scene, camera);
      this.updateLabels();
    });
  }

  /** entries — результат connectorStates(); пересоздаёт подсветки и метки, трекинг не трогает. */
  setEntries(entries) {
    this.entries = entries;
    if (this.anchor) this.buildItems();
  }

  buildItems() {
    const { THREE } = this;
    for (const item of this.items) {
      this.anchor.group.remove(item.mesh);
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
    }
    this.labelsLayer.replaceChildren();

    this.items = this.entries.map((entry) => {
      const rect = entry.connector.rectMm;
      const { width, height } = webSize(this.physical, rect);
      const [x, y] = webAnchorPosition(this.physical, rect);
      const style = HIGHLIGHT[entry.state];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ color: style.color, opacity: style.opacity, transparent: true, depthWrite: false }),
      );
      mesh.position.set(x, y, 0.001);
      this.anchor.group.add(mesh);

      const label = document.createElement("button");
      label.type = "button";
      label.className = `marker-label ${entry.state}`;
      label.textContent = entry.connector.name;
      label.hidden = true;
      label.addEventListener("click", () => this.onSelect(entry));
      this.labelsLayer.append(label);
      return { entry, mesh, label, center: new THREE.Vector3(x, y, 0) };
    });
  }

  /** Экранная точка (px контейнера) для точки якоря или null, если она за камерой. */
  project(local) {
    const { camera, container } = this.mindar;
    const v = local.clone().applyMatrix4(this.anchor.group.matrixWorld).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return [(v.x + 1) / 2 * container.clientWidth, (1 - v.y) / 2 * container.clientHeight];
  }

  updateLabels() {
    const tracking = this.anchor.visible && !this.paused;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const { label, center } of this.items) {
      const p = tracking ? this.project(center) : null;
      const onScreen = p && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h;
      label.hidden = !onScreen;
      if (!onScreen) continue;
      const [x, y] = clampLabel(p, [label.offsetWidth, label.offsetHeight], [w, h]);
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  get isTracking() {
    return Boolean(this.anchor?.visible) && !this.paused;
  }

  pause() {
    this.resuming = false; // отменяет resume(), ждущий video.play()
    if (!this.mindar?.controller || this.paused) return;
    this.paused = true;
    this.mindar.controller.stopProcessVideo();
    this.mindar.video.pause();
    this.mindar.renderer.setAnimationLoop(null);
    this.hideAnchor();
    this.updateLabels();
  }

  // Якорь ищется заново: MindAR вызовет onTargetFound, когда снова увидит плату.
  hideAnchor() {
    this.anchor.visible = false;
    this.anchor.group.visible = false;
  }

  async resume() {
    if (!this.paused || this.resuming) return;
    this.resuming = true;
    await this.mindar.video.play().catch(() => {});
    if (!this.resuming || !this.mindar) return;
    this.resuming = false;
    this.hideAnchor();
    this.paused = false;
    this.onState("searching");
    this.mindar.controller.processVideo(this.mindar.video);
    this.loop();
  }

  stop() {
    if (!this.mindar) return;
    this.mindar.renderer.setAnimationLoop(null);
    try {
      this.mindar.stop();
    } catch {
      // Сессия могла не успеть запустить видео.
    }
    this.mindar.video = null; // MindAR не снимает свой обработчик resize; без видео он ничего не делает.
    this.mindar.renderer.dispose();
    this.container.replaceChildren();
    this.labelsLayer.replaceChildren();
    this.mindar = null;
  }

  /**
   * Снимок кадра с той же обрезкой, что на экране, без 3D-подсветки,
   * и метки в нормированных координатах снимка (центр + четырёхугольник в перспективе).
   */
  async freeze() {
    const { video } = this.mindar;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);

    const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    const sx = (video.videoWidth - cw / scale) / 2;
    const sy = (video.videoHeight - ch / scale) / 2;
    canvas.getContext("2d").drawImage(video, sx, sy, cw / scale, ch / scale, 0, 0, canvas.width, canvas.height);

    const markers = [];
    for (const { entry, center } of this.items) {
      const c = this.project(center);
      const corners = webCorners(this.physical, entry.connector.rectMm)
        .map(([x, y, z]) => this.project(new this.THREE.Vector3(x, y, z)));
      if (!c || corners.includes(null)) continue;
      const norm = ([x, y]) => [x / cw, y / ch];
      const polygon = corners.map(norm);
      const visible = polygon.some(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1);
      if (visible) markers.push({ id: entry.connector.id, center: norm(c), polygon });
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("canvas.toBlob вернул пустой результат");
    return { url: URL.createObjectURL(blob), markers };
  }
}
