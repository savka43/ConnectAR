import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  answersSummary, defaultAnswers, doneDependents, normalizeAnswers, requiresHint, resolveCable, resolvePlan,
} from "../src/plan.js";

const fixtures = JSON.parse(readFileSync(new URL("../../shared_boards/fixtures/plan-cases.json", import.meta.url), "utf8"));
const realBoard = JSON.parse(readFileSync(new URL("../../shared_boards/boards/gigabyte-b450-aorus-m/board.json", import.meta.url), "utf8"));

const pick = (s) => ({
  id: s.id, phaseId: s.phaseId, title: s.title, connectorIds: s.connectorIds, cableIds: s.cableIds,
  instruction: s.instruction, substeps: s.substeps, warning: s.warning, requires: s.requires,
});

describe.each(fixtures.cases)("план: $name", ({ answers, expected }) => {
  it("шаги совпадают с фикстурой", () => {
    expect(resolvePlan(fixtures.board, answers).map(pick)).toEqual(expected.steps);
  });

  it("кабели совпадают с фикстурой", () => {
    for (const [id, want] of Object.entries(expected.cables)) {
      const cable = fixtures.board.cables.find((c) => c.id === id);
      const { psuSide, warning } = resolveCable(fixtures.board, cable, answers);
      expect({ psuSide, warning }).toEqual(want);
    }
  });
});

// Ромб: первый запуск зависит и от CPU, и от кулера, а кулер — от CPU.
const diamond = [
  { id: "cpu", title: "Процессор", requires: [] },
  { id: "cooler", title: "Кулер", requires: ["cpu"] },
  { id: "fan", title: "Вентилятор кулера", requires: ["cooler"] },
  { id: "ram", title: "Память", requires: [] },
  { id: "first-boot", title: "Первый запуск", requires: ["cpu", "cooler", "ram"] },
];

describe("зависимости шагов", () => {
  it("снятие CPU снимает отмеченных зависимых, каждого один раз, в порядке плана", () => {
    const done = new Set(["cpu", "cooler", "fan", "ram", "first-boot"]);
    expect(doneDependents(diamond, done, "cpu").map((s) => s.id)).toEqual(["cooler", "fan", "first-boot"]);
  });

  it("в список попадают только отмеченные; неотмеченный промежуточный шаг не обрывает цепочку", () => {
    expect(doneDependents(diamond, new Set(["cpu", "fan"]), "cpu").map((s) => s.id)).toEqual(["fan"]);
    expect(doneDependents(diamond, new Set(["cpu", "ram"]), "cpu")).toEqual([]);
  });

  it("подпись «Сначала: …» — только невыполненные, названиями из плана, длинный список обрезается", () => {
    const plan = [
      { id: "a", title: "Установить кулер", requires: [] },
      { id: "b", title: "Подключить питание процессора", requires: [] },
      { id: "c", title: "C", requires: [] },
      { id: "d", title: "D", requires: [] },
      { id: "e", title: "E", requires: [] },
      { id: "f", title: "F", requires: [] },
      { id: "boot", title: "Первый запуск", requires: ["a", "b", "c", "d", "e", "f"] },
    ];
    const boot = plan.at(-1);
    expect(requiresHint(plan, boot, new Set(["c"]))).toBe("Сначала: Установить кулер, Подключить питание процессора и ещё 3");
    expect(requiresHint(plan, boot, new Set(["a", "b", "c"]))).toBe("Сначала: D, E, F");
    expect(requiresHint(plan, boot, new Set(["a", "b", "c", "d", "e", "f"]))).toBeNull();
  });

  it("у B450 AORUS M первый запуск ждёт только шаги текущего плана", () => {
    const plan = resolvePlan(realBoard, { gpu: "no" });
    const boot = plan.find((s) => s.id === "first-boot");
    expect(boot.requires).toContain("display-igpu");
    expect(boot.requires).not.toContain("gpu");
    expect(requiresHint(plan, boot, new Set())).toMatch(/^Сначала: .+, .+ и ещё \d+$/);
  });
});

describe("ответы опроса", () => {
  it("по умолчанию берутся из default", () => {
    expect(defaultAnswers(fixtures.board)).toEqual({ ram: "2", ssd: "0", hdd: "0", gpu: "yes", psu: "fixed" });
  });

  it("неизвестные значения и вопросы отбрасываются", () => {
    expect(normalizeAnswers(fixtures.board, { ram: "1", gpu: "maybe", extra: "x" }))
      .toEqual({ ram: "1", ssd: "0", hdd: "0", gpu: "yes", psu: "fixed" });
  });

  it("краткое описание перечисляет все вопросы", () => {
    expect(answersSummary(fixtures.board, defaultAnswers(fixtures.board))).toBe("Память: 2 · SSD: 0 · HDD: 0 · GPU: Да · БП: Немодульный");
  });
});

describe("B450 AORUS M", () => {
  const ids = (answers) => resolvePlan(realBoard, answers).map((s) => s.id);

  it("память подсвечивает слоты по числу модулей", () => {
    const ram = (n) => resolvePlan(realBoard, { ram: n }).find((s) => s.id === "ram").connectorIds;
    expect(ram("1")).toEqual(["ddr4-1"]);
    expect(ram("2")).toEqual(["ddr4-2", "ddr4-1"]);
    expect(ram("4")).toEqual(["ddr4-4", "ddr4-2", "ddr4-3", "ddr4-1"]);
  });

  it("накопители получают порты SATA по порядку: сначала SSD, затем HDD", () => {
    const plan = resolvePlan(realBoard, { "sata-ssd": "2", hdd: "1", nvme: "1" });
    const drives = plan.filter((s) => s.stepId === "sata-ssd" || s.stepId === "hdd");
    expect(drives.map((s) => [s.id, s.connectorIds])).toEqual([
      ["sata-ssd-1", ["sata3-0"]],
      ["sata-ssd-2", ["sata3-1"]],
      ["hdd-1", ["sata3-2"]],
    ]);
    expect(drives[2].instruction).toContain("SATA3 2");
    expect(ids({ nvme: "1" })).toContain("m2");
  });

  it("без видеокарты — шаг про встроенную графику вместо PCIEX16", () => {
    expect(ids({ gpu: "yes" })).toContain("gpu");
    expect(ids({ gpu: "no" })).toEqual(expect.arrayContaining(["display-igpu"]));
    expect(ids({ gpu: "no" })).not.toContain("gpu");
  });

  it("кабель 24-pin описывается по типу БП", () => {
    const atx = realBoard.cables.find((c) => c.id === "atx24");
    expect(resolveCable(realBoard, atx, { psu: "modular" }).psuSide).toContain("MB");
    expect(resolveCable(realBoard, atx, { psu: "modular" }).warning).toContain("только кабели");
    expect(resolveCable(realBoard, atx, {}).warning).toBeNull();
  });

  it("шаги идут по этапам без возврата назад", () => {
    const order = realBoard.phases.map((p) => p.id);
    const phases = resolvePlan(realBoard, { nvme: "1", "sata-ssd": "1", hdd: "1", "case-fans": "2" }).map((s) => order.indexOf(s.phaseId));
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
  });
});
