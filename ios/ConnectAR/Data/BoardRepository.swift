import Foundation

enum BoardRepository {
    enum LoadError: LocalizedError {
        case missingResources, unsupportedSchema(Int?), invalidBoard(String)
        var errorDescription: String? {
            switch self {
            case .missingResources: return "В приложении отсутствует папка shared_boards."
            case .unsupportedSchema(let version): return "Неподдерживаемая версия данных: \(version.map(String.init) ?? "не указана")."
            case .invalidBoard(let reason): return "Некорректные данные платы: \(reason)"
            }
        }
    }

    static func load(bundle: Bundle = .main, id: String = "gigabyte-b450-aorus-m") throws -> Motherboard {
        guard let root = bundle.resourceURL?.appendingPathComponent("shared_boards"),
              FileManager.default.fileExists(atPath: root.path) else { throw LoadError.missingResources }
        return try load(root: root, id: id)
    }

    static func load(root: URL, id: String) throws -> Motherboard {
        guard !id.isEmpty, id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else {
            throw LoadError.invalidBoard("недопустимый идентификатор")
        }
        let url = root.appendingPathComponent("boards/\(id)/board.json")
        let board = try JSONDecoder().decode(Motherboard.self, from: Data(contentsOf: url))
        guard board.schemaVersion == 3 else { throw LoadError.unsupportedSchema(board.schemaVersion) }
        guard board.id == id, board.physical.widthMm > 0, board.physical.heightMm > 0,
              !board.setup.isEmpty, !board.phases.isEmpty, !board.steps.isEmpty else {
            throw LoadError.invalidBoard("размеры, опрос или этапы отсутствуют")
        }
        for ids in [board.setup.map(\.id), board.phases.map(\.id), board.connectors.map(\.id), board.steps.map(\.id)] {
            guard Set(ids).count == ids.count else { throw LoadError.invalidBoard("повторяющиеся идентификаторы") }
        }
        for question in board.setup {
            guard question.options.contains(where: { $0.id == question.defaultAnswer }) else {
                throw LoadError.invalidBoard("ответ по умолчанию для \(question.id)")
            }
        }
        return board
    }
}
