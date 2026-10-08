import Foundation

enum MarkerState: Int { case current, pending, done }
struct BoardMarker: Identifiable {
    let id: String
    let connectorIDs: [String]
    let rect: ConnectorRect
    let stepID: String
    let state: MarkerState
    let order: Int
    let label: String
    var showLabel: Bool
}
struct PhotoLabelInput {
    let id: String
    let anchor: BoardPoint
    let size: BoardPoint
    let state: MarkerState
    let order: Int
}
struct PhotoLabel {
    let center: BoardPoint
    let visible: Bool
    let leader: Bool
}

enum BoardMarkers {
    static func make(board: Motherboard, plan: [AssemblyStep], done: Set<String>) -> [BoardMarker] {
        let current = plan.first { !done.contains($0.id) }?.id
        var groups: [ConnectorRect: [BoardMarker]] = [:]
        var groupOrder: [ConnectorRect] = []
        for connector in board.connectors {
            guard let rect = connector.rectMm else { continue }
            let relevant = plan.enumerated().filter { _, step in
                step.connectorIds.contains(connector.id) &&
                (done.contains(step.id) || step.id == current || AssemblyPlanner.unmetRequires(step, done: done).isEmpty)
            }
            guard !relevant.isEmpty else { continue }
            let state: MarkerState = relevant.contains { $0.element.id == current } ? .current :
                (relevant.allSatisfy { done.contains($0.element.id) } ? .done : .pending)
            let main = relevant.first { $0.element.id == current } ?? relevant.first { !done.contains($0.element.id) } ?? relevant[0]
            if groups[rect] == nil { groupOrder.append(rect) }
            groups[rect, default: []].append(BoardMarker(id: connector.id, connectorIDs: [connector.id], rect: rect,
                stepID: main.element.id, state: state, order: main.offset, label: connector.name, showLabel: true))
        }
        var result = groupOrder.map { rect -> BoardMarker in
            let entries = groups[rect]!
            let main = entries.sorted(by: priority)[0]
            let names = entries.map(\.label).joined(separator: " / ")
            let hint = main.state == .current ? board.connectors.first { $0.id == main.id }?.hint : nil
            return BoardMarker(id: main.id, connectorIDs: entries.flatMap(\.connectorIDs), rect: rect,
                stepID: main.stepID, state: main.state, order: main.order,
                label: hint.map { "\(names) · \($0)" } ?? names, showLabel: true)
        }
        for i in result.indices where result[i].state == .done {
            result[i].showLabel = !result.contains { $0.state != .done && result[i].rect.overlaps($0.rect) }
        }
        return result
    }
    private static func priority(_ a: BoardMarker, _ b: BoardMarker) -> Bool {
        if a.state != b.state { return a.state.rawValue < b.state.rawValue }
        if a.order != b.order { return a.order < b.order }
        return a.id < b.id
    }

    static func layout(_ inputs: [PhotoLabelInput], viewport: BoardPoint) -> [String: PhotoLabel] {
        var boxes: [ConnectorRect] = []
        var result: [String: PhotoLabel] = [:]
        let sorted = inputs.sorted {
            if $0.state != $1.state { return $0.state.rawValue < $1.state.rawValue }
            if $0.order != $1.order { return $0.order < $1.order }
            return $0.id < $1.id
        }
        for item in sorted {
            let dx = item.size.x + 4, dy = item.size.y + 4
            let offsets = [BoardPoint(x: 0, y: 0), BoardPoint(x: 0, y: -dy), BoardPoint(x: 0, y: dy),
                BoardPoint(x: 0, y: -2 * dy), BoardPoint(x: 0, y: 2 * dy), BoardPoint(x: -dx, y: 0), BoardPoint(x: dx, y: 0)]
            func clamp(_ value: Double, half: Double, extent: Double) -> Double {
                min(max(value, half + 4), max(half + 4, extent - half - 4))
            }
            let positions = offsets.map { offset in
                BoardPoint(x: clamp(item.anchor.x + offset.x, half: item.size.x / 2, extent: viewport.x),
                           y: clamp(item.anchor.y + offset.y, half: item.size.y / 2, extent: viewport.y))
            }
            func box(_ point: BoardPoint) -> ConnectorRect {
                ConnectorRect(x: point.x - item.size.x / 2, y: point.y - item.size.y / 2, w: item.size.x, h: item.size.y)
            }
            let slot = positions.first { position in
                let b = box(position)
                let padded = ConnectorRect(x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8)
                return !boxes.contains { padded.overlaps($0) }
            } ?? (item.state == .current ? positions[0] : nil)
            if let slot {
                boxes.append(box(slot))
                result[item.id] = PhotoLabel(center: slot, visible: true, leader: BoardPoint.distance(slot, item.anchor) > item.size.y / 2)
            } else {
                result[item.id] = PhotoLabel(center: item.anchor, visible: false, leader: false)
            }
        }
        return result
    }
}
