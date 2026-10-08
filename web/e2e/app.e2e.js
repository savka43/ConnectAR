// Сценарии интерфейса: порядок шагов в чек-листе, метки на фото и замороженном кадре, фонарик.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyHomography, boardCorners, homographyFromPoints } from "../src/homography.js";
import { rectCorners } from "../src/layout.js";
import { expect, test } from "./fixtures.mjs";

const scenesDir = new URL("./.scenes/", import.meta.url);
const manifest = () => JSON.parse(readFileSync(new URL("manifest.json", scenesDir), "utf8"));
const board = JSON.parse(readFileSync(new URL("../../shared_boards/boards/gigabyte-b450-aorus-m/board.json", import.meta.url), "utf8"));
const scenePath = (file) => fileURLToPath(new URL(file, scenesDir));

async function openApp(page, { done } = {}) {
  if (done) {
    await page.addInitScript(([id, ids]) => {
      localStorage.setItem(`connectar.setup.${id}`, "{}");
      localStorage.setItem(`connectar.progress.${id}`, JSON.stringify(ids));
    }, [board.id, done]);
  }
  await page.goto("index.html");
  if (!done) await page.locator("#setup-done").click();
  await expect(page.locator("#checklist")).toBeVisible();
}

async function uploadPhoto(page, file) {
  await page.locator("[role=tab][data-tab=camera]").click();
  await page.locator("#file-gallery").setInputFiles(scenePath(file));
}

const stepItem = (page, title) => page.locator("#phases li").filter({ has: page.locator(".title", { hasText: title }) });

// Точки снимка (нормированные) → экранные координаты внутри показанного <img>.
async function toScreen(page, points) {
  const box = await page.locator("#photo-view img").boundingBox();
  return points.map(([u, v]) => [box.x + u * box.width, box.y + v * box.height]);
}

async function shapePoints(page, selector) {
  const points = await page.locator(selector).first().getAttribute("points");
  return points.trim().split(/\s+/).map((p) => p.split(",").map(Number));
}

const maxDistance = (a, b) => Math.max(...a.map(([x, y], i) => Math.hypot(x - b[i][0], y - b[i][1])));

test.describe("порядок шагов", () => {
  test("у locked-шага галочка неактивна, подпись — «Сначала: …»", async ({ page }) => {
    await openApp(page);
    const cooler = stepItem(page, "Установить кулер");
    await expect(cooler.locator("input")).toBeDisabled();
    await expect(cooler.locator(".connector")).toHaveText("Сначала: Установить процессор");
    await expect(stepItem(page, "Первый запуск").locator(".connector")).toHaveText(/^Сначала: [^,]+, [^,]+ и ещё \d+$/);

    await stepItem(page, "Установить процессор").locator("input").check();
    await expect(cooler.locator("input")).toBeEnabled();
  });

  test("снятие CPU: подтверждение со списком зависимых, «Да» снимает всё", async ({ page }) => {
    const done = ["cpu", "ram", "cooler", "cpu-fan", "psu", "io-shield", "board-mount", "atx", "cpu-power", "f-panel", "gpu", "first-boot"];
    await openApp(page, { done });
    const cpu = stepItem(page, "Установить процессор").locator("input");

    // «Отмена» возвращает галочку.
    await cpu.uncheck();
    const dialog = page.locator("#uncheck-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#uncheck-list li")).toHaveText([
      "Установить кулер", "Подключить вентилятор кулера", "Первый запуск и проверка в BIOS",
    ]);
    await page.locator("#uncheck-cancel").click();
    await expect(cpu).toBeChecked();

    await cpu.uncheck();
    await page.locator("#uncheck-confirm").click();
    await expect(dialog).toBeHidden();
    for (const title of ["Установить процессор", "Установить кулер", "Подключить вентилятор кулера", "Первый запуск"]) {
      await expect(stepItem(page, title).locator("input")).not.toBeChecked();
    }
    await expect(stepItem(page, "Установить оперативную память").locator("input")).toBeChecked();
  });
});

test.describe("метки на фото", () => {
  // Подсветка текущего шага (сокет CPU) на снимке против истинной гомографии сцены, порог — 1 % диагонали.
  async function expectSocketOnPhoto(page, scene) {
    await expect(page.locator("#fix-corners")).toBeVisible();
    const H = homographyFromPoints(boardCorners(board.physical), scene.corners);
    const socket = board.connectors.find((c) => c.id === "cpu-socket").rectMm;
    const want = rectCorners(socket).map((p) => applyHomography(H, p));
    const got = await shapePoints(page, ".pv-shape.current");
    expect(maxDistance(got, want)).toBeLessThan(Math.hypot(scene.width, scene.height) * 0.01);
    await expect(page.locator(".pv-labels .marker-label.current")).toHaveCount(1);
  }

  test("распознанное фото: метки ложатся на разъёмы", async ({ page }) => {
    await openApp(page);
    const scene = manifest().scenes.find((s) => s.name === "tilt-left");
    await uploadPhoto(page, scene.file);
    await expectSocketOnPhoto(page, scene);
  });

  test("EXIF Orientation = 6: метки на разъёмах, а не на повёрнутой картинке", async ({ page }) => {
    await openApp(page);
    const { exif } = manifest();
    await uploadPhoto(page, exif.file);
    await expectSocketOnPhoto(page, exif);
  });

  test("чужая картинка: разметка по 4 углам, «бантик» — предупреждение", async ({ page }) => {
    await openApp(page);
    await uploadPhoto(page, manifest().foreign);
    const hint = page.locator("#place-hint");
    await expect(hint).toContainText("Плату на фото не нашли. Коснитесь угла платы 1 из 4");

    const square = [[0.25, 0.2], [0.75, 0.2], [0.75, 0.8], [0.25, 0.8]];
    const tap = async (points) => {
      for (const [x, y] of await toScreen(page, points)) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(350);
      }
    };
    await tap([square[0], square[1], square[3], square[2]]);
    await expect(hint).toHaveText("Похоже, углы перепутаны — проверьте порядок");
    await expect(page.locator(".pv-shape")).toHaveCount(0);
    await expect(page.locator("#corners-done")).toBeDisabled();

    await page.locator("#corners-restart").click();
    await tap(square);
    await expect(hint).toHaveText("Перетащите углы, если метки не на месте");
    expect(await page.locator(".pv-shape").count()).toBeGreaterThan(0);
    // Пока правятся углы, тап по разъёму мимо ручек шаг не открывает.
    const shape = await page.locator(".pv-shape").first().boundingBox();
    await page.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.waitForTimeout(350);
    await expect(page.locator("#step-dialog")).toBeHidden();
    await page.locator("#corners-done").click();
    await expect(page.locator("#place-bar")).toBeHidden();
    await expect(page.locator("#fix-corners")).toBeVisible();
  });
});

test("заморозка: включённые вентиляторы появляются на кадре; кнопки фонарика нет", async ({ page }) => {
  await openApp(page);
  await page.locator("[role=tab][data-tab=camera]").click();
  await expect(page.locator("#freeze")).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator("#torch")).toBeHidden();

  await page.locator("#freeze").click();
  await expect(page.locator("#frozen-note")).toBeVisible();
  const before = await page.locator(".pv-shape").count();
  await expect(page.locator(".pv-labels .marker-label", { hasText: "SYS_FAN" })).toHaveCount(0);

  await page.locator("[role=tab][data-tab=assembly]").click();
  await page.locator("#setup-edit").click();
  const fans = page.locator("fieldset", { has: page.locator("legend", { hasText: "Корпусные вентиляторы" }) });
  await fans.getByText("2", { exact: true }).click();
  await page.locator("[role=tab][data-tab=camera]").click();

  await expect(page.locator("#frozen-note")).toBeVisible();
  // Портретный экран обрезает кадр 16:9 по бокам: SYS_FAN2 у правого края платы на снимок не попал — метки нет.
  await expect(page.locator(".pv-shape")).toHaveCount(before + 1);
  await expect(page.locator(".pv-labels .marker-label", { hasText: "SYS_FAN1" })).toHaveCount(1);
  await expect(page.locator(".pv-labels .marker-label", { hasText: "SYS_FAN2" })).toHaveCount(0);
});
