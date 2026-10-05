import Combine

final class AssemblySession: ObservableObject {
    let board: Motherboard
    @Published private(set) var completedSteps: Set<String> = []

    init(board: Motherboard = DemoAssembly.board) {
        self.board = board
    }

    func toggle(_ step: AssemblyStep) {
        guard board.steps.contains(where: { $0.id == step.id }) else { return }
        if completedSteps.contains(step.id) {
            completedSteps.remove(step.id)
        } else {
            completedSteps.insert(step.id)
        }
    }
}
