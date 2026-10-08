import Combine
import Foundation

final class AssemblySession: ObservableObject {
    let board: Motherboard
    private let defaults: UserDefaults
    private var storageKey: String { "assembly.v2.\(board.id)" }

    private struct State: Codable {
        var answers: AssemblyAnswers
        var configured: Bool
        var completed: Set<String>
        var notes: [String: String]
    }
    private struct Legacy: Decodable {
        let completed: Set<String>
        let notes: [String: String]?
    }
    // One published snapshot makes dependent-step removal a single notification.
    @Published private var state: State

    var answers: AssemblyAnswers { state.answers }
    var configured: Bool { state.configured }
    var completedSteps: Set<String> { state.completed }
    var notes: [String: String] { state.notes }
    var steps: [AssemblyStep] { AssemblyPlanner.resolve(board: board, answers: answers) }
    var nextStep: AssemblyStep? { steps.first { !completedSteps.contains($0.id) } }
    var completedCount: Int { steps.filter { completedSteps.contains($0.id) }.count }
    var progress: Double { steps.isEmpty ? 0 : Double(completedCount) / Double(steps.count) }
    var summary: String {
        board.setup.map { question in
            let option = question.options.first { $0.id == answers[question.id] }
            return "\(question.title): \(option?.title ?? "—")"
        }.joined(separator: " · ")
    }

    init(board: Motherboard, defaults: UserDefaults = .standard) {
        self.board = board
        self.defaults = defaults
        var initial = State(answers: AssemblyPlanner.normalize([:], board: board), configured: false, completed: [], notes: [:])
        if let data = defaults.data(forKey: "assembly.v2.\(board.id)") {
            if let saved = try? JSONDecoder().decode(State.self, from: data) {
                initial = saved
                initial.answers = AssemblyPlanner.normalize(saved.answers, board: board)
            }
        } else if let data = defaults.data(forKey: "assembly.v1.\(board.id)"),
                  let legacy = try? JSONDecoder().decode(Legacy.self, from: data) {
            let stableIDs: Set<String> = ["ram", "gpu", "atx", "cpu-power"]
            initial.completed = legacy.completed.intersection(stableIDs)
            initial.notes = (legacy.notes ?? [:]).filter { stableIDs.contains($0.key) }
        }
        state = initial
    }

    func setAnswer(_ questionID: String, optionID: String) {
        guard board.setup.contains(where: { $0.id == questionID && $0.options.contains(where: { $0.id == optionID }) }) else { return }
        var updated = state
        updated.answers[questionID] = optionID
        update(updated)
    }

    func completeSetup() {
        var updated = state
        updated.configured = true
        update(updated)
    }

    func connectors(for step: AssemblyStep) -> [BoardConnector] {
        step.connectorIds.compactMap { id in board.connectors.first { $0.id == id } }
    }
    func connectorSummary(for step: AssemblyStep) -> String {
        let values = connectors(for: step).map(\.description)
        return values.isEmpty ? "Без разметки на плате" : values.joined(separator: ", ")
    }
    func cables(for step: AssemblyStep) -> [BoardCable] {
        step.cableIds.compactMap { id in board.cables?.first { $0.id == id } }
            .map { AssemblyPlanner.resolveCable($0, board: board, answers: answers) }
    }
    func isLocked(_ step: AssemblyStep) -> Bool {
        !completedSteps.contains(step.id) && !AssemblyPlanner.unmetRequires(step, done: completedSteps).isEmpty
    }
    func requiresHint(_ step: AssemblyStep) -> String? {
        AssemblyPlanner.requiresHint(plan: steps, step: step, done: completedSteps)
    }
    func doneDependents(_ step: AssemblyStep) -> [AssemblyStep] {
        AssemblyPlanner.doneDependents(plan: steps, done: completedSteps, stepID: step.id)
    }

    @discardableResult
    func setStepDone(_ id: String, isDone: Bool) -> Bool {
        guard let step = steps.first(where: { $0.id == id }) else { return false }
        var updated = state
        if isDone {
            guard !isLocked(step) else { return false }
            updated.completed.insert(id)
        } else {
            updated.completed.subtract(doneDependents(step).map(\.id))
            updated.completed.remove(id)
        }
        update(updated)
        return true
    }

    func setNote(_ text: String, for step: AssemblyStep) {
        guard steps.contains(where: { $0.id == step.id }) else { return }
        var updated = state
        if text.isEmpty { updated.notes.removeValue(forKey: step.id) }
        else { updated.notes[step.id] = text }
        update(updated)
    }

    func resetProgress() {
        var updated = state
        updated.completed.removeAll()
        update(updated)
    }

    private func update(_ updated: State) {
        if updated.configured, let data = try? JSONEncoder().encode(updated) {
            defaults.set(data, forKey: storageKey)
        }
        state = updated
    }
}
