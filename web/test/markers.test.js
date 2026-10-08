import { describe, expect, it } from "vitest";
import { clampLabel, connectorStates, currentStep, hitTest, labelText, pointInPolygon, stepStates } from "../src/markers.js";

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

  it("подсказка добавляется к метке только у текущего шага", () => {
    expect(labelText(board.connectors[0], "current")).toBe("DIMM_A · 2-й от CPU");
    expect(labelText(board.connectors[0], "pending")).toBe("DIMM_A");
    expect(labelText(board.connectors[2], "current")).toBe("PCIE");
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
