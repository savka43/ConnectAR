import SwiftUI

enum AppTab: Hashable { case home, camera, instructions, checklist }

struct RootView: View {
    @StateObject private var session = AssemblySession()
    @State private var selection: AppTab = .home

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
        .tint(.teal)
        .environmentObject(session)
    }
}
