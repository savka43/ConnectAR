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
            let mesh = MeshResource.generatePlane(width: Float(rect.w / 1000), depth: Float(rect.h / 1000))
            let color: UIColor
            switch marker.state {
            case .current: color = UIColor.systemTeal.withAlphaComponent(0.72)
            case .pending: color = UIColor.systemOrange.withAlphaComponent(0.42)
            case .done: color = UIColor.systemGray.withAlphaComponent(0.22)
            }
            let entity = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
            let position = BoardGeometry.anchor(rect.center, physical: board.physical)
            entity.position = SIMD3(Float(position[0]), 0.001, Float(position[2]))
            contentRoot.addChild(entity)
        }
    }

    private func updateProjection(frame: ARFrame, imageAnchor: ARImageAnchor?) {
        let now = CACurrentMediaTime()
        guard now - lastProjection > 0.06 else { return }
        lastProjection = now
        guard let view, let imageAnchor, imageAnchor.isTracked,
              frame.camera.trackingState == .normal else {
            if anchor != nil { status = .lost }
            overlayRoot?.isEnabled = false
            projections = []
            wasTracking = false
            layoutCandidates.removeAll()
            return
        }
        status = .tracking
        overlayRoot?.isEnabled = true
        let correction = Transform(rotation: simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))).matrix
        let boardToWorld = simd_mul(imageAnchor.transform, correction)
        let markers = BoardMarkers.make(board: board, plan: assembly.steps, done: assembly.completedSteps)
        let inputs: [PhotoLabelInput] = markers.filter(\.showLabel).compactMap { marker in
            let point = BoardGeometry.anchor(marker.rect.center, physical: board.physical)
            let local = SIMD4<Float>(Float(point[0]), 0, Float(point[2]), 1)
            let world = simd_mul(boardToWorld, local)
            guard let projected = view.project(SIMD3(world.x, world.y, world.z)) else { return nil }
            let font = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: view.traitCollection)
            let bounds = (marker.label as NSString).boundingRect(with: CGSize(width: 220, height: 1000),
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
            guard marker.showLabel, let label = layout[marker.id], label.visible else { return nil }
            return ARMarkerProjection(marker: marker,
                anchor: inputs.first(where: { $0.id == marker.id })?.anchor ?? label.center,
                center: label.center,
                labelSize: inputs.first(where: { $0.id == marker.id })?.size ?? BoardPoint(x: 80, y: 36))
        }
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
            let world = simd_mul(simd_mul(anchor.transform, correction), SIMD4(Float(local[0]), 0, Float(local[2]), 1))
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
        let root = AnchorEntity(anchor: image)
        let boardRoot = Entity()
        let correction = Transform(rotation: simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))).matrix
        boardRoot.transform = Transform(matrix: correction)
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
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        if anchor == nil, frame.timestamp - lastSearchTick >= 1 {
            lastSearchTick = frame.timestamp
            secondsSearching += 1
        }
        updateProjection(frame: frame, imageAnchor: anchor)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        status = .lost
        overlayRoot?.isEnabled = false
        projections = []
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
                            Text(projection.marker.label).font(.caption).multilineTextAlignment(.center)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                                .overlay { RoundedRectangle(cornerRadius: 8).stroke(color(projection.marker.state), lineWidth: 2) }
                        }
                        .buttonStyle(.plain)
                        .position(x: label.center.x, y: label.center.y)
                        .accessibilityLabel(projection.marker.label)
                        .accessibilityValue(projection.marker.state == .done ? "Выполнено" :
                            (projection.marker.state == .current ? "Текущий шаг" : "Не выполнено"))
                    }
                }
            }
        }
        .allowsHitTesting(model.status == .tracking)
    }

    private func color(_ state: MarkerState) -> Color {
        switch state { case .current: .teal; case .pending: .orange; case .done: .gray }
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
