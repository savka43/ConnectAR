import SwiftUI

struct StepCompletionButton: View {
    @EnvironmentObject private var session: AssemblySession
    let step: AssemblyStep
    var compact = false
    @State private var confirmingRemoval = false

    private var done: Bool { session.completedSteps.contains(step.id) }

    var body: some View {
        Button {
            if done && !session.doneDependents(step).isEmpty { confirmingRemoval = true }
            else { session.setStepDone(step.id, isDone: !done) }
        } label: {
            if compact {
                Image(systemName: done ? "checkmark.circle.fill" : (session.isLocked(step) ? "lock.circle" : "circle"))
                    .font(.title2).frame(minWidth: 44, minHeight: 44)
            } else {
                Label(done ? "Снять отметку выполнения" : "Отметить выполненным",
                      systemImage: done ? "checkmark.circle.fill" : "circle")
            }
        }
        .buttonStyle(.borderless)
        .disabled(session.isLocked(step))
        .accessibilityLabel(step.title)
        .accessibilityValue(done ? "Выполнено" : "Не выполнено")
        .accessibilityHint(session.isLocked(step) ? (session.requiresHint(step) ?? "") : "")
        .confirmationDialog("Снять отметку с „\(step.title)“?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Снять отметки", role: .destructive) { session.setStepDone(step.id, isDone: false) }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Также снимутся: " + session.doneDependents(step).map(\.title).joined(separator: ", "))
        }
    }
}
