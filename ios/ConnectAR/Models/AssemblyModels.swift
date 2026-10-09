import Foundation

typealias AssemblyAnswers = [String: String]
typealias AnswerCondition = [String: [String]]

struct BoardSize: Codable, Equatable { let widthMm: Double; let heightMm: Double }
struct BoardTarget: Codable { let image: String }
struct ConnectorRect: Codable, Hashable {
    let x: Double; let y: Double; let w: Double; let h: Double
}
struct BoardConnector: Codable, Identifiable {
    let id: String
    let name: String
    let hint: String?
    let rectMm: ConnectorRect?
    var description: String { hint.map { "\(name) (\($0))" } ?? name }
}
struct SetupOption: Codable, Identifiable { let id: String; let title: String }
struct SetupQuestion: Codable, Identifiable {
    let id: String
    let title: String
    let options: [SetupOption]
    let defaultAnswer: String
    enum CodingKeys: String, CodingKey { case id, title, options; case defaultAnswer = "default" }
}
struct AssemblyPhase: Codable, Identifiable { let id: String; let title: String }
struct StepIcons: Codable, Equatable { let ios: String?; let web: String? }
struct StepVariant: Codable {
    let when: AnswerCondition
    let title: String?
    let connectorIds: [String]?
    let cableIds: [String]?
    let instruction: String?
    let substeps: [String]?
    let warning: String?
}
struct StepDefinition: Codable, Identifiable {
    let id: String
    let phaseId: String
    let title: String
    let instruction: String
    let icons: StepIcons?
    let when: AnswerCondition?
    let repeatQuestion: String?
    let pool: String?
    let connectorIds: [String]?
    let cableIds: [String]?
    let substeps: [String]?
    let warning: String?
    let manualPage: Int?
    let requires: [String]?
    let variants: [StepVariant]?
    enum CodingKeys: String, CodingKey {
        case id, phaseId, title, instruction, icons, when, pool, connectorIds, cableIds
        case substeps, warning, manualPage, requires, variants
        case repeatQuestion = "repeat"
    }
}
struct CableVariant: Codable {
    let when: AnswerCondition
    let psuSide: String?
    let warning: String?
}
struct BoardCable: Codable, Identifiable {
    let id: String
    let name: String
    let deviceSide: String
    var psuSide: String?
    var warning: String?
    var variants: [CableVariant]?
}
struct Motherboard: Codable, Identifiable {
    let schemaVersion: Int?
    let id: String
    let name: String
    let revision: String?
    let physical: BoardSize
    let target: BoardTarget?
    let manualURL: URL
    let setup: [SetupQuestion]
    let phases: [AssemblyPhase]
    let connectors: [BoardConnector]
    let pools: [String: [String]]?
    let cables: [BoardCable]?
    let steps: [StepDefinition]
}

struct AssemblyStep: Identifiable, Equatable {
    let id: String
    let stepId: String
    let phaseId: String
    let title: String
    let icons: StepIcons?
    let connectorIds: [String]
    let cableIds: [String]
    let instruction: String
    let substeps: [String]
    let warning: String?
    let manualPage: Int?
    let requires: [String]
    var symbol: String { icons?.ios ?? "wrench.and.screwdriver" }
}
