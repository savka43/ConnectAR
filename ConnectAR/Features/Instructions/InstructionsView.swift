import SwiftUI

struct InstructionsView: View {
    @EnvironmentObject private var session: AssemblySession

    @State private var query = ""

    private var results: [AssemblyStep] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !search.isEmpty else { return session.board.steps }
        return session.board.steps.filter { step in
            [step.title, step.connector.name, step.connector.component.name]
                .contains { $0.localizedStandardContains(search) }
        }
    }

    var body: some View {
        List {
            Section(session.board.name) {
                ForEach(results) { step in
                    NavigationLink { InstructionDetailView(step: step) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(step.connector.component.name)
                                Text(step.connector.name).font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: { Image(systemName: step.connector.component.symbol) }
                    }
                }
            }
        }
        .navigationTitle("Подсказки")
        .searchable(text: $query, prompt: "Компонент или разъём")
        .overlay {
            if results.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
    }
}

struct InstructionDetailView: View {
    @EnvironmentObject private var session: AssemblySession
    let step: AssemblyStep

    var body: some View {
        List {
            Section(step.connector.component.name) {
                Label(step.connector.name, systemImage: step.connector.component.symbol)
                    .font(.title2.bold())
                Text(step.instruction)
            }
            Section {
                Text("Подключайте компоненты только при отключённом от сети питании.")
                Link("Руководство платы • стр. \(step.manualPage)", destination: session.board.manualURL)
            }
            Section {
                if !session.selectedStepIDs.contains(step.id) {
                    Button("Добавить в мою сборку") { session.select(step, included: true) }
                } else {
                    Button(session.completedSteps.contains(step.id) ? "Снять отметку выполнения" : "Отметить выполненным") {
                        session.toggle(step)
                    }
                    if session.completedSteps.contains(step.id), let next = session.nextStep {
                        NavigationLink("Следующий шаг: \(next.title)") {
                            InstructionDetailView(step: next)
                        }
                    }
                }
            }
        }
        .navigationTitle(step.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
