import SwiftUI

struct ChecklistView: View {
    @EnvironmentObject private var session: AssemblySession
    @State private var confirmingReset = false

    var body: some View {
        List {
            Section {
                NavigationLink("Изменить сборку") { SetupView() }
                ProgressView(value: session.progress)
                Text("Выполнено \(session.completedCount) из \(session.steps.count)")
                if session.nextStep == nil { Label("Все шаги выполнены", systemImage: "checkmark.seal.fill") }
            }
            ForEach(session.board.phases) { phase in
                let steps = session.steps.filter { $0.phaseId == phase.id }
                if !steps.isEmpty {
                    Section("\(phase.title) · \(steps.filter { session.completedSteps.contains($0.id) }.count)/\(steps.count)") {
                        ForEach(steps) { step in
                            HStack(spacing: 12) {
                                StepCompletionButton(step: step, compact: true)
                                NavigationLink { InstructionDetailView(step: step) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(step.title)
                                        Text(session.isLocked(step) ? (session.requiresHint(step) ?? "") : session.connectorSummary(for: step))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Чек-лист")
        .toolbar {
            Button("Сбросить", systemImage: "arrow.counterclockwise") { confirmingReset = true }
                .disabled(session.completedSteps.isEmpty)
        }
        .confirmationDialog("Сбросить выполненные шаги?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Сбросить прогресс", role: .destructive) { session.resetProgress() }
            Button("Отмена", role: .cancel) {}
        } message: { Text("Заметки сохранятся.") }
    }
}
