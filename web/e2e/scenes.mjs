// Синтетические снимки платы с известной гомографией: target.jpg, натянутый на заданные углы.
// Генерирует сцены для распознавания, JPEG с EXIF Orientation = 6, чужую картинку и кадр фейковой камеры (.y4m).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "canvas";
import { applyHomography, boardCorners, homographyFromPoints } from "../src/homography.js";

const repo = new URL("../../", import.meta.url);
const boardDir = new URL("shared_boards/boards/gigabyte-b450-aorus-m/", repo);
export const OUT = new URL("../e2e/.scenes/", import.meta.url);
export const physical = JSON.parse(readFileSync(new URL("board.json", boardDir), "utf8")).physical;

/**
 * Сцены: углы платы в px (по часовой от верхнего левого — у задней панели). small — плата ~12 % кадра.
 * Порог точности в тестах — 1 % диагонали снимка.
 */
export const SCENES = [
  { name: "front", width: 1600, height: 1200, corners: [[420, 170], [1190, 160], [1200, 940], [410, 950]] },
  { name: "tilt-left", width: 1600, height: 1200, corners: [[380, 230], [1180, 120], [1230, 1050], [350, 930]] },
  { name: "rotated", width: 1600, height: 1200, corners: [[520, 110], [1260, 300], [1080, 1040], [330, 860]] },
  { name: "steep", width: 1600, height: 1200, corners: [[520, 330], [1080, 330], [1300, 980], [300, 980]] },
  { name: "small", width: 1600, height: 1200, corners: [[640, 380], [1000, 370], [1010, 740], [630, 750]] },
  // Квадратный кадр: MindAR принял бы его за повёрнутый на 90°, а повёрнутая квадратная плата проходит checkQuad.
  { name: "square", width: 1200, height: 1200, corners: [[300, 250], [1000, 280], [980, 990], [270, 960]] },
  { name: "wide", width: 1600, height: 900, corners: [[520, 120], [1110, 140], [1100, 800], [500, 780]] },
];

// Портретный снимок, сохранённый повёрнутым на 90° с EXIF Orientation = 6 (как у iPhone).
export const EXIF_SCENE = { name: "exif-6", width: 1200, height: 1600, corners: [[200, 380], [1010, 330], [1050, 1150], [170, 1180]] };

// Кадр фейковой камеры для AR.
export const CAMERA_SCENE = { name: "camera", width: 1280, height: 720, corners: [[400, 70], [890, 80], [900, 650], [390, 640]] };

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
};

// Фон «стол»: плавные полосы и слабый шум, без резких деталей.
function background(x, y, rng) {
  const wave = Math.sin(x / 90) * 10 + Math.sin((x + y) / 210) * 14;
  const n = (rng() - 0.5) * 8;
  return [150 + wave + n, 118 + wave * 0.8 + n, 86 + wave * 0.6 + n];
}

/** RGBA-пиксели сцены: плата по гомографии мм → px, вокруг — фон. */
export function renderScene(target, scene) {
  const { width, height } = scene;
  const H = homographyFromPoints(boardCorners(physical), scene.corners);
  const Hinv = homographyFromPoints(scene.corners, boardCorners(physical));
  const tw = target.width;
  const th = target.height;
  const src = target.data;
  const out = new Uint8ClampedArray(width * height * 4);
  const rng = mulberry(width * 31 + height);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const [mx, my] = applyHomography(Hinv, [u + 0.5, v + 0.5]);
      const tx = (mx / physical.widthMm) * tw - 0.5;
      const ty = (my / physical.heightMm) * th - 0.5;
      const i = (v * width + u) * 4;
      if (tx >= 0 && ty >= 0 && tx < tw - 1 && ty < th - 1) {
        const x0 = Math.floor(tx);
        const y0 = Math.floor(ty);
        const fx = tx - x0;
        const fy = ty - y0;
        for (let c = 0; c < 3; c++) {
          const p = (yy, xx) => src[(yy * tw + xx) * 4 + c];
          out[i + c] = (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) + (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy;
        }
      } else {
        const [r, g, b] = background(u, v, rng);
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
      }
      out[i + 3] = 255;
    }
  }
  return { data: out, width, height, H };
}

function toCanvas({ data, width, height }) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Поворот на 90° против часовой: так хранится кадр, который при Orientation = 6 показывается повёрнутым по часовой.
function rotateCCW(canvas) {
  const out = createCanvas(canvas.height, canvas.width);
  const ctx = out.getContext("2d");
  ctx.translate(0, canvas.width);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** APP1 Exif с одним тегом Orientation сразу после SOI. */
export function withExifOrientation(jpeg, orientation) {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD0 по смещению 8
    0x00, 0x01, // одна запись
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // следующего IFD нет
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

/** Кадр Y4M (YUV 4:2:0) для --use-file-for-fake-video-capture. */
function toY4M({ data, width, height }, frames = 2) {
  const Y = Buffer.alloc(width * height);
  const U = Buffer.alloc((width / 2) * (height / 2));
  const V = Buffer.alloc((width / 2) * (height / 2));
  for (let i = 0; i < width * height; i++) {
    Y[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width / 2; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * width + x * 2 + dx) * 4;
        r += data[i] / 4;
        g += data[i + 1] / 4;
        b += data[i + 2] / 4;
      }
      U[y * (width / 2) + x] = Math.max(0, Math.min(255, -0.1687 * r - 0.3313 * g + 0.5 * b + 128));
      V[y * (width / 2) + x] = Math.max(0, Math.min(255, 0.5 * r - 0.4187 * g - 0.0813 * b + 128));
    }
  }
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`), ...Array(frames).fill(frame)]);
}

// Чужая картинка: случайные прямоугольники — есть особые точки, но платы нет.
function foreignImage() {
  const canvas = createCanvas(1600, 1200);
  const ctx = canvas.getContext("2d");
  const rng = mulberry(7);
  ctx.fillStyle = "#6b7f8c";
  ctx.fillRect(0, 0, 1600, 1200);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `hsl(${rng() * 360}, 60%, ${30 + rng() * 40}%)`;
    ctx.fillRect(rng() * 1600, rng() * 1200, 10 + rng() * 120, 10 + rng() * 120);
  }
  return canvas;
}

/** Генерирует все файлы в e2e/.scenes; возвращает манифест с истинными углами. */
export async function generateScenes() {
  mkdirSync(OUT, { recursive: true });
  const image = await loadImage(readFileSync(new URL("target.jpg", boardDir)));
  const tc = createCanvas(image.width, image.height);
  tc.getContext("2d").drawImage(image, 0, 0);
  const target = tc.getContext("2d").getImageData(0, 0, image.width, image.height);

  const manifest = { physical, scenes: [] };
  for (const scene of SCENES) {
    const rendered = renderScene(target, scene);
    writeFileSync(new URL(`${scene.name}.jpg`, OUT), toCanvas(rendered).toBuffer("image/jpeg", { quality: 0.92 }));
    manifest.scenes.push({ ...scene, file: `${scene.name}.jpg` });
  }

  const exif = renderScene(target, EXIF_SCENE);
  const stored = rotateCCW(toCanvas(exif)).toBuffer("image/jpeg", { quality: 0.92 });
  writeFileSync(new URL(`${EXIF_SCENE.name}.jpg`, OUT), withExifOrientation(stored, 6));
  manifest.exif = { ...EXIF_SCENE, file: `${EXIF_SCENE.name}.jpg` };

  writeFileSync(new URL("foreign.jpg", OUT), foreignImage().toBuffer("image/jpeg", { quality: 0.9 }));
  manifest.foreign = "foreign.jpg";

  writeFileSync(new URL("camera.y4m", OUT), toY4M(renderScene(target, CAMERA_SCENE)));
  manifest.camera = { ...CAMERA_SCENE, file: "camera.y4m" };

  writeFileSync(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  await generateScenes();
  console.log(`сцены: ${OUT.pathname}`);
}
