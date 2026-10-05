import { describe, expect, it } from "vitest";
import { clampLabel, connectorStates, hitTest, pointInPolygon, stepStates, visibleSteps } from "../src/markers.js";

const board = {
  components: [{ id: "ram" }, { id: "gpu" }, { id: "psu" }],
  connectors: [
    { id: "dimm", componentId: "ram" },
    { id: "pcie", componentId: "gpu" },
    { id: "atx", componentId: "psu" },
  ],
  steps: [
    { id: "ram", connectorId: "dimm" },
    { id: "gpu", connectorId: "pcie" },
    { id: "atx", connectorId: "atx" },
  ],
};
const all = new Set(["ram", "gpu", "psu"]);

describe("состояния шагов", () => {
  it("первый невыполненный — current, выполненные — done, остальные — pending", () => {
    const states = stepStates(board, all, new Set(["ram"]));
    expect([...states]).toEqual([["ram", "done"], ["gpu", "current"], ["atx", "pending"]]);
  });

  it("невыбранные компоненты скрыты и не становятся текущими", () => {
    const selected = new Set(["ram", "psu"]);
    expect(visibleSteps(board, selected).map((s) => s.id)).toEqual(["ram", "atx"]);
    const states = connectorStates(board, selected, new Set(["ram"]));
    expect(states.map((s) => [s.connector.id, s.state])).toEqual([["dimm", "done"], ["atx", "current"]]);
  });

  it("отметка шага сдвигает текущий", () => {
    const done = new Set();
    expect(stepStates(board, all, done).get("ram")).toBe("current");
    done.add("ram");
    expect(stepStates(board, all, done).get("gpu")).toBe("current");
    done.add("gpu").add("atx");
    expect([...stepStates(board, all, done).values()]).not.toContain("current");
  });

  it("разъём с несколькими шагами открывает невыполненный шаг", () => {
    const multi = { ...board, steps: [...board.steps, { id: "atx-check", connectorId: "atx" }] };
    const states = connectorStates(multi, all, new Set(["ram", "gpu", "atx"]));
    const atx = states.find((s) => s.connector.id === "atx");
    expect(atx.state).toBe("current");
    expect(atx.step.id).toBe("atx-check");
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
