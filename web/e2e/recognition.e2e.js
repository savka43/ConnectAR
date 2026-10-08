// Распознавание платы на фото: сцены с известной гомографией, EXIF-поворот, чужая картинка, память TF.js.
import { readFileSync } from "node:fs";
import { BOARD_DIR, SCENES_URL, expect, test } from "./fixtures.mjs";

const manifest = () => JSON.parse(readFileSync(new URL("./.scenes/manifest.json", import.meta.url), "utf8"));

// В браузере: распознать файл сцены, вернуть углы платы в пикселях показанного (повёрнутого) снимка.
async function recognize(page, file, freshTarget = false) {
  return page.evaluate(async ({ file, scenes, boardDir, freshTarget }) => {
    const { loadOrientedImage, recognizeBoard } = await import("./src/photo-recognition.js");
    const { loadTarget } = await import("./src/ar.js");
    const { applyHomography, boardCorners, seededRandom } = await import("./src/homography.js");
    const board = await (await fetch(`${boardDir}board.json`)).json();
    const target = freshTarget
      ? await (await fetch(`${boardDir}targets.mind`)).arrayBuffer()
      : await loadTarget(`${boardDir}targets.mind`);
    const image = await loadOrientedImage(await (await fetch(`${scenes}${file}`)).blob());
    try {
      const started = performance.now();
      const result = await recognizeBoard(image, target, board.physical, { rng: seededRandom(1) });
      const ms = Math.round(performance.now() - started);
      const size = [image.width, image.height];
      if (!result) return { found: false, size, ms };
      const corners = boardCorners(board.physical)
        .map((p) => applyHomography(result.homography, p))
        .map(([u, v]) => [u * size[0], v * size[1]]);
      return { found: true, size, corners, pairs: result.pairs, inliers: result.inliers, ms };
    } finally {
      image.close?.();
    }
  }, { file, scenes: SCENES_URL, boardDir: BOARD_DIR, freshTarget });
}

const cornerError = (got, want) => Math.max(...want.map(([x, y], i) => Math.hypot(got[i][0] - x, got[i][1] - y)));

test.beforeEach(async ({ page }) => {
  await page.goto("index.html");
});

test("сцены в перспективе: углы платы с точностью ≤ 1 % диагонали", async ({ page }) => {
  const report = [];
  for (const scene of manifest().scenes) {
    const r = await recognize(page, scene.file);
    const diagonal = Math.hypot(scene.width, scene.height);
    const error = r.found ? cornerError(r.corners, scene.corners) : Infinity;
    report.push({ scene: scene.name, found: r.found, errorPx: +error.toFixed(1), errorPct: +(error / diagonal * 100).toFixed(2), pairs: r.pairs, inliers: r.inliers, ms: r.ms });
  }
  console.table(report);
  for (const row of report) expect.soft(row.errorPct, row.scene).toBeLessThanOrEqual(1);
});

test("JPEG с EXIF Orientation = 6: углы в координатах повёрнутого снимка", async ({ page }) => {
  const { exif } = manifest();
  const r = await recognize(page, exif.file);
  expect(r.size).toEqual([exif.width, exif.height]);
  expect(r.found).toBe(true);
  expect(cornerError(r.corners, exif.corners) / Math.hypot(exif.width, exif.height)).toBeLessThanOrEqual(0.01);
});

test("чужая картинка — плата не найдена", async ({ page }) => {
  const r = await recognize(page, manifest().foreign);
  expect(r.found).toBe(false);
});

test("смена буфера эталона: число тензоров TF.js не растёт", async ({ page }) => {
  const { scenes } = manifest();
  const counts = [];
  for (let i = 0; i < 5; i++) {
    await recognize(page, scenes[i % scenes.length].file, true);
    counts.push(await page.evaluate(() => globalThis._tfengine.memory().numTensors));
  }
  console.log("numTensors после каждого фото:", counts.join(", "));
  expect(Math.max(...counts.slice(1))).toBeLessThanOrEqual(counts[0]);
});

test("общий контроллер: последовательные и параллельные фото без роста тензоров", async ({ page }) => {
  await page.evaluate(async () => {
    const { MINDAR_IMAGE_SRC } = await import("./src/photo-recognition.js");
    const { Controller } = await import(MINDAR_IMAGE_SRC);
    const add = Controller.prototype.addImageTargetsFromBuffer;
    globalThis.targetImports = 0;
    Controller.prototype.addImageTargetsFromBuffer = function (...args) {
      globalThis.targetImports++;
      return add.apply(this, args);
    };
  });
  const scenes = manifest().scenes;
  const check = (r, scene) => {
    expect(r.found).toBe(true);
    expect(cornerError(r.corners, scene.corners) / Math.hypot(scene.width, scene.height)).toBeLessThanOrEqual(0.01);
  };
  check(await recognize(page, scenes[0].file), scenes[0]);
  const baseline = await page.evaluate(() => globalThis._tfengine.memory().numTensors);
  for (const scene of scenes.slice(1, 4)) {
    check(await recognize(page, scene.file), scene);
    expect(await page.evaluate(() => globalThis._tfengine.memory().numTensors)).toBe(baseline);
  }
  // Запросы стартуют вместе и используют один и тот же буфер loadTarget.
  const concurrent = scenes.slice(-2);
  const results = await Promise.all(concurrent.map((scene) => recognize(page, scene.file)));
  results.forEach((r, i) => check(r, concurrent[i]));
  expect(await page.evaluate(() => globalThis._tfengine.memory().numTensors)).toBe(baseline);
  expect(await page.evaluate(() => globalThis.targetImports)).toBe(1);
});
