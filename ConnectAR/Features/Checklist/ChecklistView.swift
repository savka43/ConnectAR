import SwiftUI

struct ChecklistView: View {
    @EnvironmentObject private var session: AssemblySession

    var body: some View {
        List {
            Section {
                ProgressView(value: Double(session.completedSteps.count), total: Double(session.board.steps.count))
                Text("Выполнено: \(session.completedSteps.count) из \(session.board.steps.count)")
                if session.completedSteps.count == session.board.steps.count {
                    Label("Все шаги сценария пройдены", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.teal)
                }
            }
            Section(session.board.name) {
                ForEach(session.board.steps) { step in
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
                Text("Пробный чек-лист. Отметки сохраняются только до закрытия приложения. Это часть сборки, а не проверка готовности ПК к включению.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Чек-лист")
    }
}
