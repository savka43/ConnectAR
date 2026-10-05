import { describe, expect, it } from "vitest";
import { createSession } from "../src/session.js";

const board = {
  id: "b",
  components: [{ id: "ram" }, { id: "gpu" }],
  steps: [{ id: "ram" }, { id: "gpu" }],
};

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

describe("сессия сборки", () => {
  it("по умолчанию выбраны все компоненты", () => {
    expect([...createSession(board, memoryStorage()).selected]).toEqual(["ram", "gpu"]);
  });

  it("сохраняет выбор и прогресс, отбрасывает неизвестные id", () => {
    const storage = memoryStorage();
    const s = createSession(board, storage);
    s.setComponent("gpu", false);
    s.setStepDone("ram", true);
    storage.setItem("connectar.progress.b", JSON.stringify(["ram", "removed-step"]));

    const restored = createSession(board, storage);
    expect([...restored.selected]).toEqual(["ram"]);
    expect([...restored.done]).toEqual(["ram"]);
  });

  it("уведомляет подписчиков об изменениях", () => {
    const s = createSession(board, memoryStorage());
    let calls = 0;
    const unsubscribe = s.subscribe(() => calls++);
    s.setStepDone("ram", true);
    s.reset();
    unsubscribe();
    s.setStepDone("gpu", true);
    expect(calls).toBe(2);
  });

  it("работает без хранилища", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    const s = createSession(board, broken);
    s.setStepDone("gpu", true);
    expect(s.done.has("gpu")).toBe(true);
  });
});
