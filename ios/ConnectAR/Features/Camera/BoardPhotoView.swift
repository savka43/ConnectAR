import SwiftUI
import UIKit

struct BoardPhotoView: View {
    @EnvironmentObject private var session: AssemblySession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let image: UIImage
    @Binding var corners: [BoardPoint] // Owned by CameraView, not a recyclable List row.
    @Binding var editing: Bool
    @Binding var zoom: Double
    @Binding var selectedStepID: String?

    private let cornerNames = [
        "у задней панели, со стороны процессора",
        "на противоположной стороне от задней панели, со стороны памяти",
        "на противоположной стороне от задней панели, со стороны нижних разъёмов",
        "у задней панели, со стороны нижних разъёмов"
    ]
    private var imageSize: BoardPoint { BoardPoint(x: image.size.width, y: image.size.height) }
    private var pixelCorners: [BoardPoint] {
        corners.map { BoardPoint(x: $0.x * imageSize.x, y: $0.y * imageSize.y) }
    }
    private var homography: BoardHomography? {
        guard BoardGeometry.validQuad(pixelCorners, imageSize: imageSize, physical: session.board.physical) else { return nil }
        return BoardHomography.solve(source: BoardGeometry.corners(session.board.physical), destination: pixelCorners)
    }
    private var markers: [BoardMarker] {
        BoardMarkers.make(board: session.board, plan: session.steps, done: session.completedSteps)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if editing {
                CornerGuide(active: min(corners.count, 3))
                if corners.count < 4 {
                    Text("Коснитесь угла платы \(corners.count + 1) из 4: \(cornerNames[corners.count])")
                        .font(.headline).accessibilityIdentifier("cornerPrompt")
                } else {
                    Text("Перетаскивайте углы, чтобы уточнить контур платы.").font(.subheadline)
                }
            }
            if corners.count == 4 && homography == nil {
                Label("Похоже, углы перепутаны — проверьте порядок", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange).accessibilityIdentifier("invalidCorners")
            }
            if let step = session.nextStep, step.connectorIds.isEmpty {
                NavigationLink { InstructionDetailView(step: step) } label: {
                    Label("Сейчас: \(step.title)", systemImage: step.symbol)
                }.buttonStyle(.bordered)
            }
            GeometryReader { container in
                let width = container.size.width * zoom
                let height = width * imageSize.y / imageSize.x
                ScrollView([.horizontal, .vertical]) {
                    photo(width: width, height: height)
                }
                .scrollDisabled(zoom == 1)
            }
            .aspectRatio(image.size.width / image.size.height, contentMode: .fit)
            HStack {
                Image(systemName: "minus.magnifyingglass")
                Slider(value: $zoom, in: 1...4).accessibilityLabel("Масштаб фото")
                Image(systemName: "plus.magnifyingglass")
            }
            if corners.count == 4 {
                Button(editing ? "Готово" : "Поправить углы") { editing.toggle() }
                    .disabled(editing && homography == nil)
            }
            if !corners.isEmpty {
                Button("Разметить заново", role: .destructive) { corners = []; editing = true }
            }
            Text("Углы идут по часовой стрелке, как на схеме. Коснитесь подписи разъёма, чтобы открыть инструкцию.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func photo(width: Double, height: Double) -> some View {
        let projected = projectedMarkers(width: width, height: height)
        let inputs = projected.filter { $0.marker.showLabel }.map { item in
            PhotoLabelInput(id: item.marker.id, anchor: item.center, size: item.labelSize,
                            state: item.marker.state, order: item.marker.order)
        }
        let labels = BoardMarkers.layout(inputs, viewport: BoardPoint(x: width, y: height))
        return ZStack(alignment: .topLeading) {
            Image(uiImage: image).resizable().frame(width: width, height: height)
            Canvas { context, _ in
                if corners.count > 1 {
                    var outline = Path()
                    outline.move(to: CGPoint(x: corners[0].x * width, y: corners[0].y * height))
                    for corner in corners.dropFirst() { outline.addLine(to: CGPoint(x: corner.x * width, y: corner.y * height)) }
                    if corners.count == 4 { outline.closeSubpath() }
                    context.stroke(outline, with: .color(.yellow), style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
                }
                for item in projected {
                    var path = Path()
                    path.addLines(item.polygon.map { CGPoint(x: $0.x, y: $0.y) })
                    path.closeSubpath()
                    let color = color(item.marker.state)
                    context.fill(path, with: .color(color.opacity(item.marker.state == .done ? 0.12 : 0.3)))
                    context.stroke(path, with: .color(color), lineWidth: item.marker.state == .current ? 3 : 1)
                    if let label = labels[item.marker.id], label.visible && label.leader {
                        var line = Path()
                        line.move(to: CGPoint(x: item.center.x, y: item.center.y))
                        line.addLine(to: CGPoint(x: label.center.x, y: label.center.y))
                        context.stroke(line, with: .color(color), lineWidth: 1.5)
                    }
                }
            }
            .allowsHitTesting(false)
            Color.clear.contentShape(Rectangle())
                .onTapGesture { location in
                    if editing && corners.count < 4 {
                        corners.append(BoardPoint(x: location.x / width, y: location.y / height))
                    } else if !editing {
                        let point = BoardPoint(x: location.x, y: location.y)
                        let hit = projected.filter { BoardGeometry.contains(point, polygon: $0.polygon) }.sorted {
                            if $0.marker.state != $1.marker.state { return $0.marker.state.rawValue < $1.marker.state.rawValue }
                            return BoardGeometry.area($0.polygon) < BoardGeometry.area($1.polygon)
                        }.first
                        selectedStepID = hit?.marker.stepID
                    }
                }
            ForEach(projected, id: \.marker.id) { item in
                if let label = labels[item.marker.id], label.visible {
                    Button { selectedStepID = item.marker.stepID } label: {
                        Text(item.marker.label).font(.caption).multilineTextAlignment(.center)
                            .foregroundStyle(.primary)
                            .frame(width: max(1, item.labelSize.x - 16), height: max(1, item.labelSize.y - 12))
                            .padding(.horizontal, 8).padding(.vertical, 6)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                            .overlay { RoundedRectangle(cornerRadius: 8).stroke(color(item.marker.state), lineWidth: 2) }
                    }
                    .buttonStyle(.plain)
                    .position(x: label.center.x, y: label.center.y)
                    .accessibilityLabel(item.marker.label)
                    .accessibilityValue(item.marker.state == .done ? "Выполнено" : (item.marker.state == .current ? "Текущий шаг" : "Не выполнено"))
                }
            }
            if editing {
                ForEach(corners.indices, id: \.self) { index in
                    Text("\(index + 1)").font(.headline).foregroundStyle(.black)
                        .frame(width: 36, height: 36).background(.yellow, in: Circle())
                        .frame(width: 44, height: 44).contentShape(Circle())
                        .position(x: corners[index].x * width, y: corners[index].y * height)
                        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("board-photo"))
                            .onChanged { value in
                                corners[index] = BoardPoint(x: value.location.x / width, y: value.location.y / height)
                            })
                        .accessibilityLabel("Угол \(index + 1): \(cornerNames[index])")
                }
            }
        }
        .frame(width: width, height: height)
        .coordinateSpace(name: "board-photo")
        .accessibilityIdentifier("boardPhoto")
    }

    private struct ProjectedMarker {
        let marker: BoardMarker
        let polygon: [BoardPoint]
        let center: BoardPoint
        let labelSize: BoardPoint
    }
    private func projectedMarkers(width: Double, height: Double) -> [ProjectedMarker] {
        guard let homography else { return [] }
        // Reading this environment value invalidates layout on Dynamic Type changes.
        let traits = UITraitCollection(preferredContentSizeCategory: contentSizeCategory)
        let font = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: traits)
        func project(_ p: BoardPoint) -> BoardPoint? {
            homography.apply(p).map { BoardPoint(x: $0.x / imageSize.x * width, y: $0.y / imageSize.y * height) }
        }
        return markers.compactMap { marker in
            let polygon = marker.rect.corners.compactMap(project)
            guard polygon.count == 4, let center = project(marker.rect.center) else { return nil }
            let maxWidth = max(40, min(240, width - 24))
            let bounds = (marker.label as NSString).boundingRect(with: CGSize(width: maxWidth, height: 1000),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
            return ProjectedMarker(marker: marker, polygon: polygon, center: center,
                labelSize: BoardPoint(x: ceil(bounds.width) + 16, y: ceil(bounds.height) + 12))
        }
    }
    private var contentSizeCategory: UIContentSizeCategory {
        switch dynamicTypeSize {
        case .xSmall: return .extraSmall
        case .small: return .small
        case .medium: return .medium
        case .large: return .large
        case .xLarge: return .extraLarge
        case .xxLarge: return .extraExtraLarge
        case .xxxLarge: return .extraExtraExtraLarge
        case .accessibility1: return .accessibilityMedium
        case .accessibility2: return .accessibilityLarge
        case .accessibility3: return .accessibilityExtraLarge
        case .accessibility4: return .accessibilityExtraExtraLarge
        case .accessibility5: return .accessibilityExtraExtraExtraLarge
        @unknown default: return .large
        }
    }
    private func color(_ state: MarkerState) -> Color {
        switch state { case .current: return .teal; case .pending: return .orange; case .done: return .gray }
    }
}

private struct CornerGuide: View {
    let active: Int
    var body: some View {
        HStack(spacing: 12) {
            Text("Задняя\nпанель").font(.caption2).multilineTextAlignment(.center)
            VStack(spacing: 20) {
                HStack { number(0); Spacer(); number(1) }
                Text("CPU → память").font(.caption2)
                HStack { number(3); Spacer(); number(2) }
            }
            .padding(8).frame(width: 180).background(Color.teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Углы платы: 1 сверху слева у задней панели, 2 сверху справа, 3 снизу справа, 4 снизу слева")
    }
    private func number(_ index: Int) -> some View {
        Text("\(index + 1)").bold().frame(width: 26, height: 26)
            .background(index == active ? Color.yellow : Color.gray.opacity(0.2), in: Circle())
            .foregroundStyle(index == active ? Color.black : Color.primary)
    }
}
