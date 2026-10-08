import { describe, expect, it } from "vitest";
import { createSession } from "../src/session.js";

const board = {
  id: "b",
  setup: [
    { id: "ram", title: "Память", options: [{ id: "1", title: "1" }, { id: "2", title: "2" }], default: "2" },
    { id: "gpu", title: "GPU", options: [{ id: "yes", title: "Да" }, { id: "no", title: "Нет" }], default: "yes" },
  ],
  phases: [{ id: "p", title: "P" }],
  connectors: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "pcie", name: "PCIE" }],
  steps: [
    { id: "ram", phaseId: "p", title: "RAM", instruction: "i", connectorIds: ["a", "b"],
      variants: [{ when: { ram: ["1"] }, connectorIds: ["b"] }] },
    { id: "gpu", phaseId: "p", title: "GPU", instruction: "i", when: { gpu: ["yes"] }, connectorIds: ["pcie"] },
  ],
};

const memoryStorage = () => {
  const data = new Map();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

describe("сессия сборки", () => {
  it("без сохранённых ответов опрос не пройден, план — по ответам по умолчанию", () => {
    const s = createSession(board, memoryStorage());
    expect(s.configured).toBe(false);
    expect(s.answers).toEqual({ ram: "2", gpu: "yes" });
    expect(s.plan.map((p) => p.id)).toEqual(["ram", "gpu"]);
  });

  it("ответ сразу перестраивает план", () => {
    const s = createSession(board, memoryStorage());
    s.setAnswer("gpu", "no");
    s.setAnswer("ram", "1");
    expect(s.plan.map((p) => [p.id, p.connectorIds])).toEqual([["ram", ["b"]]]);
  });

  it("ответы сохраняются после прохождения опроса, прогресс — сразу", () => {
    const storage = memoryStorage();
    const s = createSession(board, storage);
    s.setAnswer("gpu", "no");
    expect(storage.data.has("connectar.setup.b")).toBe(false);
    s.completeSetup();
    s.setStepDone("ram", true);

    const restored = createSession(board, storage);
    expect(restored.configured).toBe(true);
    expect(restored.answers).toEqual({ ram: "2", gpu: "no" });
    expect([...restored.done]).toEqual(["ram"]);
  });

  it("испорченные сохранения заменяются значениями по умолчанию", () => {
    const storage = memoryStorage();
    storage.setItem("connectar.setup.b", JSON.stringify({ ram: "16", gpu: "no" }));
    storage.setItem("connectar.progress.b", "{broken");
    const s = createSession(board, storage);
    expect(s.answers).toEqual({ ram: "2", gpu: "no" });
    expect(s.done.size).toBe(0);
  });

  it("уведомляет подписчиков об изменениях", () => {
    const s = createSession(board, memoryStorage());
    let calls = 0;
    const unsubscribe = s.subscribe(() => calls++);
    s.setStepDone("ram", true);
    s.setAnswer("ram", "1");
    s.reset();
    unsubscribe();
    s.setStepDone("gpu", true);
    expect(calls).toBe(3);
  });

  it("работает без хранилища", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    const s = createSession(board, broken);
    s.setStepDone("gpu", true);
    s.completeSetup();
    expect(s.done.has("gpu")).toBe(true);
    expect(s.configured).toBe(true);
  });
});
