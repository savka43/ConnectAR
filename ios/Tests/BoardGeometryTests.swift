import Foundation

enum BoardGeometryTests {
    struct LayoutFixtures: Decodable {
        let tolerance: Double
        let cases: [Case]
        struct Case: Decodable { let name: String; let physical: BoardSize; let rectMm: ConnectorRect; let expected: Expected }
        struct Expected: Decodable { let anchorM: [Double]; let cornersM: [[Double]] }
    }
    static func run(root: URL) throws {
        let fixtures = try JSONDecoder().decode(LayoutFixtures.self, from: Data(contentsOf: root.appendingPathComponent("fixtures/layout-cases.json")))
        for test in fixtures.cases {
            let center = BoardGeometry.anchor(test.rectMm.center, physical: test.physical)
            check(zip(center, test.expected.anchorM).allSatisfy { abs($0 - $1) < fixtures.tolerance }, "\(test.name): center")
            for (point, expected) in zip(test.rectMm.corners, test.expected.cornersM) {
                check(zip(BoardGeometry.anchor(point, physical: test.physical), expected).allSatisfy { abs($0 - $1) < fixtures.tolerance }, "\(test.name): corners")
            }
        }
        let physical = BoardSize(widthMm: 244, heightMm: 244)
        let source = BoardGeometry.corners(physical)
        let known = BoardHomography(matrix: [12, 0.4, 300, 0.3, 10, 240, 0.0003, 0.00015, 1])
        let destination = source.map { known.apply($0)! }
        let solved = BoardHomography.solve(source: source, destination: destination)!
        for x in stride(from: 0.0, through: 244, by: 11) {
            for y in stride(from: 0.0, through: 244, by: 17) {
                let point = BoardPoint(x: x, y: y)
                check(BoardPoint.distance(known.apply(point)!, solved.apply(point)!) < 1e-7, "Perspective reconstruction")
            }
        }
        let imageSize = BoardPoint(x: 4000, y: 3000)
        check(BoardGeometry.validQuad(destination, imageSize: imageSize, physical: physical), "Valid clockwise quad")
        check(!BoardGeometry.validQuad([destination[0], destination[2], destination[1], destination[3]], imageSize: imageSize, physical: physical), "Bow tie")
        check(!BoardGeometry.validQuad(Array(destination.reversed()), imageSize: imageSize, physical: physical), "Counterclockwise")
        let outside = [BoardPoint(x: -100, y: -100), BoardPoint(x: 3000, y: -100), BoardPoint(x: 3000, y: 3000), BoardPoint(x: -100, y: 3000)]
        check(BoardGeometry.validQuad(outside, imageSize: imageSize, physical: physical), "Out-of-frame corners")
        check(BoardHomography.solve(source: source, destination: Array(repeating: BoardPoint(x: 1, y: 1), count: 4)) == nil, "Coincident points")
        check(BoardHomography.solve(source: source, destination: [BoardPoint(x: 0, y: 0), BoardPoint(x: 1, y: 1), BoardPoint(x: 2, y: 2), BoardPoint(x: 4, y: 1)]) == nil, "Collinear triple")
        check(BoardGeometry.contains(BoardPoint(x: 122, y: 122), polygon: source), "Polygon hit")
        check(!BoardGeometry.contains(BoardPoint(x: -1, y: 122), polygon: source), "Polygon miss")

        let data = Data(#"""
        {"id":"markers","name":"Markers","manualURL":"https://example.com","physical":{"widthMm":100,"heightMm":100},
         "setup":[],"phases":[],"connectors":[
           {"id":"socket","name":"CPU","rectMm":{"x":10,"y":10,"w":20,"h":20}},
           {"id":"cooler","name":"Cooler","rectMm":{"x":5,"y":5,"w":40,"h":40}},
           {"id":"sata0","name":"SATA 0","hint":"check port","rectMm":{"x":60,"y":60,"w":10,"h":10}},
           {"id":"sata1","name":"SATA 1","rectMm":{"x":60,"y":60,"w":10,"h":10}},
           {"id":"fan","name":"Fan","rectMm":{"x":80,"y":10,"w":10,"h":10}}],
         "steps":[
           {"id":"cpu","phaseId":"a","title":"CPU","instruction":"CPU","connectorIds":["socket"]},
           {"id":"cooler","phaseId":"a","title":"Cooler","instruction":"Cooler","connectorIds":["cooler"],"requires":["cpu"]},
           {"id":"sata0","phaseId":"a","title":"Disk 1","instruction":"Disk","connectorIds":["sata0"]},
           {"id":"sata1","phaseId":"a","title":"Disk 2","instruction":"Disk","connectorIds":["sata1"]},
           {"id":"fan","phaseId":"a","title":"Fan","instruction":"Fan","connectorIds":["fan"],"requires":["cooler"]}]}
        """#.utf8)
        let board = try JSONDecoder().decode(Motherboard.self, from: data)
        let plan = AssemblyPlanner.resolve(board: board, answers: [:])
        let markers = BoardMarkers.make(board: board, plan: plan, done: ["cpu"])
        check(markers.first { $0.id == "socket" }?.showLabel == false, "Hide completed overlap label")
        check(!markers.contains { $0.id == "fan" }, "Hide locked connector")
        let sata = markers.first { $0.id == "sata0" }!
        check(sata.label == "SATA 0 / SATA 1" && sata.connectorIDs == ["sata0", "sata1"], "Merge identical rectangles")
        let old = BoardMarkers.make(board: board, plan: plan, done: ["fan"])
        check(old.contains { $0.id == "fan" && $0.state == .done }, "Old completed dependency state remains visible")
        let next = BoardMarkers.make(board: board, plan: plan, done: ["cpu", "cooler"])
        check(next.first { $0.id == "sata0" }?.state == .current, "Advance current marker")
        check(next.first { $0.id == "sata0" }?.label.contains("check port") == true, "Current hint")

        let inputs = [
            PhotoLabelInput(id: "a", anchor: BoardPoint(x: 12, y: 12), size: BoardPoint(x: 80, y: 24), state: .current, order: 0),
            PhotoLabelInput(id: "b", anchor: BoardPoint(x: 12, y: 12), size: BoardPoint(x: 80, y: 24), state: .current, order: 1),
            PhotoLabelInput(id: "c", anchor: BoardPoint(x: 12, y: 12), size: BoardPoint(x: 80, y: 24), state: .pending, order: 2)]
        let viewport = BoardPoint(x: 320, y: 200)
        let placed = BoardMarkers.layout(inputs, viewport: viewport)
        let reversed = BoardMarkers.layout(Array(inputs.reversed()), viewport: viewport)
        check(placed["a"]!.visible && placed["b"]!.visible, "Both current labels visible")
        check(placed["a"]!.center != placed["b"]!.center, "Edge clamping before collision check")
        for input in inputs {
            let label = placed[input.id]!
            check(label.center == reversed[input.id]!.center && label.visible == reversed[input.id]!.visible, "Deterministic layout")
            if label.visible {
                check(label.center.x - input.size.x / 2 >= 4 && label.center.y - input.size.y / 2 >= 4, "Labels inside viewport")
            }
        }
        check(placed["b"]!.leader, "Displaced label leader")
        print("PASS: \(fixtures.cases.count) shared layout fixtures, homography, quad validation, markers and label layout")
    }
}
