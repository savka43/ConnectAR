#!/usr/bin/env node
// Проверка shared_boards без внешних зависимостей: структура, уникальность id и ссылки между сущностями.
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

const checkRegion = (where, r) => {
  if (r === undefined) return;
  for (const k of ["x", "y", "width", "height"]) {
    if (typeof r[k] !== "number" || r[k] < 0 || r[k] > 1) fail(where, `region.${k} должен быть числом 0…1`);
  }
  if (r.x + r.width > 1 || r.y + r.height > 1) fail(where, "region выходит за границы фото");
};

const index = readJSON(join(root, "index.json"));
const boardIds = index?.boards ?? [];
if (!Array.isArray(boardIds) || boardIds.length === 0) fail("index.json", "список boards пуст");

for (const boardId of boardIds) {
  const file = join("boards", boardId, "board.json");
  const board = readJSON(join(root, file));
  if (!board) continue;

  if (board.schemaVersion !== 1) fail(file, "schemaVersion должен быть 1");
  if (board.id !== boardId) fail(file, `id "${board.id}" не совпадает с папкой "${boardId}"`);
  requireString(file, board, "name");
  try { new URL(board.manualURL); } catch { fail(file, "manualURL не является URL"); }

  const components = collectIds(`${file} components`, board.components);
  const connectors = collectIds(`${file} connectors`, board.connectors);
  collectIds(`${file} steps`, board.steps);

  (board.components ?? []).forEach((c, i) => requireString(`${file} components[${i}]`, c, "name"));
  (board.connectors ?? []).forEach((c, i) => {
    const at = `${file} connectors[${i}]`;
    requireString(at, c, "name");
    if (!components.has(c.componentId)) fail(at, `неизвестный componentId "${c.componentId}"`);
    checkRegion(at, c.region);
  });
  (board.steps ?? []).forEach((s, i) => {
    const at = `${file} steps[${i}]`;
    requireString(at, s, "title");
    requireString(at, s, "instruction");
    if (!connectors.has(s.connectorId)) fail(at, `неизвестный connectorId "${s.connectorId}"`);
    if (!Number.isInteger(s.manualPage) || s.manualPage < 1) fail(at, "manualPage должен быть целым ≥ 1");
  });

  const hasRegions = (board.connectors ?? []).some((c) => c.region);
  if (hasRegions && !existsSync(join(root, "boards", boardId, "targets", "board.jpg"))) {
    fail(file, "у разъёмов есть region, но нет эталонного фото targets/board.jpg");
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ shared_boards: ${boardIds.length} плат(ы) прошли проверку`);
