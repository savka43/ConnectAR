import Foundation

@main
struct AssemblySessionTests {
    @MainActor
    static func main() {
        let suite = "ConnectAR.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let board = DemoAssembly.board
        let ram = board.steps[0]
        let initial = AssemblySession(defaults: defaults)
        precondition(initial.steps.count == board.steps.count && initial.progress == 0)
        initial.toggle(ram)
        let restored = AssemblySession(defaults: defaults)
        precondition(restored.completedSteps == [ram.id], "Completion must survive a new session")
        restored.select(ram, included: false)
        let filtered = AssemblySession(defaults: defaults)
        precondition(!filtered.steps.contains(ram) && filtered.completedSteps.isEmpty)
        filtered.toggle(ram)
        precondition(filtered.completedSteps.isEmpty, "Excluded steps cannot be marked done")
        filtered.select(ram, included: true)
        for step in filtered.steps { filtered.toggle(step) }
        precondition(filtered.progress == 1)
        filtered.resetProgress()
        precondition(AssemblySession(defaults: defaults).completedSteps.isEmpty)
        for step in board.steps { filtered.select(step, included: false) }
        precondition(filtered.steps.isEmpty && filtered.progress == 0)
        precondition(AssemblySession(defaults: defaults).steps.isEmpty, "Empty selection must persist")
        let otherBoard = Motherboard(id: "other", name: "Other", manualURL: board.manualURL, steps: board.steps)
        precondition(AssemblySession(board: otherBoard, defaults: defaults).steps.count == board.steps.count,
                     "Boards must have isolated progress")
        defaults.set(Data("invalid json".utf8), forKey: "assembly.v1.\(board.id)")
        precondition(AssemblySession(defaults: defaults).steps.count == board.steps.count)
        let stale = "{\"selected\":[\"ram\",\"removed\"],\"completed\":[\"ram\",\"removed\",\"gpu\"]}"
        defaults.set(Data(stale.utf8), forKey: "assembly.v1.\(board.id)")
        let cleaned = AssemblySession(defaults: defaults)
        precondition(cleaned.selectedStepIDs == ["ram"] && cleaned.completedSteps == ["ram"])
        print("PASS: persistence, selection, reset, empty build, board isolation, corrupt and stale storage")
    }
}
