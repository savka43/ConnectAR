import SwiftUI

struct CameraView: View {
    @EnvironmentObject private var session: AssemblySession
    private let recognition: any RecognitionService = PrototypeRecognitionService()

    var body: some View {
        List {
            Section {
                Image(systemName: "viewfinder")
                    .font(.system(size: 80, weight: .ultraLight))
                    .foregroundStyle(.teal)
                    .frame(maxWidth: .infinity).padding(.vertical, 36)
                Text("Найдём нужный разъём").font(.title2.bold())
                switch recognition.status {
                case .unavailable:
                    Text("Съёмка и AR-распознавание появятся позже. Пока выберите компонент вручную и откройте подсказку.")
                        .foregroundStyle(.secondary)
                }
            }
            Section("Ручной выбор • \(session.board.name)") {
                ForEach(session.board.steps) { step in
                    NavigationLink(step.connector.component.name) {
                        InstructionDetailView(step: step)
                    }
                }
            }
        }
        .navigationTitle("Камера")
    }
}
