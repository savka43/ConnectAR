#!/usr/bin/env node
// Проверка shared_boards без внешних зависимостей: структура схемы v3, уникальность id, ссылки между сущностями,
// геометрия разъёмов, эталонное фото и общие фикстуры (BoardLayout и план сборки).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COUNT = /^(0|[1-9][0-9]*)$/;
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

const isText = (v) => typeof v === "string" && v.length > 0;
const requireText = (where, obj, key) => {
  if (!isText(obj?.[key])) fail(where, `поле "${key}" должно быть непустой строкой`);
};
const optionalText = (where, obj, key) => {
  if (obj?.[key] !== undefined && !isText(obj[key])) fail(where, `поле "${key}" должно быть непустой строкой`);
};

const collectIds = (where, items, { allowEmpty = false } = {}) => {
  const ids = new Set();
  if (!Array.isArray(items) || (!allowEmpty && items.length === 0)) {
    fail(where, allowEmpty ? "должен быть массивом" : "должен быть непустым массивом");
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

// ——— Эталонная реализация плана сборки (shared_boards/README.md, «План сборки») ———
// Клиенты реализуют те же правила и проверяются фикстурами fixtures/plan-cases.json.

const STEP_FIELDS = ["title", "connectorIds", "cableIds", "instruction", "substeps", "warning"];

export function normalizeAnswers(board, answers = {}) {
  const result = {};
  for (const q of board.setup) {
    const value = answers[q.id];
    result[q.id] = q.options.some((o) => o.id === value) ? value : q.default;
  }
  return result;
}

export const matches = (when, answers) => !when || Object.entries(when).every(([q, ids]) => ids.includes(answers[q]));

export function resolvePlan(board, rawAnswers) {
  const answers = normalizeAnswers(board, rawAnswers);
  const names = new Map(board.connectors.map((c) => [c.id, c.name]));
  const cursors = new Map();
  const plan = [];
  for (const step of board.steps) {
    if (!matches(step.when, answers)) continue;
    const variant = step.variants?.find((v) => matches(v.when, answers)) ?? {};
    const fields = Object.fromEntries(STEP_FIELDS.map((k) => [k, variant[k] ?? step[k]]));
    const count = step.repeat ? Number(answers[step.repeat]) : 1;
    for (let n = 1; n <= count; n++) {
      const connectorIds = [...(fields.connectorIds ?? [])];
      let port = "—";
      if (step.pool) {
        const pool = board.pools?.[step.pool] ?? [];
        const index = cursors.get(step.pool) ?? 0;
        cursors.set(step.pool, index + 1);
        if (index < pool.length) {
          connectorIds.push(pool[index]);
          port = names.get(pool[index]);
        }
      }
      const fill = (s) => s.replaceAll("{n}", String(n)).replaceAll("{port}", port);
      plan.push({
        id: step.repeat ? `${step.id}-${n}` : step.id,
        stepId: step.id,
        phaseId: step.phaseId,
        title: fill(fields.title),
        icons: step.icons ?? {},
        connectorIds,
        cableIds: fields.cableIds ?? [],
        instruction: fill(fields.instruction),
        substeps: (fields.substeps ?? []).map(fill),
        warning: fields.warning ? fill(fields.warning) : null,
        manualPage: step.manualPage ?? null,
      });
    }
  }
  return plan;
}

export function resolveCable(cable, rawAnswers, board) {
  const answers = board ? normalizeAnswers(board, rawAnswers) : rawAnswers;
  const variant = cable.variants?.find((v) => matches(v.when, answers)) ?? {};
  return {
    id: cable.id,
    name: cable.name,
    deviceSide: cable.deviceSide,
    psuSide: variant.psuSide ?? cable.psuSide ?? null,
    warning: variant.warning ?? cable.warning ?? null,
  };
}

// ——— Проверка платы ———

function checkWhen(where, when, questions) {
  if (when === undefined) return;
  if (typeof when !== "object" || when === null || Object.keys(when).length === 0) {
    fail(where, "when должен быть непустым объектом");
    return;
  }
  for (const [qid, ids] of Object.entries(when)) {
    const q = questions.get(qid);
    if (!q) fail(where, `when ссылается на неизвестный вопрос "${qid}"`);
    else if (!Array.isArray(ids) || ids.length === 0) fail(where, `when.${qid} должен быть непустым массивом`);
    else for (const id of ids) if (!q.options.some((o) => o.id === id)) fail(where, `when.${qid}: у вопроса нет варианта "${id}"`);
  }
}

function checkStepFields(where, fields, ctx) {
  for (const key of ["title", "instruction", "warning"]) optionalText(where, fields, key);
  for (const [key, known, needRect] of [["connectorIds", ctx.connectors, true], ["cableIds", ctx.cables, false]]) {
    const ids = fields[key];
    if (ids === undefined) continue;
    if (!Array.isArray(ids)) {
      fail(where, `${key} должен быть массивом`);
      continue;
    }
    if (new Set(ids).size !== ids.length) fail(where, `${key} содержит повторы`);
    for (const id of ids) {
      if (!known.has(id)) fail(where, `${key}: неизвестный id "${id}"`);
      else if (needRect && !known.get(id).rectMm) fail(where, `у разъёма "${id}" нет rectMm`);
    }
  }
  if (fields.substeps !== undefined && (!Array.isArray(fields.substeps) || !fields.substeps.every(isText))) {
    fail(where, "substeps должен быть массивом непустых строк");
  }
}

function checkBoard(file, board, boardId) {
  if (board.schemaVersion !== 3) fail(file, "schemaVersion должен быть 3");
  if (board.id !== boardId) fail(file, `id "${board.id}" не совпадает с папкой "${boardId}"`);
  requireText(file, board, "name");
  try { new URL(board.manualURL); } catch { fail(file, "manualURL не является URL"); }
  const physical = isPositive(board.physical?.widthMm) && isPositive(board.physical?.heightMm) ? board.physical : null;
  if (!physical) fail(file, "physical.widthMm и physical.heightMm должны быть числами > 0");
  checkTarget(file, board, join(root, "boards", boardId));

  // Опрос
  collectIds(`${file} setup`, board.setup);
  const questions = new Map();
  (board.setup ?? []).forEach((q, i) => {
    const at = `${file} setup[${i}]`;
    requireText(at, q, "title");
    collectIds(`${at} options`, q.options);
    if (Array.isArray(q.options) && q.options.length < 2) fail(at, "нужно минимум два варианта ответа");
    (q.options ?? []).forEach((o, k) => requireText(`${at} options[${k}]`, o, "title"));
    if (!(q.options ?? []).some((o) => o.id === q.default)) fail(at, `default "${q.default}" не входит в варианты`);
    if (Array.isArray(q.options)) questions.set(q.id, q);
  });

  // Этапы, разъёмы, пулы, кабели
  const phaseIds = collectIds(`${file} phases`, board.phases);
  (board.phases ?? []).forEach((p, i) => requireText(`${file} phases[${i}]`, p, "title"));
  const phaseOrder = new Map((board.phases ?? []).map((p, i) => [p.id, i]));

  collectIds(`${file} connectors`, board.connectors);
  const connectors = new Map((board.connectors ?? []).map((c) => [c.id, c]));
  (board.connectors ?? []).forEach((c, i) => {
    const at = `${file} connectors[${i}]`;
    requireText(at, c, "name");
    optionalText(at, c, "hint");
    checkRect(at, c.rectMm, physical);
  });

  const pools = board.pools ?? {};
  for (const [poolId, ids] of Object.entries(pools)) {
    const at = `${file} pools.${poolId}`;
    if (!ID.test(poolId)) fail(at, "некорректный id пула");
    if (!Array.isArray(ids) || ids.length === 0) {
      fail(at, "должен быть непустым массивом");
      continue;
    }
    if (new Set(ids).size !== ids.length) fail(at, "содержит повторы");
    for (const id of ids) {
      if (!connectors.has(id)) fail(at, `неизвестный разъём "${id}"`);
      else if (!connectors.get(id).rectMm) fail(at, `у разъёма "${id}" нет rectMm`);
    }
  }

  collectIds(`${file} cables`, board.cables ?? [], { allowEmpty: true });
  const cables = new Map((board.cables ?? []).map((c) => [c.id, c]));
  (board.cables ?? []).forEach((c, i) => {
    const at = `${file} cables[${i}]`;
    requireText(at, c, "name");
    requireText(at, c, "deviceSide");
    optionalText(at, c, "psuSide");
    optionalText(at, c, "warning");
    (c.variants ?? []).forEach((v, k) => {
      const vat = `${at} variants[${k}]`;
      if (v.when === undefined) fail(vat, "нужно поле when");
      checkWhen(vat, v.when, questions);
      optionalText(vat, v, "psuSide");
      optionalText(vat, v, "warning");
    });
  });

  // Шаги
  const stepIds = collectIds(`${file} steps`, board.steps);
  const ctx = { connectors, cables };
  const poolDemand = new Map();
  let lastPhase = -1;
  (board.steps ?? []).forEach((s, i) => {
    const at = `${file} steps[${i}] (${s.id})`;
    requireText(at, s, "title");
    requireText(at, s, "instruction");
    if (!phaseIds.has(s.phaseId)) fail(at, `неизвестный phaseId "${s.phaseId}"`);
    else {
      const order = phaseOrder.get(s.phaseId);
      if (order < lastPhase) fail(at, "шаги должны идти в порядке этапов из phases");
      lastPhase = Math.max(lastPhase, order);
    }
    if (s.manualPage !== undefined && (!Number.isInteger(s.manualPage) || s.manualPage < 1)) fail(at, "manualPage должен быть целым ≥ 1");
    checkWhen(at, s.when, questions);
    checkStepFields(at, s, ctx);

    let maxCount = 1;
    if (s.repeat !== undefined) {
      const q = questions.get(s.repeat);
      if (!q) fail(at, `repeat ссылается на неизвестный вопрос "${s.repeat}"`);
      else if (!q.options.every((o) => COUNT.test(o.id))) fail(at, `у вопроса "${s.repeat}" варианты должны быть числами`);
      else {
        maxCount = Math.max(...q.options.map((o) => Number(o.id)));
        for (let n = 1; n <= maxCount; n++) {
          if (stepIds.has(`${s.id}-${n}`)) fail(at, `id повтора "${s.id}-${n}" совпадает с id другого шага`);
        }
      }
    }
    if (s.pool !== undefined) {
      if (!pools[s.pool]) fail(at, `неизвестный пул "${s.pool}"`);
      else poolDemand.set(s.pool, (poolDemand.get(s.pool) ?? 0) + maxCount);
    }
    const texts = [s.title, s.instruction, s.warning, ...(s.substeps ?? []),
      ...(s.variants ?? []).flatMap((v) => [v.title, v.instruction, v.warning, ...(v.substeps ?? [])])].filter(isText);
    if (!s.pool && texts.some((t) => t.includes("{port}"))) fail(at, "{port} используется без pool");
    if (!s.repeat && texts.some((t) => t.includes("{n}"))) fail(at, "{n} используется без repeat");

    (s.variants ?? []).forEach((v, k) => {
      const vat = `${at} variants[${k}]`;
      if (v.when === undefined) fail(vat, "нужно поле when");
      checkWhen(vat, v.when, questions);
      const extra = Object.keys(v).filter((key) => key !== "when" && !STEP_FIELDS.includes(key));
      if (extra.length) fail(vat, `вариант не может переопределять ${extra.join(", ")}`);
      checkStepFields(vat, v, ctx);
    });
  });

  for (const [poolId, demand] of poolDemand) {
    const size = pools[poolId].length;
    if (demand > size) fail(`${file} pools.${poolId}`, `повторяющимся шагам может понадобиться ${demand} разъёмов, в пуле ${size}`);
  }

  // План по умолчанию должен быть непустым и без пустых текстов.
  if (errors.length === 0) {
    const plan = resolvePlan(board, {});
    if (plan.length === 0) fail(file, "план по умолчанию пуст");
  }
}

// ——— Фикстуры ———

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

// Фикстуры плана: мини-плата + ответы → ожидаемые шаги и кабели.
const checkPlanFixtures = (file) => {
  const fixtures = readJSON(join(root, file));
  if (!fixtures) return;
  const { board } = fixtures;
  if (!board || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
    fail(file, "нужны board и непустой cases");
    return;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  fixtures.cases.forEach((c, i) => {
    const at = `${file} cases[${i}] (${c.name})`;
    const plan = resolvePlan(board, c.answers).map((s) => ({
      id: s.id, phaseId: s.phaseId, title: s.title, connectorIds: s.connectorIds, cableIds: s.cableIds,
      instruction: s.instruction, substeps: s.substeps, warning: s.warning,
    }));
    if (!same(plan, c.expected?.steps)) fail(at, `steps: получено ${JSON.stringify(plan)}`);
    for (const [cableId, want] of Object.entries(c.expected?.cables ?? {})) {
      const cable = board.cables.find((x) => x.id === cableId);
      const got = cable && resolveCable(cable, c.answers, board);
      if (!same(got && { psuSide: got.psuSide, warning: got.warning }, want)) fail(at, `cables.${cableId}: получено ${JSON.stringify(got)}`);
    }
  });
};

// ——— Запуск ———

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const index = readJSON(join(root, "index.json"));
  const boardIds = index?.boards ?? [];
  if (!Array.isArray(boardIds) || boardIds.length === 0) fail("index.json", "список boards пуст");

  for (const boardId of boardIds) {
    const file = join("boards", boardId, "board.json");
    const board = readJSON(join(root, file));
    if (board) checkBoard(file, board, boardId);
  }

  checkLayoutFixtures(join("fixtures", "layout-cases.json"));
  checkPlanFixtures(join("fixtures", "plan-cases.json"));

  if (errors.length) {
    console.error(errors.map((e) => `✗ ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`✓ shared_boards: ${boardIds.length} плат(ы) прошли проверку`);
}
