import Foundation

struct BoardPoint: Equatable {
    var x: Double
    var y: Double
    static func distance(_ a: Self, _ b: Self) -> Double { hypot(a.x - b.x, a.y - b.y) }
}

extension ConnectorRect {
    var corners: [BoardPoint] {
        [BoardPoint(x: x, y: y), BoardPoint(x: x + w, y: y),
         BoardPoint(x: x + w, y: y + h), BoardPoint(x: x, y: y + h)]
    }
    var center: BoardPoint { BoardPoint(x: x + w / 2, y: y + h / 2) }
    func overlaps(_ other: Self) -> Bool {
        x < other.x + other.w && other.x < x + w && y < other.y + other.h && other.y < y + h
    }
}

enum BoardGeometry {
    static func corners(_ physical: BoardSize) -> [BoardPoint] {
        ConnectorRect(x: 0, y: 0, w: physical.widthMm, h: physical.heightMm).corners
    }
    static func anchor(_ point: BoardPoint, physical: BoardSize) -> [Double] {
        [(point.x - physical.widthMm / 2) / 1000, 0, (point.y - physical.heightMm / 2) / 1000]
    }
    static func cross(_ a: BoardPoint, _ b: BoardPoint, _ c: BoardPoint) -> Double {
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    }
    static func area(_ points: [BoardPoint]) -> Double {
        guard points.count >= 3 else { return 0 }
        return abs(points.indices.reduce(0) { sum, i in
            let next = points[(i + 1) % points.count]
            return sum + points[i].x * next.y - next.x * points[i].y
        }) / 2
    }
    // Coordinates use a downward y axis. Out-of-frame corners remain valid.
    static func validQuad(_ points: [BoardPoint], imageSize: BoardPoint, physical: BoardSize) -> Bool {
        guard points.count == 4, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              imageSize.x > 0, imageSize.y > 0, physical.widthMm > 0, physical.heightMm > 0 else { return false }
        guard points.indices.allSatisfy({ cross(points[$0], points[($0 + 1) % 4], points[($0 + 2) % 4]) > 1e-9 }),
              area(points) >= 0.03 * imageSize.x * imageSize.y else { return false }
        let ratio = (BoardPoint.distance(points[0], points[1]) + BoardPoint.distance(points[3], points[2])) /
            (BoardPoint.distance(points[1], points[2]) + BoardPoint.distance(points[0], points[3])) /
            (physical.widthMm / physical.heightMm)
        return ratio >= 0.5 && ratio <= 2
    }
    static func contains(_ point: BoardPoint, polygon: [BoardPoint]) -> Bool {
        guard polygon.count >= 3 else { return false }
        var inside = false
        var j = polygon.count - 1
        for i in polygon.indices {
            let a = polygon[i], b = polygon[j]
            if (a.y > point.y) != (b.y > point.y),
               point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x { inside.toggle() }
            j = i
        }
        return inside
    }
}

struct BoardHomography {
    let matrix: [Double]

    func apply(_ point: BoardPoint) -> BoardPoint? {
        let m = matrix
        let w = m[6] * point.x + m[7] * point.y + m[8]
        guard w.isFinite, abs(w) > 1e-12 else { return nil }
        let p = BoardPoint(x: (m[0] * point.x + m[1] * point.y + m[2]) / w,
                           y: (m[3] * point.x + m[4] * point.y + m[5]) / w)
        return p.x.isFinite && p.y.isFinite ? p : nil
    }

    // Four correspondences, normalized around their centroid before Gaussian elimination.
    // Photo mode has exactly four user-supplied corners; no RANSAC is necessary here.
    static func solve(source: [BoardPoint], destination: [BoardPoint]) -> Self? {
        guard source.count == 4, destination.count == 4 else { return nil }
        func normalize(_ points: [BoardPoint]) -> (points: [BoardPoint], matrix: [Double], inverse: [Double])? {
            guard points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }
            let center = BoardPoint(x: points.map(\.x).reduce(0, +) / 4, y: points.map(\.y).reduce(0, +) / 4)
            let distance = points.map { BoardPoint.distance($0, center) }.reduce(0, +) / 4
            guard distance > 1e-10 else { return nil }
            let k = sqrt(2) / distance
            let normalized = points.map { BoardPoint(x: ($0.x - center.x) * k, y: ($0.y - center.y) * k) }
            for i in 0..<2 { for j in (i + 1)..<3 { for l in (j + 1)..<4 {
                if abs(BoardGeometry.cross(normalized[i], normalized[j], normalized[l])) < 1e-8 { return nil }
            } } }
            return (normalized, [k, 0, -k * center.x, 0, k, -k * center.y, 0, 0, 1],
                    [1 / k, 0, center.x, 0, 1 / k, center.y, 0, 0, 1])
        }
        guard let a = normalize(source), let b = normalize(destination) else { return nil }
        var rows: [[Double]] = []
        for i in 0..<4 {
            let x = a.points[i].x, y = a.points[i].y, u = b.points[i].x, v = b.points[i].y
            rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
            rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, v])
        }
        for column in 0..<8 {
            let pivot = (column..<8).max { abs(rows[$0][column]) < abs(rows[$1][column]) }!
            guard abs(rows[pivot][column]) > 1e-10 else { return nil }
            rows.swapAt(column, pivot)
            let divisor = rows[column][column]
            for j in column..<9 { rows[column][j] /= divisor }
            for i in 0..<8 where i != column {
                let factor = rows[i][column]
                for j in column..<9 { rows[i][j] -= factor * rows[column][j] }
            }
        }
        let normalizedMatrix = rows.map { $0[8] } + [1]
        func multiply(_ a: [Double], _ b: [Double]) -> [Double] {
            var c = Array(repeating: 0.0, count: 9)
            for r in 0..<3 { for col in 0..<3 { for k in 0..<3 { c[r * 3 + col] += a[r * 3 + k] * b[k * 3 + col] } } }
            return c
        }
        let result = multiply(b.inverse, multiply(normalizedMatrix, a.matrix))
        guard result.allSatisfy(\.isFinite), abs(result[8]) > 1e-12 else { return nil }
        return Self(matrix: result.map { $0 / result[8] })
    }
}
