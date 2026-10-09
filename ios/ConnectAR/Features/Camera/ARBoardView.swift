import SwiftUI
import Combine
import ARKit
import RealityKit
import AVFoundation

private enum ARBoardStatus: Equatable {
    case searching, tracking, lost, unavailable
}

private struct ARMarkerProjection: Identifiable {
    let marker: BoardMarker
    let label: String
    let anchor: BoardPoint
    let center: BoardPoint
    let labelSize: BoardPoint
    var id: String { marker.id }
}

@MainActor
private final class ARBoardModel: NSObject, ObservableObject, ARSessionDelegate {
    @Published var status: ARBoardStatus = .searching
    @Published var projections: [ARMarkerProjection] = []
    @Published var secondsSearching = 0
    @Published var error: String?
    @Published var notice: String?
    @Published var torchEnabled = false

    let board: Motherboard
    private let assembly: AssemblySession
    private weak var view: ARView?
    private var referenceImage: ARReferenceImage?
    private var anchor: ARImageAnchor?
    private var contentRoot: Entity?
    private var overlayRoot: AnchorEntity?
    private var active = false
    private var configured = false
    private var lastProjection = 0.0
    private var lastSearchTick = 0.0
    private var visibleLabels: [String: PhotoLabel] = [:]
    private var layoutCandidates: [String: (label: PhotoLabel, frames: Int)] = [:]
    private var wasTracking = false
    private var smoothedImageTransform: simd_float4x4?
    private var lastPoseTimestamp: TimeInterval = 0
    private var torchWasEnabled = false
    private var torch: AVCaptureDevice? { AVCaptureDevice.default(for: .video) }

    var currentUnmarkedStep: AssemblyStep? {
        guard let step = assembly.nextStep else { return nil }
        let hasVisibleConnector = step.connectorIds.contains { id in
            board.connectors.contains { $0.id == id && $0.rectMm != nil }
        }
        return hasVisibleConnector ? nil : step
    }

    init(board: Motherboard, assembly: AssemblySession) {
        self.board = board
        self.assembly = assembly
    }

    func attach(_ view: ARView) {
        self.view = view
        view.session.delegate = self
        view.session.delegateQueue = .main
        if active { start() }
    }

    func setActive(_ value: Bool) {
        guard active != value else { return }
        active = value
        if value { start() }
        else { pause() }
    }

    func pause() {
        torchWasEnabled = torchEnabled || torchWasEnabled
        setTorch(false)
        view?.session.pause()
        overlayRoot?.isEnabled = false
        status = .searching
        projections = []
        secondsSearching = 0
        wasTracking = false
        visibleLabels.removeAll()
        layoutCandidates.removeAll()
        smoothedImageTransform = nil
        lastPoseTimestamp = 0
    }

    private func start() {
        guard active, let view else { return }
        error = nil
        guard ARWorldTrackingConfiguration.isSupported else {
            fail("На этом устройстве AR недоступна. Можно продолжить с фотографией платы.")
            return
        }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor [weak self] in
                    guard let self, self.active else { return }
                    if granted { self.start() }
                    else { self.fail("Разрешите доступ к камере в настройках или продолжите с фотографией платы.", needsSettings: true) }
                }
            }
            return
        }
        if configured, let referenceImage {
            run(view, reference: referenceImage, reset: false)
            return
        }
        guard let target = board.target?.image,
              let root = Bundle.main.resourceURL?.appendingPathComponent("shared_boards/boards/\(board.id)"),
              let image = UIImage(contentsOfFile: root.appendingPathComponent(target).path),
              let cgImage = image.cgImage else {
            fail("Не найдена эталонная фотография платы. Можно продолжить с обычным фото.")
            return
        }
        let reference = ARReferenceImage(cgImage, orientation: .up,
                                         physicalWidth: CGFloat(board.physical.widthMm / 1000))
        Task {
            do {
                try await reference.validate()
                guard active, let attachedView = self.view else { return }
                referenceImage = reference
                configured = true
                run(attachedView, reference: reference, reset: true)
            } catch {
                fail("Не удалось подготовить распознавание платы: \(error.localizedDescription)")
            }
        }
    }

    private func run(_ view: ARView, reference: ARReferenceImage, reset: Bool) {
        let configuration = ARWorldTrackingConfiguration()
        configuration.detectionImages = [reference]
        configuration.maximumNumberOfTrackedImages = 1
        view.session.run(configuration, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
        status = .searching
        overlayRoot?.isEnabled = false
        error = nil
        needsSettings = false
        if torchWasEnabled { setTorch(true); torchWasEnabled = false }
    }

    private func fail(_ message: String, needsSettings: Bool = false) {
        status = .unavailable
        error = message
        self.needsSettings = needsSettings
        pause()
        status = .unavailable
    }

    @Published var needsSettings = false

    func toggleTorch() {
        guard torch?.hasTorch == true else { return }
        setTorch(!torchEnabled)
    }

    private func setTorch(_ enabled: Bool) {
        guard let torch, torch.hasTorch else { torchEnabled = false; return }
        do {
            try torch.lockForConfiguration()
            torch.torchMode = enabled ? .on : .off
            torch.unlockForConfiguration()
            torchEnabled = enabled
        } catch { torchEnabled = false }
    }

    func updateMarkers() {
        guard let contentRoot else { return }
        contentRoot.children.removeAll()
        let markers = BoardMarkers.make(board: board, plan: assembly.steps, done: assembly.completedSteps)
        for marker in markers {
            let rect = marker.rect
            let edgeColor: UIColor
            let fillColor: UIColor
            switch marker.state {
            case .current:
                edgeColor = .systemYellow
                fillColor = UIColor.systemYellow.withAlphaComponent(0.14)
            case .pending:
                edgeColor = .systemTeal
                fillColor = UIColor.systemTeal.withAlphaComponent(0.06)
            case .done:
                edgeColor = UIColor.systemGray.withAlphaComponent(0.5)
                fillColor = UIColor.systemGray.withAlphaComponent(0.025)
            }
            addPlane(x: rect.x, y: rect.y, width: rect.w, height: rect.h,
                     elevation: 0.001, color: fillColor, to: contentRoot)
            addPlane(x: rect.x, y: rect.y, width: rect.w, height: 1.6,
                     elevation: 0.002, color: edgeColor, to: contentRoot)
            addPlane(x: rect.x, y: rect.y + rect.h - 1.6, width: rect.w, height: 1.6,
                     elevation: 0.002, color: edgeColor, to: contentRoot)
            addPlane(x: rect.x, y: rect.y, width: 1.6, height: rect.h,
                     elevation: 0.002, color: edgeColor, to: contentRoot)
            addPlane(x: rect.x + rect.w - 1.6, y: rect.y, width: 1.6, height: rect.h,
                     elevation: 0.002, color: edgeColor, to: contentRoot)
        }
    }

    private func addPlane(x: Double, y: Double, width: Double, height: Double,
                          elevation: Float, color: UIColor, to parent: Entity) {
        let mesh = MeshResource.generatePlane(width: Float(width / 1000), depth: Float(height / 1000))
        let entity = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
        let position = BoardGeometry.anchor(BoardPoint(x: x + width / 2, y: y + height / 2), physical: board.physical)
        entity.position = SIMD3(Float(position[0]), elevation, Float(position[2]))
        parent.addChild(entity)
    }

    private func updateProjection(frame: ARFrame, imageAnchor: ARImageAnchor?) {
        let now = CACurrentMediaTime()
        guard let view, let imageAnchor, imageAnchor.isTracked,
              frame.camera.trackingState == .normal else {
            if anchor != nil { status = .lost }
            overlayRoot?.isEnabled = false
            projections = []
            wasTracking = false
            layoutCandidates.removeAll()
            smoothedImageTransform = nil
            lastPoseTimestamp = 0
            return
        }
        status = .tracking
        overlayRoot?.isEnabled = true
        let correction = Transform(rotation: simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))).matrix
        let stableImageTransform = smooth(imageAnchor.transform, timestamp: frame.timestamp)
        let boardToWorld = simd_mul(stableImageTransform, correction)
        overlayRoot?.transform = Transform(matrix: boardToWorld)
        guard now - lastProjection > 0.033 else { return }
        lastProjection = now
        let markers = BoardMarkers.make(board: board, plan: assembly.steps, done: assembly.completedSteps)
        let inputs: [PhotoLabelInput] = markers.filter(\.showLabel).compactMap { marker in
            let point = BoardGeometry.anchor(marker.rect.center, physical: board.physical)
            let local = SIMD4<Float>(Float(point[0]), 0, Float(point[2]), 1)
            let world = simd_mul(boardToWorld, local)
            guard let projected = view.project(SIMD3(world.x, world.y, world.z)) else { return nil }
            let font = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: view.traitCollection)
            let label = displayLabel(for: marker)
            let bounds = (label as NSString).boundingRect(with: CGSize(width: 260, height: 1000),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
            return PhotoLabelInput(id: marker.id,
                anchor: BoardPoint(x: projected.x, y: projected.y),
                size: BoardPoint(x: min(240, ceil(bounds.width) + 16), y: ceil(bounds.height) + 12),
                state: marker.state, order: marker.order)
        }
        let proposed = BoardMarkers.layout(inputs, viewport: BoardPoint(x: view.bounds.width, y: view.bounds.height))
        let currentID = markers.first(where: { $0.state == .current })?.id
        let layout = stabilize(proposed, currentID: currentID, immediately: !wasTracking)
        wasTracking = true
        projections = markers.compactMap { marker in
            guard marker.showLabel, let placement = layout[marker.id], placement.visible else { return nil }
            return ARMarkerProjection(marker: marker,
                label: displayLabel(for: marker),
                anchor: inputs.first(where: { $0.id == marker.id })?.anchor ?? placement.center,
                center: placement.center,
                labelSize: inputs.first(where: { $0.id == marker.id })?.size ?? BoardPoint(x: 80, y: 36))
        }
    }

    private func displayLabel(for marker: BoardMarker) -> String {
        marker.connectorIDs.contains("cpu-power") ? "ATX_12V · CPU 8-pin" : marker.label
    }

    private func smooth(_ transform: simd_float4x4, timestamp: TimeInterval) -> simd_float4x4 {
        guard let previous = smoothedImageTransform else {
            smoothedImageTransform = transform
            lastPoseTimestamp = timestamp
            return transform
        }
        let elapsed = max(1.0 / 60.0, min(0.25, timestamp - lastPoseTimestamp))
        let amount = Float(1 - exp(-elapsed / 0.1))
        let oldPosition = SIMD3(previous.columns.3.x, previous.columns.3.y, previous.columns.3.z)
        let newPosition = SIMD3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        let rotation = simd_slerp(Transform(matrix: previous).rotation,
                                  Transform(matrix: transform).rotation, amount)
        var result = Transform(rotation: rotation).matrix
        let position = oldPosition + (newPosition - oldPosition) * amount
        result.columns.3 = SIMD4(position.x, position.y, position.z, 1)
        smoothedImageTransform = result
        lastPoseTimestamp = timestamp
        return result
    }

    private func stabilize(_ proposed: [String: PhotoLabel], currentID: String?, immediately: Bool) -> [String: PhotoLabel] {
        guard !immediately else {
            visibleLabels = proposed
            layoutCandidates.removeAll()
            return proposed
        }
        let ids = Set(visibleLabels.keys).union(proposed.keys)
        for id in ids {
            let next = proposed[id] ?? PhotoLabel(center: visibleLabels[id]?.center ?? BoardPoint(x: 0, y: 0), visible: false, leader: false)
            guard id != currentID else {
                visibleLabels[id] = next
                layoutCandidates.removeValue(forKey: id)
                continue
            }
            if let old = visibleLabels[id], old.visible == next.visible,
               (!next.visible || (BoardPoint.distance(old.center, next.center) < 4 && old.leader == next.leader)) {
                layoutCandidates.removeValue(forKey: id)
                continue
            }
            if let candidate = layoutCandidates[id], candidate.label.visible == next.visible,
               !next.visible || (BoardPoint.distance(candidate.label.center, next.center) < 4 && candidate.label.leader == next.leader) {
                let frames = candidate.frames + 1
                if frames >= 3 {
                    visibleLabels[id] = next
                    layoutCandidates.removeValue(forKey: id)
                } else { layoutCandidates[id] = (next, frames) }
            } else {
                layoutCandidates[id] = (next, 1)
            }
        }
        return visibleLabels
    }

    func freeze() {
        guard status == .tracking, let view, let anchor, anchor.isTracked else { return }
        let corners = BoardGeometry.corners(board.physical).compactMap { point -> CGPoint? in
            let local = BoardGeometry.anchor(point, physical: board.physical)
            let correction = Transform(rotation: simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))).matrix
            let imageTransform = smoothedImageTransform ?? anchor.transform
            let world = simd_mul(simd_mul(imageTransform, correction), SIMD4(Float(local[0]), 0, Float(local[2]), 1))
            return view.project(SIMD3(world.x, world.y, world.z))
        }
        guard corners.count == 4 else {
            notice = "Не удалось определить края платы в кадре. Наведите камеру на плату целиком и попробуйте снова."
            return
        }
        overlayRoot?.isEnabled = false
        torchWasEnabled = torchEnabled || torchWasEnabled
        setTorch(false)
        view.snapshot(saveToHDR: false) { [weak self] image in
            Task { @MainActor in
                guard let self else { return }
                self.overlayRoot?.isEnabled = self.status == .tracking && self.anchor?.isTracked == true
                guard let image else { self.notice = "Не удалось сохранить кадр. Попробуйте ещё раз."; return }
                let size = BoardPoint(x: image.size.width, y: image.size.height)
                let normalized = corners.map { BoardPoint(x: $0.x / size.x, y: $0.y / size.y) }
                self.onFreeze?(image, normalized)
            }
        }
    }

    var onFreeze: ((UIImage, [BoardPoint]) -> Void)?

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        guard let image = anchors.compactMap({ $0 as? ARImageAnchor }).first else { return }
        anchor = image
        guard let view else { return }
        if let old = overlayRoot { view.scene.removeAnchor(old) }
        let root = AnchorEntity(world: .zero)
        let boardRoot = Entity()
        let correction = Transform(rotation: simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))).matrix
        root.transform = Transform(matrix: simd_mul(image.transform, correction))
        root.addChild(boardRoot)
        view.scene.addAnchor(root)
        overlayRoot = root
        contentRoot = boardRoot
        updateMarkers()
        status = .tracking
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let image = anchors.compactMap({ $0 as? ARImageAnchor }).first else { return }
        anchor = image
    }

    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        guard anchors.contains(where: { $0 is ARImageAnchor }) else { return }
        anchor = nil
        if let overlayRoot, let view { view.scene.removeAnchor(overlayRoot) }
        overlayRoot = nil; contentRoot = nil; projections = []; status = .searching
        wasTracking = false; visibleLabels.removeAll(); layoutCandidates.removeAll()
        smoothedImageTransform = nil; lastPoseTimestamp = 0
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        if anchor == nil, frame.timestamp - lastSearchTick >= 1 {
            lastSearchTick = frame.timestamp
            secondsSearching += 1
        }
        let currentAnchor = frame.anchors.compactMap { $0 as? ARImageAnchor }.first ?? anchor
        if let currentAnchor { anchor = currentAnchor }
        updateProjection(frame: frame, imageAnchor: currentAnchor)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        status = .lost
        overlayRoot?.isEnabled = false
        projections = []
        smoothedImageTransform = nil
        lastPoseTimestamp = 0
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        guard active, let view, let referenceImage else { return }
        run(view, reference: referenceImage, reset: false)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        guard active else { return }
        fail("AR-сессия завершилась с ошибкой: \(error.localizedDescription). Можно продолжить с фотографией платы.")
    }
}

struct ARBoardView: View {
    @EnvironmentObject private var assembly: AssemblySession
    @StateObject private var model: ARBoardModel
    @Binding var selectedStepID: String?
    let active: Bool
    let onFreeze: (UIImage, [BoardPoint]) -> Void
    let onUsePhoto: (String?, Bool) -> Void

    init(board: Motherboard, assembly: AssemblySession, selectedStepID: Binding<String?>, active: Bool,
         onFreeze: @escaping (UIImage, [BoardPoint]) -> Void, onUsePhoto: @escaping (String?, Bool) -> Void) {
        _model = StateObject(wrappedValue: ARBoardModel(board: board, assembly: assembly))
        _selectedStepID = selectedStepID
        self.active = active
        self.onFreeze = onFreeze
        self.onUsePhoto = onUsePhoto
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                ARViewHost(model: model)
                markerLabels
                VStack(spacing: 10) {
                    statusCard
                    Spacer()
                    HStack {
                        if AVCaptureDevice.default(for: .video)?.hasTorch == true {
                            Button { model.toggleTorch() } label: {
                                Label("Фонарик", systemImage: model.torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill")
                            }.buttonStyle(.bordered)
                        }
                        Button("Фото") { onUsePhoto(nil, false) }.buttonStyle(.bordered)
                        Button { model.freeze() } label: { Label("Заморозить", systemImage: "camera.viewfinder") }
                            .buttonStyle(.borderedProminent).disabled(model.status != .tracking)
                    }
                    .padding(.bottom, 8)
                }
                .padding(.horizontal, 12).padding(.top, 12)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .background(.black)
        }
        .onAppear { model.onFreeze = onFreeze; model.setActive(active) }
        .onChange(of: active) { _, value in model.setActive(value) }
        .onChange(of: assembly.completedSteps) { _, _ in model.updateMarkers() }
        .onChange(of: assembly.answers) { _, _ in model.updateMarkers() }
        .onChange(of: model.error) { _, message in if message != nil { onUsePhoto(message, model.needsSettings) } }
        .onDisappear { model.setActive(false) }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(statusTitle).font(.headline)
            Text(statusMessage).font(.subheadline)
            if model.status == .searching && model.secondsSearching >= 10 {
                Text("Поддерживается \(model.board.name). Используйте рассеянный свет и держите плату целиком в кадре на расстоянии 30–60 см.")
                    .font(.caption)
            }
            if model.status == .tracking, let step = model.currentUnmarkedStep {
                Button { selectedStepID = step.id } label: {
                    Label("Сейчас: \(step.title)", systemImage: step.symbol)
                }.font(.subheadline.bold())
            }
            if model.status == .searching && model.secondsSearching >= 25 {
                Button("Продолжить с фото") { onUsePhoto(nil, false) }.font(.subheadline.bold())
            }
            if let notice = model.notice {
                Text(notice).font(.caption).foregroundStyle(.orange)
                Button("Понятно") { model.notice = nil }.font(.caption.bold())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private var statusTitle: String {
        switch model.status { case .searching: "Ищем плату"; case .tracking: "Плата найдена"; case .lost: "Плата потеряна"; case .unavailable: "AR недоступна" }
    }
    private var statusMessage: String {
        switch model.status {
        case .searching: "Наведите камеру так, чтобы плата целиком попала в кадр."
        case .tracking: "Нажмите на метку разъёма, чтобы открыть инструкцию."
        case .lost: "Наведите камеру на плату снова. Подсветка временно скрыта."
        case .unavailable: model.error ?? "Продолжите с фотографией платы."
        }
    }

    private var markerLabels: some View {
        GeometryReader { proxy in
            let inputs = model.projections.map {
                PhotoLabelInput(id: $0.marker.id, anchor: $0.center, size: $0.labelSize,
                                state: $0.marker.state, order: $0.marker.order)
            }
            let layout = BoardMarkers.layout(inputs, viewport: BoardPoint(x: proxy.size.width, y: proxy.size.height))
            ZStack {
                Canvas { context, _ in
                    for projection in model.projections {
                        guard let label = layout[projection.marker.id], label.visible, label.leader else { continue }
                        var line = Path()
                        line.move(to: CGPoint(x: projection.anchor.x, y: projection.anchor.y))
                        line.addLine(to: CGPoint(x: label.center.x, y: label.center.y))
                        context.stroke(line, with: .color(color(projection.marker.state)), lineWidth: 1.5)
                    }
                }
                .allowsHitTesting(false)
                ForEach(model.projections) { projection in
                    if let label = layout[projection.marker.id], label.visible {
                        Button { selectedStepID = projection.marker.stepID } label: {
                Text(projection.label).font(.caption).multilineTextAlignment(.center)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                                .overlay { RoundedRectangle(cornerRadius: 8).stroke(color(projection.marker.state), lineWidth: 2) }
                        }
                        .buttonStyle(.plain)
                        .position(x: label.center.x, y: label.center.y)
                        .accessibilityLabel(projection.label)
                        .accessibilityValue(projection.marker.state == .done ? "Выполнено" :
                            (projection.marker.state == .current ? "Текущий шаг" : "Не выполнено"))
                    }
                }
            }
        }
        .allowsHitTesting(model.status == .tracking)
    }

    private func color(_ state: MarkerState) -> Color {
        switch state { case .current: .yellow; case .pending: .teal; case .done: .gray }
    }
}

private struct ARViewHost: UIViewRepresentable {
    let model: ARBoardModel
    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero)
        view.automaticallyConfigureSession = false
        model.attach(view)
        return view
    }
    func updateUIView(_ uiView: ARView, context: Context) { model.attach(uiView) }
}
