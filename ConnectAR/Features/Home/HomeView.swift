import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: AssemblySession
    @Binding var selection: AppTab

    var body: some View {
        List {
            Section {
                Label("Собери ПК шаг за шагом", systemImage: "cpu")
                    .font(.title2.bold()).padding(.vertical, 12)
                Text("Выберите компонент, изучите разъём и отметьте выполненный шаг.")
                    .foregroundStyle(.secondary)
            }
            Section("Плата прототипа") {
                Text(session.board.name).font(.headline)
                Text("Сценарий подключения компонентов")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("Перед подключением компонентов отключите ПК от электросети. Процессор и охлаждение в этом сценарии уже установлены.")
            }
            Section("Моя сборка") {
                NavigationLink("Выбрать компоненты") { BuildConfigurationView() }
                ProgressView(value: session.progress)
                Text("Выполнено: \(session.completedSteps.count) из \(session.steps.count)")
                Button("Открыть чек-лист", systemImage: "checklist") { selection = .checklist }
                Button("Посмотреть подсказки", systemImage: "lightbulb") { selection = .instructions }
                Button("Открыть камеру", systemImage: "camera") { selection = .camera }
            }
        }
        .navigationTitle("ConnectAR")
    }
}
