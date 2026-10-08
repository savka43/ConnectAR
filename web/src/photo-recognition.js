// Распознавание платы на неподвижном снимке. Отдельный Controller MindAR под размер уменьшенного снимка:
// детектор проходит 9 окон снимка, матчер сопоставляет особые точки с эталоном, и из каждого окна берутся
// пары «точка эталона → точка снимка». Гомография считается по парам (RANSAC + DLT) без параметров камеры,
// поэтому угол обзора и обрезка телефона на неё не влияют.
import { applyHomography, boardCorners, checkQuad, multiply, ransacHomography, scaling } from "./homography.js";

export const MINDAR_IMAGE_SRC = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";
const MAX_SIDE = 1280;
// Вход контроллера фиксирован и не квадратный: InputLoader MindAR считает кадр повёрнутым на 90°, если его ширина
// равна высоте входа, — у квадратного входа это верно для любого кадра.
const INPUT_WIDTH = MAX_SIDE + 1;
const INPUT_HEIGHT = MAX_SIDE;
const RANSAC_PX = 4; // допуск выброса в пикселях уменьшенного снимка
const MIN_PAIRS = 12;
const WINDOWS = 9;

let controllerClass;
function loadController() {
  controllerClass ??= import(MINDAR_IMAGE_SRC).then((m) => m.Controller).catch((e) => {
    controllerClass = undefined;
    throw e;
  });
  return controllerClass;
}

/** Снимок с учётом EXIF-поворота: ImageBitmap или декодированный <img> (если createImageBitmap не умеет). */
export async function loadOrientedImage(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const sizeOf = (image) => [image.naturalWidth ?? image.width, image.naturalHeight ?? image.height];

/** Копия снимка, уменьшенная до maxSide по длинной стороне. */
export function downscale(image, maxSide) {
  const [w, h] = sizeOf(image);
  const k = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Один контроллер на страницу: новый под каждое фото держал бы тензоры MindAR до закрытия вкладки, а освобождать
// их приходится через приватные поля (releaseController). Пересоздаётся только при смене эталона (другая плата).
let shared = null; // { targetBuffer, controller, canvas, targetSize, keyframes }
let queue = Promise.resolve();

/**
 * Ищет плату на снимке. Вызовы выполняются по очереди: контроллер и его воркер общие.
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} image — уже повёрнутый по EXIF
 * @param {ArrayBuffer} targetBuffer — содержимое targets.mind
 * @param {{widthMm:number,heightMm:number}} physical
 * @returns {Promise<{homography: number[], pairs: number, inliers: number} | null>}
 *   homography — мм платы → нормированные координаты снимка (0…1).
 */
export function recognizeBoard(image, targetBuffer, physical, options) {
  const run = queue.then(() => recognize(image, targetBuffer, physical, options));
  queue = run.catch(() => {});
  return run;
}

async function recognize(image, targetBuffer, physical, { rng } = {}) {
  const { controller, canvas, targetSize, keyframes } = await controllerFor(targetBuffer);
  // Снимок вписывается в центр входа длинной стороной: окна детектора стоят вокруг центра входа.
  const [w, h] = sizeOf(image);
  const k = MAX_SIDE / Math.max(w, h);
  const width = Math.round(w * k);
  const height = Math.round(h * k);
  const ox = Math.floor((canvas.width - width) / 2);
  const oy = Math.floor((canvas.height - height) / 2);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, ox, oy, width, height);

  const pairs = await collectPairs(controller, canvas, keyframes);
  if (pairs.length < MIN_PAIRS) return null;

  // Эталон в пикселях target.jpg → мм платы; снимок — в пикселях вписанной копии.
  const [targetWidth, targetHeight] = targetSize;
  const src = pairs.map(([p]) => [p.x / targetWidth * physical.widthMm, p.y / targetHeight * physical.heightMm]);
  const dst = pairs.map(([, q]) => [q.x - ox, q.y - oy]);
  const result = ransacHomography(src, dst, { threshold: RANSAC_PX, minInliers: MIN_PAIRS, rng });
  if (!result) return null;

  const corners = boardCorners(physical).map((p) => applyHomography(result.H, p));
  if (!checkQuad(corners, [width, height], physical).ok) return null;
  return {
    homography: multiply(scaling(1 / width, 1 / height), result.H),
    pairs: src.length,
    inliers: result.inliers.length,
  };
}

async function controllerFor(targetBuffer) {
  if (shared?.targetBuffer === targetBuffer) return shared;
  const Controller = await loadController();
  if (shared) releaseController(shared.controller);
  shared = null;
  // debugMode нужен только воркеру матчера: в debugExtra он отдаёт пары точек. Детектору он ни к чему.
  const controller = new Controller({ inputWidth: INPUT_WIDTH, inputHeight: INPUT_HEIGHT, maxTrack: 1, debugMode: true });
  controller.cropDetector.debugMode = false;
  controller.cropDetector.detector.debugMode = false;
  try {
    const { dimensions, matchingDataList } = controller.addImageTargetsFromBuffer(targetBuffer.slice(0));
    const canvas = document.createElement("canvas");
    canvas.width = INPUT_WIDTH;
    canvas.height = INPUT_HEIGHT;
    shared = { targetBuffer, controller, canvas, targetSize: dimensions[0], keyframes: matchingDataList[0] };
    return shared;
  } catch (e) {
    releaseController(controller);
    throw e;
  }
}

// Детектор MindAR смотрит в квадратное окно ~ половины меньшей стороны входа; detectMoving перебирает
// 9 окон вокруг центра. Пары берутся из всех окон и всех ключевых кадров, где матчер нашёл плату.
// Окна перекрываются, и одна точка снимка находится в нескольких окнах и ключевых кадрах. Повторы
// отбрасываются, иначе они раздували бы MIN_PAIRS и число инлайеров RANSAC.
async function collectPairs(controller, canvas, keyframes) {
  const pairs = [];
  const seen = new Set();
  const inputT = controller.inputLoader.loadInput(canvas);
  try {
    for (let i = 0; i < WINDOWS; i++) {
      // Детектор при первом вызове создаёт промежуточные тензоры вне tf.tidy (MindAR 1.2.5) — tidy их освобождает.
      const detect = () => controller.cropDetector.detectMoving(inputT);
      const engine = globalThis._tfengine;
      const { featurePoints } = engine?.tidy ? engine.tidy(detect) : detect();
      const { debugExtra } = await controller.match(featurePoints, 0);
      (debugExtra?.frames ?? []).forEach((frame, k) => {
        const { scale } = keyframes[k];
        for (const { querypoint, keypoint } of frame?.inlierMatches2 ?? []) {
          const key = `${Math.round(querypoint.x)},${Math.round(querypoint.y)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push([{ x: (keypoint.x + 0.5) / scale, y: (keypoint.y + 0.5) / scale }, querypoint]);
        }
      });
    }
  } finally {
    inputT.dispose();
  }
  return pairs;
}

// MindAR 1.2.5 в dispose() не освобождает тензоры TF.js и текстуру входа: трекер, детектор и загрузчик
// держат их до закрытия страницы. Нужно только при смене платы: контроллер общий для всех снимков.
function releaseController(controller) {
  try {
    controller.dispose();
  } catch {
    // Воркер мог не успеть запуститься.
  }
  controller.worker?.terminate?.();
  const seen = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 8 || ArrayBuffer.isView(value)) return;
    seen.add(value);
    if (typeof value.dispose === "function" && "dataId" in value) {
      if (!value.isDisposed) value.dispose();
      return;
    }
    if (typeof Node !== "undefined" && value instanceof Node) return;
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, depth + 1);
  };
  visit(controller.tracker, 0);
  visit(controller.cropDetector, 0);
  const handle = controller.inputLoader?.tempPixelHandle;
  if (handle) globalThis._tfengine?.backend?.disposeData?.(handle.dataId);
}
