import UIKit
import Vision
import simd

enum BoardPhotoRecognition {
    /// Finds a board-shaped quadrilateral and returns its corners in clockwise image coordinates.
    /// The photo editor still validates and lets the user refine every automatic result.
    static func corners(in image: UIImage, target: UIImage?, physical: BoardSize) -> [BoardPoint]? {
        guard let cgImage = image.cgImage,
              physical.widthMm > 0, physical.heightMm > 0 else { return nil }

        let imageSize = BoardPoint(x: Double(cgImage.width), y: Double(cgImage.height))
        if let targetCGImage = target?.cgImage,
           let match = register(target: targetCGImage, in: cgImage, imageSize: imageSize, physical: physical) {
            return match
        }

        let expectedRatio = min(physical.widthMm, physical.heightMm) / max(physical.widthMm, physical.heightMm)
        let request = VNDetectRectanglesRequest()
        request.minimumConfidence = 0.25
        request.minimumAspectRatio = Float(max(0.1, expectedRatio * 0.72))
        request.maximumAspectRatio = 1
        request.minimumSize = 0.04
        request.maximumObservations = 12
        request.quadratureTolerance = 35

        do {
            try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])
        } catch {
            return nil
        }

        return request.results?.compactMap { observation -> (points: [BoardPoint], area: Double, confidence: Float)? in
            // Vision uses a bottom-left origin; photo mode uses top-left with y increasing downward.
            let points = [observation.topLeft, observation.topRight,
                          observation.bottomRight, observation.bottomLeft].map {
                BoardPoint(x: Double($0.x) * imageSize.x,
                           y: (1 - Double($0.y)) * imageSize.y)
            }
            guard BoardGeometry.validQuad(points, imageSize: imageSize, physical: physical) else { return nil }
            return (points, BoardGeometry.area(points), observation.confidence)
        }
        .sorted {
            if abs($0.area - $1.area) > imageSize.x * imageSize.y * 0.01 { return $0.area > $1.area }
            return $0.confidence > $1.confidence
        }
        .first?.points
        .map { BoardPoint(x: $0.x / imageSize.x, y: $0.y / imageSize.y) }
    }

    /// Searches overlapping, board-shaped windows and asks Vision for the perspective warp
    /// from the bundled board target to each window. This distinguishes the supported board
    /// from unrelated rectangles before the user is offered automatic corners.
    private static func register(target: CGImage, in photo: CGImage, imageSize: BoardPoint,
                                 physical: BoardSize) -> [BoardPoint]? {
        let width = Double(photo.width), height = Double(photo.height)
        let targetRatio = Double(target.width) / Double(target.height)
        var candidates: [(corners: [BoardPoint], area: Double, confidence: Float)] = []
        var attempted = Set<String>()

        for fraction in [1.0, 0.92, 0.72, 0.54, 0.38] {
            var cropHeight = min(height, width / targetRatio) * fraction
            var cropWidth = cropHeight * targetRatio
            if cropWidth > width { cropWidth = width; cropHeight = cropWidth / targetRatio }
            if cropHeight > height { cropHeight = height; cropWidth = cropHeight * targetRatio }
            guard cropWidth >= 96, cropHeight >= 96 else { continue }
            let maxX = max(0, width - cropWidth), maxY = max(0, height - cropHeight)
            let xPositions = [0, maxX / 2, maxX]
            let yPositions = [0, maxY / 2, maxY]

            for originY in yPositions {
                for originX in xPositions {
                    let key = "\(Int(originX.rounded()))x\(Int(originY.rounded()))-\(Int(cropWidth.rounded()))x\(Int(cropHeight.rounded()))"
                    guard attempted.insert(key).inserted else { continue }
                    let rect = CGRect(x: originX, y: originY, width: cropWidth, height: cropHeight).integral
                    guard let crop = photo.cropping(to: rect),
                          let resized = resized(crop, width: target.width, height: target.height) else { continue }
                    let request = VNHomographicImageRegistrationRequest(targetedCGImage: target, options: [:])
                    do { try VNImageRequestHandler(cgImage: resized, orientation: .up).perform([request]) }
                    catch { continue }
                    guard let alignment = request.results?.first else { continue }
                    guard alignment.confidence >= 0.3 else { continue }

                    let matrix = alignment.warpTransform
                    func project(_ x: Float, _ y: Float) -> BoardPoint? {
                        let transformed = simd_mul(matrix, SIMD3<Float>(x, y, 1))
                        guard transformed.z.isFinite, abs(transformed.z) > 1e-6 else { return nil }
                        let u = Double(transformed.x / transformed.z)
                        let v = Double(transformed.y / transformed.z)
                        // Registration coordinates are normalized with a lower-left origin.
                        return BoardPoint(x: originX + u * cropWidth,
                                          y: originY + (1 - v) * cropHeight)
                    }
                    let corners = [project(0, 1), project(1, 1), project(1, 0), project(0, 0)].compactMap { $0 }
                    guard corners.count == 4,
                          BoardGeometry.validQuad(corners, imageSize: imageSize, physical: physical) else { continue }
                    let area = BoardGeometry.area(corners)
                    candidates.append((corners, area, alignment.confidence))
                    if area >= 0.9 * imageSize.x * imageSize.y {
                        return corners.map { BoardPoint(x: $0.x / imageSize.x, y: $0.y / imageSize.y) }
                    }
                }
            }
        }

        return candidates.sorted {
            if $0.confidence != $1.confidence { return $0.confidence > $1.confidence }
            return $0.area > $1.area
        }.first?.corners.map { BoardPoint(x: $0.x / imageSize.x, y: $0.y / imageSize.y) }
    }

    private static func resized(_ image: CGImage, width: Int, height: Int) -> CGImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
        return renderer.image { _ in
            UIImage(cgImage: image).draw(in: CGRect(x: 0, y: 0, width: width, height: height))
        }.cgImage
    }
}
