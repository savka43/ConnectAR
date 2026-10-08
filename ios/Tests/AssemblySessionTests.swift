import Foundation
import Combine

func check(_ value: @autoclosure () -> Bool, _ message: String) {
    guard value() else { fatalError(message) }
}

struct PlanFixtures: Decodable {
    let board: Motherboard
    let cases: [Case]
    struct Case: Decodable { let name: String; let answers: AssemblyAnswers; let expected: Expected }
    struct Expected: Decodable { let steps: [Step]; let cables: [String: Cable] }
    struct Cable: Decodable { let psuSide: String?; let warning: String? }
    struct Step: Decodable {
        let id: String; let phaseId: String; let title: String
        let connectorIds: [String]; let cableIds: [String]; let instruction: String
        let substeps: [String]; let warning: String?; let requires: [String]
    }
}

final class CountingDefaults: UserDefaults {
    var writes = 0
    override func set(_ value: Any?, forKey defaultName: String) {
        writes += 1
        super.set(value, forKey: defaultName)
    }
}

@main
struct AssemblySessionTests {
    static func main() throws {
        let root = URL(fileURLWithPath: "../shared_boards")
        let fixtures = try JSONDecoder().decode(PlanFixtures.self, from: Data(contentsOf: root.appendingPathComponent("fixtures/plan-cases.json")))
        for test in fixtures.cases {
            let plan = AssemblyPlanner.resolve(board: fixtures.board, answers: test.answers)
            check(plan.count == test.expected.steps.count, "\(test.name): step count")
            for (actual, expected) in zip(plan, test.expected.steps) {
                check(actual.id == expected.id && actual.phaseId == expected.phaseId && actual.title == expected.title, "\(test.name): identity/text")
                check(actual.connectorIds == expected.connectorIds && actual.cableIds == expected.cableIds, "\(test.name): connectors/cables")
                check(actual.instruction == expected.instruction && actual.substeps == expected.substeps && actual.warning == expected.warning, "\(test.name): instructions")
                check(actual.requires == expected.requires, "\(test.name): requirements")
            }
            for (id, expected) in test.expected.cables {
                let cable = fixtures.board.cables!.first { $0.id == id }!
                let actual = AssemblyPlanner.resolveCable(cable, board: fixtures.board, answers: test.answers)
                check(actual.psuSide == expected.psuSide && actual.warning == expected.warning, "\(test.name): cable variant")
            }
        }
        let board = try BoardRepository.load(root: root, id: "gigabyte-b450-aorus-m")
        for (answer, slots) in [("1", ["ddr4-1"]), ("2", ["ddr4-2", "ddr4-1"]), ("4", ["ddr4-4", "ddr4-2", "ddr4-3", "ddr4-1"])] {
            let ram = AssemblyPlanner.resolve(board: board, answers: ["ram": answer]).first { $0.id == "ram" }!
            check(ram.connectorIds == slots, "RAM \(answer)")
        }
        let storagePlan = AssemblyPlanner.resolve(board: board, answers: ["sata-ssd": "2", "hdd": "1", "gpu": "no"])
        for (id, port) in [("sata-ssd-1", "sata3-0"), ("sata-ssd-2", "sata3-1"), ("hdd-1", "sata3-2")] {
            check(storagePlan.first { $0.id == id }?.connectorIds.contains(port) == true, "SATA pool allocation")
        }
        check(!storagePlan.contains { $0.id == "gpu" } && storagePlan.contains { $0.id == "display-igpu" }, "iGPU plan")
        let boot = storagePlan.first { $0.id == "first-boot" }!
        check(boot.requires.contains("display-igpu") && !boot.requires.contains("gpu"), "iGPU dependencies")
        let cable = board.cables!.first { $0.id == "atx24" }!
        check(AssemblyPlanner.resolveCable(cable, board: board, answers: ["psu": "modular"]).psuSide != AssemblyPlanner.resolveCable(cable, board: board, answers: [:]).psuSide, "PSU variant")
        check(board.connectors.allSatisfy { $0.rectMm != nil }, "Connector geometry")
        check(AssemblyPlanner.requiresHint(plan: storagePlan, step: boot, done: [])?.contains("и ещё") == true, "Short dependency hint")
        let affected = AssemblyPlanner.doneDependents(plan: storagePlan, done: Set(storagePlan.map(\.id)), stepID: "cpu")
        check(affected.map(\.id) == ["cooler", "cpu-fan", "first-boot"], "Transitive dependency order/deduplication")

        let suite = "ConnectAR.tests.\(UUID().uuidString)"
        let defaults = CountingDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let key = "assembly.v2.\(board.id)"
        let initial = AssemblySession(board: board, defaults: defaults)
        check(!initial.configured, "First launch requires setup")
        initial.setAnswer("ram", optionID: "1")
        check(initial.steps.first { $0.id == "ram" }?.connectorIds == ["ddr4-1"], "Live plan")
        check(defaults.data(forKey: key) == nil, "Draft answers must not persist")
        initial.completeSetup()
        initial.setAnswer("sata-ssd", optionID: "2")
        let restored = AssemblySession(board: board, defaults: defaults)
        check(restored.configured && restored.answers["ram"] == "1" && restored.answers["sata-ssd"] == "2", "Restore answers")
        check(!restored.setStepDone("cooler", isDone: true), "Locked step cannot be completed")
        for step in restored.steps { check(restored.setStepDone(step.id, isDone: true), "Sequential completion") }
        check(restored.progress == 1 && restored.nextStep == nil, "Completion")
        restored.setAnswer("sata-ssd", optionID: "0")
        check(restored.completedSteps.contains("sata-ssd-2") && restored.completedCount == restored.steps.count, "Hidden progress retention")
        restored.setAnswer("sata-ssd", optionID: "2")
        check(restored.completedSteps.contains("sata-ssd-2"), "Restored hidden progress")
        var notifications = 0
        let subscription = restored.objectWillChange.sink { notifications += 1 }
        defaults.writes = 0
        restored.setStepDone("cpu", isDone: false)
        check(defaults.writes == 1 && notifications == 1, "Atomic dependent removal")
        check(["cpu", "cooler", "cpu-fan", "first-boot"].allSatisfy { !restored.completedSteps.contains($0) }, "Cascade removal")
        check(restored.completedSteps.contains("ram"), "Unrelated progress retained")
        subscription.cancel()
        let ram = restored.steps.first { $0.id == "ram" }!
        restored.setNote("DDR4\nПроверить ✅", for: ram)
        restored.resetProgress()
        check(AssemblySession(board: board, defaults: defaults).notes["ram"] == "DDR4\nПроверить ✅", "Reset preserves notes")
        let other = AssemblySession(board: fixtures.board, defaults: defaults)
        check(!other.configured && other.completedSteps.isEmpty && other.notes.isEmpty, "Board isolation")
        defaults.removeObject(forKey: key)
        defaults.set(Data("{\"completed\":[\"ram\",\"gpu\",\"atx\",\"cpu-power\",\"sata\"],\"notes\":{\"ram\":\"keep\",\"sata\":\"old\"}}".utf8), forKey: "assembly.v1.\(board.id)")
        let migrated = AssemblySession(board: board, defaults: defaults)
        check(!migrated.configured && migrated.completedSteps == ["ram", "gpu", "atx", "cpu-power"] && migrated.notes == ["ram": "keep"], "v1 migration")
        migrated.completeSetup()
        check(AssemblySession(board: board, defaults: defaults).notes == ["ram": "keep"], "Migration saved after setup")
        defaults.set(Data("broken".utf8), forKey: key)
        let corrupt = AssemblySession(board: board, defaults: defaults)
        check(!corrupt.configured && corrupt.completedSteps.isEmpty, "Corrupt v2 does not import obsolete v1")
        do { _ = try BoardRepository.load(root: root, id: "missing"); fatalError("Missing board must throw") } catch {}
        try BoardGeometryTests.run(root: root)
        print("PASS: \(fixtures.cases.count) shared plan fixtures, real board, setup, dependencies, atomic storage, migration and notes")
    }
}
