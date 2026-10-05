import SwiftUI

struct InstructionsView: View {
    @EnvironmentObject private var session: AssemblySession

    var body: some View {
        List {
            Section(session.board.name) {
                ForEach(session.board.steps) { step in
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
                Button(session.completedSteps.contains(step.id) ? "Снять отметку выполнения" : "Отметить выполненным") {
                    session.toggle(step)
                }
            }
        }
        .navigationTitle(step.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
