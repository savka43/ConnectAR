import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: AssemblySession
    @Binding var selection: AppTab

    var body: some View {
        List {
            Section {
                Label("Собери ПК шаг за шагом", systemImage: "cpu").font(.title2.bold())
                Text(session.board.name).foregroundStyle(.secondary)
            }
            Section("Продолжить сборку") {
                if let step = session.nextStep {
                    NavigationLink { InstructionDetailView(step: step) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(step.title).font(.headline)
                                Text(session.connectorSummary(for: step)).font(.subheadline).foregroundStyle(.secondary)
                            }
                        } icon: { Image(systemName: step.symbol) }
                    }
                } else {
                    Label("Все шаги выполнены", systemImage: "checkmark.seal.fill").foregroundStyle(.teal)
                }
            }
            Section("Моя сборка") {
                Text(session.summary).font(.subheadline)
                NavigationLink("Изменить сборку") { SetupView() }
                ProgressView(value: session.progress)
                Text("Выполнено \(session.completedCount) из \(session.steps.count)")
                Button("Открыть чек-лист", systemImage: "checklist") { selection = .checklist }
                Button("Посмотреть подсказки", systemImage: "lightbulb") { selection = .instructions }
                Button("Открыть камеру", systemImage: "camera") { selection = .camera }
            }
        }
        .navigationTitle("ConnectAR")
    }
}
