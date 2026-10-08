// Логика меток: состояние шагов плана и разъёмов, текст метки, попадание тапа.

/** stepId → "current" | "done" | "pending"; current — первый невыполненный шаг плана. */
export function stepStates(plan, done) {
  const states = new Map();
  let currentFound = false;
  for (const step of plan) {
    if (done.has(step.id)) states.set(step.id, "done");
    else if (!currentFound) {
      states.set(step.id, "current");
      currentFound = true;
    } else states.set(step.id, "pending");
  }
  return states;
}

/** Текущий шаг плана или null, если всё выполнено. */
export function currentStep(plan, done) {
  return plan.find((s) => !done.has(s.id)) ?? null;
}

/**
 * Разъёмы, на которые ссылаются шаги плана, с состоянием и шагом, который откроется по тапу.
 * Если на разъём ссылается несколько шагов: current, если среди них есть текущий; done, если все выполнены.
 */
export function connectorStates(board, plan, done) {
  const states = stepStates(plan, done);
  const result = [];
  for (const connector of board.connectors) {
    const steps = plan.filter((s) => s.connectorIds.includes(connector.id));
    if (steps.length === 0) continue;
    const stepStatesOf = steps.map((s) => states.get(s.id));
    const state = stepStatesOf.includes("current") ? "current"
      : stepStatesOf.every((s) => s === "done") ? "done" : "pending";
    const step = steps.find((s) => states.get(s.id) === "current")
      ?? steps.find((s) => states.get(s.id) === "pending")
      ?? steps[0];
    result.push({ connector, step, state });
  }
  return result;
}

/** Текст метки: имя разъёма, у текущего шага — с подсказкой («DDR4_2 · 2-й от CPU»). */
export function labelText(connector, state) {
  return state === "current" && connector.hint ? `${connector.name} · ${connector.hint}` : connector.name;
}

/** Позиция метки шириной width × height с центром в (x, y), прижатая внутрь области w × h. */
export function clampLabel([x, y], [width, height], [w, h], margin = 4) {
  const clamp = (v, half, max) => Math.min(Math.max(v, half + margin), Math.max(half + margin, max - half - margin));
  return [clamp(x, width / 2, w), clamp(y, height / 2, h)];
}

/** Точка внутри многоугольника (ray casting); точки — [x, y]. */
export function pointInPolygon([px, py], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Метка под точкой: сначала многоугольники (замороженный кадр), затем ближайший центр в радиусе.
 * При перекрытии выигрывает текущий шаг, затем меньший по площади многоугольник.
 */
export function hitTest(markers, point, radius = 0) {
  const order = { current: 0, pending: 1, done: 2 };
  const hits = markers
    .filter((m) => m.polygon && pointInPolygon(point, m.polygon))
    .sort((a, b) => order[a.state] - order[b.state] || polygonArea(a.polygon) - polygonArea(b.polygon));
  if (hits.length) return hits[0];

  let best = null;
  let bestDistance = radius;
  for (const m of markers) {
    const d = Math.hypot(m.center[0] - point[0], m.center[1] - point[1]);
    if (d <= bestDistance) {
      best = m;
      bestDistance = d;
    }
  }
  return best;
}

export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return Math.abs(sum) / 2;
}
