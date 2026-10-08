import SwiftUI

enum AppTab: Hashable { case home, camera, instructions, checklist }

struct RootView: View {
    @State private var board: Motherboard?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let board {
                AssemblyRootView(board: board)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Не удалось загрузить данные платы", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Повторить", action: load)
                }
            } else {
                ProgressView("Загрузка платы…")
            }
        }
        .task { if board == nil { load() } }
    }

    private func load() {
        do { board = try BoardRepository.load(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
}

private struct AssemblyRootView: View {
    @StateObject private var session: AssemblySession
    @State private var selection: AppTab = .home
    @State private var showingSetup: Bool

    init(board: Motherboard) {
        let session = AssemblySession(board: board)
        _session = StateObject(wrappedValue: session)
        _showingSetup = State(initialValue: !session.configured)
    }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { HomeView(selection: $selection) }
                .tabItem { Label("Главная", systemImage: "house") }.tag(AppTab.home)
            NavigationStack { CameraView() }
                .tabItem { Label("Камера", systemImage: "camera") }.tag(AppTab.camera)
            NavigationStack { InstructionsView() }
                .tabItem { Label("Подсказки", systemImage: "lightbulb") }.tag(AppTab.instructions)
            NavigationStack { ChecklistView() }
                .tabItem { Label("Чек-лист", systemImage: "checklist") }.tag(AppTab.checklist)
        }
        .sheet(isPresented: $showingSetup) {
            NavigationStack { SetupView() }.interactiveDismissDisabled(!session.configured)
        }
        .onChange(of: session.configured) { _, configured in
            if configured { selection = .checklist }
        }
        .tint(.teal)
        .environmentObject(session)
    }
}
