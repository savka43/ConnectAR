#!/usr/bin/env node
// Проверка shared_boards без внешних зависимостей: структура, уникальность id, ссылки между сущностями,
// геометрия разъёмов, эталонное фото и общие фикстуры BoardLayout.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const readJSON = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(path, e.message);
    return null;
  }
};

const requireString = (where, obj, key) => {
  if (typeof obj?.[key] !== "string" || obj[key].length === 0) fail(where, `поле "${key}" должно быть непустой строкой`);
};

const collectIds = (where, items) => {
  const ids = new Set();
  if (!Array.isArray(items) || items.length === 0) {
    fail(where, "должен быть непустым массивом");
    return ids;
  }
  items.forEach((item, i) => {
    const at = `${where}[${i}]`;
    if (!ID.test(item?.id ?? "")) fail(at, `некорректный id "${item?.id}"`);
    else if (ids.has(item.id)) fail(at, `повторяющийся id "${item.id}"`);
    ids.add(item?.id);
  });
  return ids;
};

const isPositive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

const checkRect = (where, r, physical) => {
  if (r === undefined) return;
  for (const k of ["x", "y"]) if (typeof r[k] !== "number" || r[k] < 0) fail(where, `rectMm.${k} должен быть числом ≥ 0`);
  for (const k of ["w", "h"]) if (!isPositive(r[k])) fail(where, `rectMm.${k} должен быть числом > 0`);
  if (physical && (r.x + r.w > physical.widthMm || r.y + r.h > physical.heightMm)) fail(where, "rectMm выходит за границы платы");
};

// Размер JPEG из маркера SOF, без декодирования.
const jpegSize = (path) => {
  const b = readFileSync(path);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const length = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
};

const checkTarget = (where, board, boardDir) => {
  if (board.target === undefined) return;
  const image = board.target?.image;
  if (typeof image !== "string" || !/^[^/]+\.jpe?g$/.test(image)) {
    fail(where, "target.image должен быть именем .jpg-файла в папке платы");
    return;
  }
  const path = join(boardDir, image);
  if (!existsSync(path)) {
    fail(where, `нет эталонного фото ${image}`);
    return;
  }
  const size = jpegSize(path);
  if (!size) {
    fail(where, `${image} не похож на JPEG`);
    return;
  }
  const { widthMm, heightMm } = board.physical ?? {};
  if (!isPositive(widthMm) || !isPositive(heightMm)) return;
  const deviation = Math.abs(size.width / size.height / (widthMm / heightMm) - 1);
  if (deviation > 0.03) {
    fail(where, `пропорции ${image} (${size.width}×${size.height}) отличаются от physical на ${(deviation * 100).toFixed(1)} % (допуск 3 %)`);
  }
};

// Эталонная реализация формул из docs/design-doc.md, раздел «Перевод в координаты якоря».
const checkLayoutFixtures = (file) => {
  const fixtures = readJSON(join(root, file));
  if (!fixtures) return;
  const tolerance = fixtures.tolerance ?? 1e-6;
  if (!Array.isArray(fixtures.cases) || fixtures.cases.length === 0) fail(file, "cases должен быть непустым массивом");
  (fixtures.cases ?? []).forEach((c, i) => {
    const at = `${file} cases[${i}]`;
    const { widthMm: W, heightMm: H } = c.physical ?? {};
    const { x, y, w, h } = c.rectMm ?? {};
    if (![W, H, w, h].every(isPositive) || typeof x !== "number" || typeof y !== "number") {
      fail(at, "некорректные physical или rectMm");
      return;
    }
    const offset = (px, pz) => [px - W / 2, pz - H / 2];
    const [dx, dz] = offset(x + w / 2, y + h / 2);
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, pz]) => offset(px, pz));
    const expected = c.expected ?? {};
    const actual = [
      ["offsetMm", [expected.offsetMm?.dx, expected.offsetMm?.dz], [dx, dz]],
      ["anchorM", expected.anchorM, [dx / 1000, 0, dz / 1000]],
      ["cornersM", expected.cornersM?.flat(), corners.flatMap(([a, b]) => [a / 1000, 0, b / 1000])],
      ["web.center", expected.web?.center, [dx / W, -dz / W, 0]],
      ["web.corners", expected.web?.corners?.flat(), corners.flatMap(([a, b]) => [a / W, -b / W, 0])],
    ];
    for (const [name, want, got] of actual) {
      const ok = Array.isArray(want) && want.length === got.length && want.every((v, k) => Math.abs(v - got[k]) <= tolerance);
      if (!ok) fail(at, `${name}: ожидалось ${JSON.stringify(got)}, в фикстуре ${JSON.stringify(want)}`);
    }
  });
};

const index = readJSON(join(root, "index.json"));
const boardIds = index?.boards ?? [];
if (!Array.isArray(boardIds) || boardIds.length === 0) fail("index.json", "список boards пуст");

for (const boardId of boardIds) {
  const file = join("boards", boardId, "board.json");
  const board = readJSON(join(root, file));
  if (!board) continue;

  if (board.schemaVersion !== 2) fail(file, "schemaVersion должен быть 2");
  if (board.id !== boardId) fail(file, `id "${board.id}" не совпадает с папкой "${boardId}"`);
  requireString(file, board, "name");
  try { new URL(board.manualURL); } catch { fail(file, "manualURL не является URL"); }
  const physical = isPositive(board.physical?.widthMm) && isPositive(board.physical?.heightMm) ? board.physical : null;
  if (!physical) fail(file, "physical.widthMm и physical.heightMm должны быть числами > 0");
  checkTarget(file, board, join(root, "boards", boardId));

  const components = collectIds(`${file} components`, board.components);
  collectIds(`${file} connectors`, board.connectors);
  collectIds(`${file} steps`, board.steps);

  (board.components ?? []).forEach((c, i) => requireString(`${file} components[${i}]`, c, "name"));
  (board.connectors ?? []).forEach((c, i) => {
    const at = `${file} connectors[${i}]`;
    requireString(at, c, "name");
    if (!components.has(c.componentId)) fail(at, `неизвестный componentId "${c.componentId}"`);
    checkRect(at, c.rectMm, physical);
  });
  (board.steps ?? []).forEach((s, i) => {
    const at = `${file} steps[${i}]`;
    requireString(at, s, "title");
    requireString(at, s, "instruction");
    const connector = (board.connectors ?? []).find((c) => c.id === s.connectorId);
    if (!connector) fail(at, `неизвестный connectorId "${s.connectorId}"`);
    else if (!connector.rectMm) fail(at, `у разъёма "${s.connectorId}" нет rectMm`);
    if (!Number.isInteger(s.manualPage) || s.manualPage < 1) fail(at, "manualPage должен быть целым ≥ 1");
  });
}

checkLayoutFixtures(join("fixtures", "layout-cases.json"));

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ shared_boards: ${boardIds.length} плат(ы) прошли проверку`);
