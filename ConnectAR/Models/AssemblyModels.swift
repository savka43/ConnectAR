import Foundation

struct PCComponent: Identifiable, Hashable {
    let id: String
    let name: String
    let symbol: String
}

struct BoardConnector: Identifiable, Hashable {
    let id: String
    let name: String
    let component: PCComponent
}

struct AssemblyStep: Identifiable, Hashable {
    let id: String
    let title: String
    let connector: BoardConnector
    let instruction: String
    let manualPage: Int
}

struct Motherboard: Identifiable {
    let id: String
    let name: String
    let manualURL: URL
    let steps: [AssemblyStep]
}
