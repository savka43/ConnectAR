import { describe, expect, it } from "vitest";
import {
  boardMarkers, clampLabel, connectorStates, currentStep, hitTest, layoutLabels, pointInPolygon, stepStates,
} from "../src/markers.js";

const board = {
  connectors: [
    { id: "dimm-a", name: "DIMM_A", hint: "2-й от CPU" },
    { id: "dimm-b", name: "DIMM_B", hint: "4-й от CPU" },
    { id: "pcie", name: "PCIE" },
    { id: "atx", name: "ATX" },
    { id: "unused", name: "UNUSED" },
  ],
};
const plan = [
  { id: "ram", connectorIds: ["dimm-a", "dimm-b"] },
  { id: "case", connectorIds: [] },
  { id: "gpu", connectorIds: ["pcie"] },
  { id: "atx", connectorIds: ["atx"] },
];

describe("состояния шагов", () => {
  it("первый невыполненный — current, выполненные — done, остальные — pending", () => {
    const states = stepStates(plan, new Set(["ram"]));
    expect([...states]).toEqual([["ram", "done"], ["case", "current"], ["gpu", "pending"], ["atx", "pending"]]);
  });

  it("текущим может быть шаг без разъёмов; когда всё сделано — текущего нет", () => {
    expect(currentStep(plan, new Set(["ram"])).id).toBe("case");
    expect(currentStep(plan, new Set(["ram", "case", "gpu", "atx"]))).toBeNull();
  });

  it("выполненные id, которых нет в плане, не мешают", () => {
    expect(stepStates(plan, new Set(["removed", "ram"])).get("case")).toBe("current");
  });
});

describe("разъёмы", () => {
  it("шаг с несколькими разъёмами подсвечивает их все; разъёмы вне плана скрыты", () => {
    const states = connectorStates(board, plan, new Set());
    expect(states.map((s) => [s.connector.id, s.state])).toEqual([
      ["dimm-a", "current"], ["dimm-b", "current"], ["pcie", "pending"], ["atx", "pending"],
    ]);
  });

  it("отметка шага сдвигает текущий", () => {
    const states = connectorStates(board, plan, new Set(["ram", "case"]));
    expect(states.map((s) => [s.connector.id, s.state])).toEqual([
      ["dimm-a", "done"], ["dimm-b", "done"], ["pcie", "current"], ["atx", "pending"],
    ]);
  });

  it("разъём с несколькими шагами открывает невыполненный шаг", () => {
    const multi = [...plan, { id: "atx-check", connectorIds: ["atx"] }];
    const atx = connectorStates(board, multi, new Set(["ram", "case", "gpu", "atx"])).find((s) => s.connector.id === "atx");
    expect(atx.state).toBe("current");
    expect(atx.step.id).toBe("atx-check");
  });
});

// Сборка процессора: кулер требует CPU, вентилятор — кулер; первый запуск — всё.
const chain = [
  { id: "cpu", title: "Установить процессор", connectorIds: ["socket"], requires: [] },
  { id: "cooler", title: "Установить кулер", connectorIds: ["mount"], requires: ["cpu"] },
  { id: "fan", title: "Вентилятор кулера", connectorIds: ["cpu-fan"], requires: ["cooler"] },
  { id: "ssd-1", title: "SSD 1", connectorIds: ["sata0"], requires: [] },
  { id: "hdd-1", title: "HDD 1", connectorIds: ["sata2"], requires: ["fan"] },
  { id: "boot", title: "Первый запуск", connectorIds: [], requires: ["cpu", "cooler", "fan"] },
];
const rect = (x, y, w, h) => ({ x, y, w, h });
const chainBoard = {
  connectors: [
    { id: "socket", name: "AM4", rectMm: rect(100, 60, 56, 50) },
    { id: "mount", name: "Крепление кулера", rectMm: rect(98, 30, 63, 103) },
    { id: "cpu-fan", name: "CPU_FAN", rectMm: rect(168, 12, 10, 6) },
    { id: "sata0", name: "SATA3 0", hint: "сверьте подпись", rectMm: rect(230, 196, 14, 16) },
    { id: "sata2", name: "SATA3 2", hint: "нижний порт", rectMm: rect(230, 196, 14, 16) },
  ],
};

describe("заблокированные шаги", () => {
  it("приоритет состояний: done > current > locked > pending", () => {
    expect([...stepStates(chain, new Set())]).toEqual([
      ["cpu", "current"], ["cooler", "locked"], ["fan", "locked"], ["ssd-1", "pending"], ["hdd-1", "locked"], ["boot", "locked"],
    ]);
    // Текущий важнее locked: первый невыполненный шаг — текущий, даже с невыполненным requires.
    const odd = [{ id: "a", connectorIds: [], requires: ["b"] }, { id: "b", connectorIds: [], requires: [] }];
    expect(stepStates(odd, new Set()).get("a")).toBe("current");
    // done важнее всего: отмеченный шаг остаётся done, даже если его requires не выполнен.
    expect(stepStates(chain, new Set(["cooler"])).get("cooler")).toBe("done");
  });

  it("старое сохранение: кулер отмечен, CPU нет", () => {
    const states = stepStates(chain, new Set(["cooler"]));
    expect(states.get("cpu")).toBe("current");
    expect(states.get("cooler")).toBe("done");
    expect(states.get("fan")).toBe("pending");
  });

  it("разъёмы locked-шагов не подсвечиваются", () => {
    const ids = connectorStates(chainBoard, chain, new Set()).map((e) => e.connector.id);
    expect(ids).toEqual(["socket", "sata0"]);
  });
});

describe("метки на плате", () => {
  it("locked-разъём выкидывается до склейки", () => {
    const [sata] = boardMarkers(chainBoard, chain, new Set()).filter((m) => m.connectorIds.includes("sata0"));
    expect(sata.connectorIds).toEqual(["sata0"]);
    expect(sata.label).toBe("SATA3 0");
  });

  it("одинаковые прямоугольники склеиваются; тап открывает шаг главного разъёма, подсказка — его", () => {
    const markers = boardMarkers(chainBoard, chain, new Set(["cpu", "cooler", "fan", "ssd-1"]));
    const sata = markers.find((m) => m.connectorIds.includes("sata0"));
    expect(sata.connectorIds).toEqual(["sata0", "sata2"]);
    expect(sata.state).toBe("current");
    expect(sata.step.id).toBe("hdd-1");
    expect(sata.label).toBe("SATA3 0 / SATA3 2 · нижний порт");
    expect(markers.filter((m) => m.connectorIds.includes("sata2"))).toHaveLength(1);
  });

  it("подпись выполненного разъёма скрыта, если он пересекается с невыполненным", () => {
    const markers = boardMarkers(chainBoard, chain, new Set(["cpu"]));
    const socket = markers.find((m) => m.id === "socket");
    const mount = markers.find((m) => m.id === "mount");
    expect(socket.state).toBe("done");
    expect(socket.showLabel).toBe(false);
    expect(mount.state).toBe("current");
    expect(mount.showLabel).toBe(true);
    // Когда кулер тоже установлен, перекрывать нечего — обе подписи видны.
    const later = boardMarkers(chainBoard, chain, new Set(["cpu", "cooler"]));
    expect(later.find((m) => m.id === "socket").showLabel).toBe(true);
  });
});

describe("раскладка подписей", () => {
  const item = (id, anchor, state = "pending", order = 0, size = [80, 20]) => ({ id, anchor, size, state, order });
  const boxes = (items, labels) => items.filter((i) => labels.get(i.id).visible).map((i) => {
    const { x, y } = labels.get(i.id);
    return [x - i.size[0] / 2, y - i.size[1] / 2, x + i.size[0] / 2, y + i.size[1] / 2];
  });
  const overlapping = (list) => list.some((a, i) => list.some((b, j) => i < j && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]));

  it("две текущие метки (слоты памяти) видны обе, вторая сдвинута с выноской", () => {
    const items = [item("ddr4-2", [200, 200], "current", 2), item("ddr4-1", [205, 202], "current", 2)];
    const { labels } = layoutLabels(items, [400, 400]);
    expect(labels.get("ddr4-1").visible && labels.get("ddr4-2").visible).toBe(true);
    expect(overlapping(boxes(items, labels))).toBe(false);
    // Один шаг — равный порядок, первой на точку встаёт метка с меньшим id.
    expect(labels.get("ddr4-1").leader).toBe(false);
    expect(labels.get("ddr4-2").leader).toBe(true);
  });

  it("текущая метка не скрывается, даже если места нет", () => {
    const items = [item("a", [50, 15], "current", 0), item("b", [50, 15], "current", 1)];
    const { labels } = layoutLabels(items, [100, 30]);
    expect(labels.get("a").visible && labels.get("b").visible).toBe(true);
  });

  it("при равных приоритетах порядок детерминирован: план, затем id", () => {
    const a = item("sata3-1", [200, 200], "pending", 5);
    const b = item("sata3-0", [200, 200], "pending", 5);
    const one = layoutLabels([a, b], [400, 400]).labels;
    const two = layoutLabels([b, a], [400, 400]).labels;
    expect(one).toEqual(two);
    expect(one.get("sata3-0").leader).toBe(false); // id меньше — встаёт на точку
    const byOrder = layoutLabels([item("z", [200, 200], "pending", 1), item("a", [200, 200], "pending", 3)], [400, 400]).labels;
    expect(byOrder.get("z").leader).toBe(false);
  });

  it("сдвиг, прижатый к краю, не ставит метку обратно на соседнюю", () => {
    // Узкая полоса у правого края: все сдвиги после clampLabel ложатся на первую метку.
    const items = [item("a", [290, 15], "pending", 0), item("b", [290, 15], "pending", 1)];
    const { labels } = layoutLabels(items, [300, 30]);
    expect(labels.get("a").visible).toBe(true);
    expect(labels.get("b").visible).toBe(false);
    // Шире — место находится, и наложений нет.
    const wide = layoutLabels(items, [300, 200]).labels;
    expect(wide.get("b").visible).toBe(true);
    expect(overlapping(boxes(items, wide))).toBe(false);
  });

  it("без истории (снимок) всё ставится сразу", () => {
    const items = [item("a", [200, 200]), item("b", [200, 200], "pending", 1)];
    const { labels } = layoutLabels(items, [400, 400], null);
    expect(labels.get("b").visible).toBe(true);
  });

  it("гистерезис в AR: появление и переход — после 3 кадров подряд, текущая — сразу", () => {
    const viewport = [400, 400];
    let state = layoutLabels([item("a", [200, 200])], viewport, null).state;
    // Новая метка b появляется только на третьем кадре, новая текущая c — сразу.
    const items = [item("a", [200, 200]), item("b", [300, 300], "pending", 1), item("c", [100, 100], "current", 0)];
    const seen = [];
    for (let frame = 0; frame < 3; frame++) {
      const result = layoutLabels(items, viewport, state);
      state = result.state;
      seen.push([result.labels.get("b").visible, result.labels.get("c").visible]);
    }
    expect(seen).toEqual([[false, true], [false, true], [true, true]]);

    // b ушла со своей точки: новая позиция (точка свободна) принимается на третьем кадре, до этого — старая.
    const moved = [item("a", [200, 200]), item("b", [200, 200], "pending", 1)];
    const positions = [];
    for (let frame = 0; frame < 3; frame++) {
      const result = layoutLabels(moved, viewport, state);
      state = result.state;
      positions.push(result.labels.get("b").leader);
    }
    expect(positions).toEqual([false, false, true]);
  });
});

describe("попадание в метку", () => {
  const quad = [[0.2, 0.2], [0.4, 0.25], [0.38, 0.5], [0.18, 0.45]];

  it("point-in-polygon для перспективного четырёхугольника", () => {
    expect(pointInPolygon([0.3, 0.35], quad)).toBe(true);
    expect(pointInPolygon([0.41, 0.22], quad)).toBe(false);
    expect(pointInPolygon([0.1, 0.1], quad)).toBe(false);
  });

  it("многоугольник важнее центра, при перекрытии выигрывает текущий шаг", () => {
    const markers = [
      { id: "a", state: "pending", center: [0.3, 0.35], polygon: quad },
      { id: "b", state: "current", center: [0.32, 0.36], polygon: [[0.25, 0.3], [0.35, 0.3], [0.35, 0.4], [0.25, 0.4]] },
      { id: "c", state: "pending", center: [0.8, 0.8] },
    ];
    expect(hitTest(markers, [0.3, 0.35]).id).toBe("b");
    expect(hitTest(markers, [0.21, 0.25]).id).toBe("a");
    expect(hitTest(markers, [0.81, 0.8], 0.03).id).toBe("c");
    expect(hitTest(markers, [0.6, 0.6], 0.03)).toBeNull();
  });
});

describe("положение метки", () => {
  it("прижимает метку внутрь кадра и не трогает метку в середине", () => {
    expect(clampLabel([200, 100], [80, 30], [400, 300])).toEqual([200, 100]);
    expect(clampLabel([395, 2], [80, 30], [400, 300])).toEqual([356, 19]);
    expect(clampLabel([-10, 299], [80, 30], [400, 300])).toEqual([44, 281]);
  });
});
