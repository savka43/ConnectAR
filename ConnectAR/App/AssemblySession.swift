import Combine
import Foundation

final class AssemblySession: ObservableObject {
    let board: Motherboard
    @Published private(set) var completedSteps: Set<String>
    @Published private(set) var selectedStepIDs: Set<String>
    private let defaults: UserDefaults
    private var storageKey: String { "assembly.v1.\(board.id)" }

    private struct SavedAssembly: Codable {
        var selected: Set<String>
        var completed: Set<String>
    }

    var steps: [AssemblyStep] { board.steps.filter { selectedStepIDs.contains($0.id) } }
    var progress: Double { steps.isEmpty ? 0 : Double(completedSteps.count) / Double(steps.count) }

    init(board: Motherboard = DemoAssembly.board, defaults: UserDefaults = .standard) {
        self.board = board
        self.defaults = defaults
        let validIDs = Set(board.steps.map(\.id))
        if let data = defaults.data(forKey: "assembly.v1.\(board.id)"),
           let saved = try? JSONDecoder().decode(SavedAssembly.self, from: data) {
            let selected = saved.selected.intersection(validIDs)
            selectedStepIDs = selected
            completedSteps = saved.completed.intersection(selected)
        } else {
            selectedStepIDs = validIDs
            completedSteps = []
        }
    }

    func select(_ step: AssemblyStep, included: Bool) {
        guard board.steps.contains(where: { $0.id == step.id }) else { return }
        if included {
            selectedStepIDs.insert(step.id)
        } else {
            selectedStepIDs.remove(step.id)
            completedSteps.remove(step.id)
        }
        save()
    }

    func toggle(_ step: AssemblyStep) {
        guard selectedStepIDs.contains(step.id) else { return }
        if completedSteps.contains(step.id) {
            completedSteps.remove(step.id)
        } else {
            completedSteps.insert(step.id)
        }
        save()
    }

    func resetProgress() {
        completedSteps.removeAll()
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(SavedAssembly(selected: selectedStepIDs, completed: completedSteps)) {
            defaults.set(data, forKey: storageKey)
        }
    }
}
