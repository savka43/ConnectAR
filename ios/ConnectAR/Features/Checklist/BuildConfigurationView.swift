import SwiftUI

struct BuildConfigurationView: View {
    @EnvironmentObject private var session: AssemblySession

    var body: some View {
        Form {
            Section {
                ForEach(session.board.steps) { step in
                    Toggle(isOn: Binding(
                        get: { session.selectedStepIDs.contains(step.id) },
                        set: { session.select(step, included: $0) }
                    )) {
                        Label(step.connector.component.name, systemImage: step.connector.component.symbol)
                    }
                }
            } header: { Text("Что подключаем?") } footer: {
                Text("Чек-лист формируется из выбранных компонентов. Если убрать компонент, его отметка выполнения сбросится.")
            }
        }
        .navigationTitle("Состав сборки")
        .navigationBarTitleDisplayMode(.inline)
    }
}
