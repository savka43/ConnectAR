import Foundation

enum AssemblyPlanner {
    static func normalize(_ answers: AssemblyAnswers, board: Motherboard) -> AssemblyAnswers {
        Dictionary(uniqueKeysWithValues: board.setup.map { question in
            let value = answers[question.id] ?? question.defaultAnswer
            return (question.id, question.options.contains { $0.id == value } ? value : question.defaultAnswer)
        })
    }

    static func matches(_ condition: AnswerCondition?, answers: AssemblyAnswers) -> Bool {
        condition?.allSatisfy { question, values in values.contains(answers[question] ?? "") } ?? true
    }

    static func resolve(board: Motherboard, answers raw: AssemblyAnswers) -> [AssemblyStep] {
        let answers = normalize(raw, board: board)
        var plan: [AssemblyStep] = []
        var cursors: [String: Int] = [:]
        var instances: [String: [String]] = [:]
        for step in board.steps where matches(step.when, answers: answers) {
            let required = (step.requires ?? []).flatMap { instances[$0] ?? [] }
            instances[step.id] = []
            let variant = step.variants?.first { matches($0.when, answers: answers) }
            let count = step.repeatQuestion.map { Int(answers[$0] ?? "0") ?? 0 } ?? 1
            guard count > 0 else { continue }
            for n in 1...count {
                var connectors = variant?.connectorIds ?? step.connectorIds ?? []
                var port = "—"
                if let poolID = step.pool {
                    let pool = board.pools?[poolID] ?? []
                    let index = cursors[poolID, default: 0]
                    cursors[poolID] = index + 1
                    if index < pool.count {
                        connectors.append(pool[index])
                        port = board.connectors.first { $0.id == pool[index] }?.name ?? "—"
                    }
                }
                func fill(_ value: String) -> String {
                    value.replacingOccurrences(of: "{n}", with: String(n)).replacingOccurrences(of: "{port}", with: port)
                }
                let id = step.repeatQuestion == nil ? step.id : "\(step.id)-\(n)"
                instances[step.id, default: []].append(id)
                plan.append(AssemblyStep(id: id, stepId: step.id, phaseId: step.phaseId,
                    title: fill(variant?.title ?? step.title), icons: step.icons,
                    connectorIds: connectors, cableIds: variant?.cableIds ?? step.cableIds ?? [],
                    instruction: fill(variant?.instruction ?? step.instruction),
                    substeps: (variant?.substeps ?? step.substeps ?? []).map(fill),
                    warning: (variant?.warning ?? step.warning).map(fill),
                    manualPage: step.manualPage, requires: required))
            }
        }
        return plan
    }

    static func resolveCable(_ cable: BoardCable, board: Motherboard, answers: AssemblyAnswers) -> BoardCable {
        let normalized = normalize(answers, board: board)
        let variant = cable.variants?.first { matches($0.when, answers: normalized) }
        var result = cable
        result.psuSide = variant?.psuSide ?? cable.psuSide
        result.warning = variant?.warning ?? cable.warning
        result.variants = nil
        return result
    }

    static func unmetRequires(_ step: AssemblyStep, done: Set<String>) -> [String] {
        step.requires.filter { !done.contains($0) }
    }

    static func doneDependents(plan: [AssemblyStep], done: Set<String>, stepID: String) -> [AssemblyStep] {
        var affected: Set<String> = [stepID]
        var result: [AssemblyStep] = []
        for step in plan where step.id != stepID {
            if step.requires.contains(where: affected.contains) {
                affected.insert(step.id)
                if done.contains(step.id) { result.append(step) }
            }
        }
        return result
    }

    static func requiresHint(plan: [AssemblyStep], step: AssemblyStep, done: Set<String>) -> String? {
        let names = unmetRequires(step, done: done).compactMap { id in plan.first { $0.id == id }?.title }
        guard !names.isEmpty else { return nil }
        // iOS specification limits the visible list to two titles.
        let suffix = names.count > 2 ? " и ещё \(names.count - 2)" : ""
        return "Сначала: " + names.prefix(2).joined(separator: ", ") + suffix
    }
}
