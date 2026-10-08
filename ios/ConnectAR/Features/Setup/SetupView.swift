import SwiftUI

struct SetupView: View {
    @EnvironmentObject private var session: AssemblySession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Form {
            Section {
                Text(session.board.name).font(.headline)
                Text("Расскажите о компонентах — составим план полной сборки.")
            }
            ForEach(session.board.setup) { question in
                Section(question.title) {
                    if question.options.allSatisfy({ $0.title.count <= 8 }) && !typeSize.isAccessibilitySize {
                        picker(question).pickerStyle(.segmented)
                    } else {
                        picker(question).pickerStyle(.menu)
                    }
                }
            }
            Section {
                Text("В плане: \(session.steps.count) шагов")
                Button(session.configured ? "Готово" : "Построить чек-лист") {
                    session.completeSetup()
                    dismiss()
                }
                .font(.headline)
                .accessibilityIdentifier("completeSetup")
            }
        }
        .navigationTitle("Ваша сборка")
        .interactiveDismissDisabled(!session.configured)
    }

    private func picker(_ question: SetupQuestion) -> some View {
        Picker(question.title, selection: Binding(
            get: { session.answers[question.id] ?? question.defaultAnswer },
            set: { session.setAnswer(question.id, optionID: $0) }
        )) {
            ForEach(question.options) { option in Text(option.title).tag(option.id) }
        }
        .accessibilityIdentifier("setup-\(question.id)")
    }
}
