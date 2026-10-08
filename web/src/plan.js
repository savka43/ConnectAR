// План сборки: board.json + ответы опроса → список конкретных шагов.
// Правила — shared_boards/README.md, «План сборки»; проверяются общими фикстурами shared_boards/fixtures/plan-cases.json.

const STEP_FIELDS = ["title", "connectorIds", "cableIds", "instruction", "substeps", "warning"];

/** Ответы по умолчанию для всех вопросов опроса. */
export function defaultAnswers(board) {
  return Object.fromEntries(board.setup.map((q) => [q.id, q.default]));
}

/** Неизвестные вопросы отбрасываются, отсутствующие и неизвестные ответы заменяются default. */
export function normalizeAnswers(board, answers = {}) {
  const result = {};
  for (const q of board.setup) {
    const value = answers?.[q.id];
    result[q.id] = q.options.some((o) => o.id === value) ? value : q.default;
  }
  return result;
}

export const matches = (when, answers) => !when || Object.entries(when).every(([q, ids]) => ids.includes(answers[q]));

/**
 * @returns {Array<{id, stepId, phaseId, title, icons, connectorIds, cableIds, instruction, substeps, warning, manualPage, requires}>}
 */
export function resolvePlan(board, rawAnswers) {
  const answers = normalizeAnswers(board, rawAnswers);
  const names = new Map(board.connectors.map((c) => [c.id, c.name]));
  const cursors = new Map();
  const planIds = new Map(); // id шага → id его экземпляров в плане
  const plan = [];
  for (const step of board.steps) {
    if (!matches(step.when, answers)) continue;
    // requires ссылается только на шаги выше, поэтому их экземпляры уже известны.
    const requires = (step.requires ?? []).flatMap((id) => planIds.get(id) ?? []);
    planIds.set(step.id, []);
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
      const id = step.repeat ? `${step.id}-${n}` : step.id;
      planIds.get(step.id).push(id);
      plan.push({
        id,
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
        requires,
      });
    }
  }
  return plan;
}

/** Невыполненные шаги из requires — пока они есть, шаг заблокирован. */
export function unmetRequires(step, done) {
  return (step.requires ?? []).filter((id) => !done.has(id));
}

/**
 * Отмеченные шаги плана, которые зависят от stepId напрямую или через другие шаги, в порядке плана.
 * Их отметки снимаются вместе с отметкой stepId.
 */
export function doneDependents(plan, done, stepId) {
  const affected = new Set([stepId]);
  const result = [];
  for (const step of plan) {
    // requires указывает только на шаги выше, поэтому одного прохода по плану достаточно.
    if (step.id === stepId || !(step.requires ?? []).some((id) => affected.has(id))) continue;
    affected.add(step.id);
    if (done.has(step.id)) result.push(step);
  }
  return result;
}

/** Подпись заблокированного шага: «Сначала: A, B и ещё 3»; до трёх шагов перечисляются все. */
export function requiresHint(plan, step, done, limit = 2) {
  const titles = new Map(plan.map((s) => [s.id, s.title]));
  const names = unmetRequires(step, done).map((id) => titles.get(id)).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length <= limit + 1) return `Сначала: ${names.join(", ")}`;
  return `Сначала: ${names.slice(0, limit).join(", ")} и ещё ${names.length - limit}`;
}

/** Кабель с учётом ответов (тип БП): psuSide и warning из первого подходящего варианта. */
export function resolveCable(board, cable, rawAnswers) {
  const answers = normalizeAnswers(board, rawAnswers);
  const variant = cable.variants?.find((v) => matches(v.when, answers)) ?? {};
  return {
    id: cable.id,
    name: cable.name,
    deviceSide: cable.deviceSide,
    psuSide: variant.psuSide ?? cable.psuSide ?? null,
    warning: variant.warning ?? cable.warning ?? null,
  };
}

/** Краткое описание ответов для свёрнутого опроса: «2 модуля · NVMe SSD (M.2): Есть · …». */
export function answersSummary(board, answers) {
  return board.setup.map((q) => {
    const option = q.options.find((o) => o.id === answers[q.id]);
    return `${q.title}: ${option?.title ?? "—"}`;
  }).join(" · ");
}
