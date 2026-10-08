// Логика меток: состояние шагов плана и разъёмов, склейка и раскладка подписей, попадание тапа.
import { unmetRequires } from "./plan.js";

const STATE_RANK = { current: 0, pending: 1, done: 2 };
const LABEL_GAP = 4;
const HYSTERESIS_FRAMES = 3;

/**
 * stepId → "current" | "done" | "pending" | "locked". current — первый невыполненный шаг плана;
 * locked — невыполненный шаг, у которого выполнено не всё из requires. Приоритет: done > current > locked > pending.
 */
export function stepStates(plan, done) {
  const states = new Map();
  let currentFound = false;
  for (const step of plan) {
    if (done.has(step.id)) states.set(step.id, "done");
    else if (!currentFound) {
      states.set(step.id, "current");
      currentFound = true;
    } else states.set(step.id, unmetRequires(step, done).length ? "locked" : "pending");
  }
  return states;
}

/** Текущий шаг плана или null, если всё выполнено. */
export function currentStep(plan, done) {
  return plan.find((s) => !done.has(s.id)) ?? null;
}

/**
 * Разъёмы, на которые ссылаются шаги плана, с состоянием и шагом, который откроется по тапу.
 * Заблокированные шаги не учитываются: разъём только locked-шагов не попадает в список.
 * Если шагов несколько: current, если среди них есть текущий; done, если все выполнены.
 * order — позиция выбранного шага в плане.
 */
export function connectorStates(board, plan, done) {
  const states = stepStates(plan, done);
  const result = [];
  for (const connector of board.connectors) {
    const steps = plan.filter((s) => s.connectorIds.includes(connector.id) && states.get(s.id) !== "locked");
    if (steps.length === 0) continue;
    const stepStatesOf = steps.map((s) => states.get(s.id));
    const state = stepStatesOf.includes("current") ? "current"
      : stepStatesOf.every((s) => s === "done") ? "done" : "pending";
    const step = steps.find((s) => states.get(s.id) === "current")
      ?? steps.find((s) => states.get(s.id) === "pending")
      ?? steps[0];
    result.push({ connector, step, state, order: plan.indexOf(step) });
  }
  return result;
}

const byPriority = (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.order - b.order || compareIds(a.id, b.id);
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Метки на плате (только разъёмы с rectMm):
 * 1) разъёмы locked-шагов уже отброшены в connectorStates;
 * 2) разъёмы с одинаковым rectMm склеиваются в одну метку «SATA3 0 / SATA3 1» — состояние, шаг и hint
 *    берутся у главного (current > pending > done, затем порядок плана);
 * 3) у выполненной метки, чей прямоугольник пересекается с невыполненным, подпись скрыта (showLabel: false).
 * @returns {Array<{id, connectorIds, rectMm, step, state, order, label, showLabel}>}
 */
export function boardMarkers(board, plan, done) {
  const groups = new Map();
  for (const entry of connectorStates(board, plan, done)) {
    const r = entry.connector.rectMm;
    if (!r) continue;
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...entry, id: entry.connector.id });
  }
  const markers = [...groups.values()].map((entries) => {
    const main = [...entries].sort(byPriority)[0];
    const names = entries.map((e) => e.connector.name).join(" / ");
    const hint = main.state === "current" ? main.connector.hint : null;
    return {
      id: main.id,
      connectorIds: entries.map((e) => e.id),
      rectMm: main.connector.rectMm,
      step: main.step,
      state: main.state,
      order: main.order,
      label: hint ? `${names} · ${hint}` : names,
      showLabel: true,
    };
  });
  for (const m of markers) {
    if (m.state === "done") m.showLabel = !markers.some((n) => n.state !== "done" && rectsOverlap(m.rectMm, n.rectMm));
  }
  return markers;
}

const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Позиция метки шириной width × height с центром в (x, y), прижатая внутрь области w × h. */
export function clampLabel([x, y], [width, height], [w, h], margin = 4) {
  const clamp = (v, half, max) => Math.min(Math.max(v, half + margin), Math.max(half + margin, max - half - margin));
  return [clamp(x, width / 2, w), clamp(y, height / 2, h)];
}

const boxAt = ([x, y], [w, h]) => [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
const boxesOverlap = (a, b) => a[0] < b[2] + LABEL_GAP && b[0] < a[2] + LABEL_GAP && a[1] < b[3] + LABEL_GAP && b[1] < a[3] + LABEL_GAP;

/**
 * Раскладка подписей на экране без наложений.
 * items: { id, anchor: [x, y], size: [w, h], state, order } — точка на разъёме и размер подписи в px.
 * Подписи ставятся по приоритету (current, pending, done; затем order, затем id): сначала на точку,
 * при наложении — сдвиги вверх/вниз на высоту и влево/вправо на ширину подписи (после прижатия к краю);
 * если места нет — подпись скрывается, текущая — никогда.
 * previous — состояние прошлого кадра (AR): смена места и появление ждут HYSTERESIS_FRAMES кадров подряд,
 * кроме появления текущей подписи. null — истории нет (снимок, только что найденная плата): всё ставится сразу.
 * @returns {{ labels: Map<string, {x, y, visible, leader}>, state: Map }} state передаётся следующему кадру.
 */
export function layoutLabels(items, viewport, previous = null) {
  const placed = [];
  const labels = new Map();
  const state = new Map();
  for (const item of [...items].sort(byPriority)) {
    const [lw, lh] = item.size;
    const dy = lh + LABEL_GAP;
    const dx = lw + LABEL_GAP;
    const offsets = [[0, 0], [0, -dy], [0, dy], [0, -2 * dy], [0, 2 * dy], [-dx, 0], [dx, 0]];
    const positions = offsets.map(([ox, oy]) => clampLabel([item.anchor[0] + ox, item.anchor[1] + oy], item.size, viewport));
    const isFree = (i) => !placed.some((box) => boxesOverlap(boxAt(positions[i], item.size), box));

    let best = positions.findIndex((_, i) => isFree(i));
    if (best === -1 && item.state === "current") best = 0;

    let slot = best;
    let frames = 0;
    if (previous) {
      const prev = previous.get(item.id);
      const prevSlot = prev?.slot ?? -1;
      const appearsCurrent = prevSlot === -1 && item.state === "current";
      if (best !== prevSlot && !appearsCurrent) {
        frames = prev?.candidate === best ? prev.frames + 1 : 1;
        if (frames < HYSTERESIS_FRAMES) slot = prevSlot;
        else frames = 0;
      }
    }
    state.set(item.id, { slot, candidate: best, frames });

    if (slot === -1) {
      labels.set(item.id, { visible: false });
      continue;
    }
    const [x, y] = positions[slot];
    placed.push(boxAt([x, y], item.size));
    const leader = Math.hypot(x - item.anchor[0], y - item.anchor[1]) > lh / 2;
    labels.set(item.id, { x, y, visible: true, leader });
  }
  return { labels, state };
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
 * Метка под точкой: сначала многоугольники (снимок), затем ближайший центр в радиусе.
 * При перекрытии выигрывает текущий шаг, затем меньший по площади многоугольник.
 */
export function hitTest(markers, point, radius = 0) {
  const hits = markers
    .filter((m) => m.polygon && pointInPolygon(point, m.polygon))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || polygonArea(a.polygon) - polygonArea(b.polygon));
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
