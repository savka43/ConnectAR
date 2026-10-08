import SwiftUI

struct InstructionsView: View {
    @EnvironmentObject private var session: AssemblySession
    @State private var query = ""

    private var results: [AssemblyStep] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return session.steps.filter { step in
            search.isEmpty || ([step.title] + session.connectors(for: step).map(\.name))
                .contains { $0.localizedStandardContains(search) }
        }
    }

    var body: some View {
        List {
            ForEach(session.board.phases) { phase in
                let steps = results.filter { $0.phaseId == phase.id }
                if !steps.isEmpty {
                    Section(phase.title) {
                        ForEach(steps) { step in
                            NavigationLink { InstructionDetailView(step: step) } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(step.title)
                                        Text(session.connectorSummary(for: step)).font(.caption).foregroundStyle(.secondary)
                                    }
                                } icon: { Image(systemName: step.symbol) }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Подсказки")
        .searchable(text: $query, prompt: "Шаг или разъём")
        .overlay { if results.isEmpty { ContentUnavailableView.search(text: query) } }
    }
}

struct InstructionDetailView: View {
    @EnvironmentObject private var session: AssemblySession
    let step: AssemblyStep
    @FocusState private var editingNote: Bool
    // Resolve the ID again so a visible card follows changed answers and cable variants.
    private var current: AssemblyStep? { session.steps.first { $0.id == step.id } }

    var body: some View {
        Group {
            if let step = current {
                List {
                    Section {
                        Label(step.title, systemImage: step.symbol).font(.title2.bold())
                        if session.nextStep?.id == step.id {
                            Label("Текущий шаг", systemImage: "arrow.right.circle.fill").foregroundStyle(.teal)
                        }
                        Text(step.connectorIds.isEmpty ? "Этот шаг без разметки на плате" : "На плате: " + session.connectorSummary(for: step))
                            .foregroundStyle(.secondary)
                        Text(step.instruction)
                    }
                    if !step.substeps.isEmpty {
                        Section("Как сделать") {
                            ForEach(Array(step.substeps.enumerated()), id: \.offset) { index, text in
                                HStack(alignment: .top) {
                                    Text("\(index + 1).").bold()
                                    Text(text)
                                }
                            }
                        }
                    }
                    if let warning = step.warning { warningSection(warning) }
                    ForEach(session.cables(for: step)) { cable in
                        Section(cable.name) {
                            Text(cable.deviceSide)
                            if let psuSide = cable.psuSide {
                                Text("Со стороны блока питания").font(.headline)
                                Text(psuSide)
                            }
                            if let warning = cable.warning {
                                Label(warning, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                            }
                        }
                    }
                    if let page = step.manualPage {
                        Section { Link("Руководство платы • стр. \(page)", destination: session.board.manualURL) }
                    }
                    Section {
                        TextField("Модель компонента, вопрос или напоминание", text: Binding(
                            get: { session.notes[step.id] ?? "" },
                            set: { session.setNote($0, for: step) }
                        ), axis: .vertical)
                        .lineLimit(3...8).focused($editingNote).accessibilityLabel("Заметка к шагу")
                    } header: { Text("Моя заметка") } footer: { Text("Сохраняется автоматически на этом устройстве.") }
                    Section {
                        StepCompletionButton(step: step)
                        if session.isLocked(step), let hint = session.requiresHint(step) {
                            Text(hint).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if session.completedSteps.contains(step.id), let next = session.nextStep {
                            NavigationLink("Следующий шаг: \(next.title)") { InstructionDetailView(step: next) }
                        }
                    }
                }
            } else {
                ContentUnavailableView("Шаг больше не входит в сборку", systemImage: "checklist",
                    description: Text("Состав сборки изменился. Выберите шаг из обновлённого чек-листа."))
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Готово") { editingNote = false } } }
        .navigationTitle(current?.title ?? step.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func warningSection(_ text: String) -> some View {
        Section("Важно") {
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.primary).listRowBackground(Color.orange.opacity(0.15))
        }
    }
}
