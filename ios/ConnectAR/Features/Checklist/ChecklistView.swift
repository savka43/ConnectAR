import SwiftUI

struct ChecklistView: View {
    @EnvironmentObject private var session: AssemblySession
    @State private var confirmingReset = false

    var body: some View {
        List {
            Section {
                ProgressView(value: session.progress)
                Text("Выполнено: \(session.completedSteps.count) из \(session.steps.count)")
                if !session.steps.isEmpty && session.completedSteps.count == session.steps.count {
                    Label("Все шаги сценария пройдены", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.teal)
                }
            }
            Section(session.board.name) {
                if session.steps.isEmpty {
                    Text("Выберите компоненты, чтобы составить чек-лист.")
                }
                NavigationLink("Изменить состав сборки") { BuildConfigurationView() }
                ForEach(session.steps) { step in
                    HStack(spacing: 16) {
                        Button { session.toggle(step) } label: {
                            Image(systemName: session.completedSteps.contains(step.id) ? "checkmark.circle.fill" : "circle")
                                .font(.title2).frame(minWidth: 44, minHeight: 44)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(step.title)
                        .accessibilityValue(session.completedSteps.contains(step.id) ? "Выполнено" : "Не выполнено")
                        NavigationLink { InstructionDetailView(step: step) } label: {
                            Text(step.title)
                        }
                    }
                }
            }
            Section {
                Text("Состав сборки и отметки сохраняются на устройстве. Это часть сборки, а не проверка готовности ПК к включению.")
                    .font(.footnote).foregroundStyle(.secondary)
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
        }
    }
}
