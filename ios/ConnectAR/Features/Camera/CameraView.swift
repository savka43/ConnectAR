import SwiftUI
import PhotosUI
import AVFoundation
import ImageIO

struct CameraView: View {
    @EnvironmentObject private var session: AssemblySession
    @State private var photoItem: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var showingCamera = false
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var needsSettings = false
    @State private var selectedStepID = "ram"
    @State private var markers: [String: CGPoint] = [:]

    private var selectedStep: AssemblyStep? {
        session.steps.first { $0.id == selectedStepID }
    }

    var body: some View {
        List {
            Section {
                Text(session.board.name).font(.headline)
                Text("Сфотографируйте плату, выберите компонент и коснитесь его разъёма на фото. Метки ставятся вручную.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Снять фото", systemImage: "camera") { Task { await openCamera() } }
                        .buttonStyle(.borderedProminent)
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("Из галереи", systemImage: "photo")
                    }.buttonStyle(.bordered)
                }.disabled(loading)
                if loading { ProgressView("Загрузка фотографии…") }
            }
            if let image {
                Section("Фото платы") {
                    Image(uiImage: image)
                        .resizable().aspectRatio(contentMode: .fit)
                        .overlay {
                            GeometryReader { geometry in
                                Color.clear.contentShape(Rectangle())
                                    .onTapGesture { location in
                                        guard geometry.size.width > 0, geometry.size.height > 0 else { return }
                                        markers[selectedStepID] = CGPoint(
                                            x: min(1, max(0, location.x / geometry.size.width)),
                                            y: min(1, max(0, location.y / geometry.size.height)))
                                    }
                                if let point = markers[selectedStepID] {
                                    Image(systemName: "plus.circle.fill")
                                        .font(.system(size: 32)).foregroundStyle(.white, .teal)
                                        .shadow(radius: 3)
                                        .position(x: point.x * geometry.size.width, y: point.y * geometry.size.height)
                                        .allowsHitTesting(false)
                                }
                            }
                        }
                        .accessibilityLabel("Фото платы. Ручная отметка разъёма")
                    Picker("Компонент", selection: $selectedStepID) {
                        ForEach(session.steps) { step in
                            Text(step.title).tag(step.id)
                        }
                    }
                    if let step = selectedStep {
                        Text("Разъём: \(session.connectorSummary(for: step))").font(.headline)
                        Text(step.instruction)
                        NavigationLink("Открыть инструкцию") { InstructionDetailView(step: step) }
                    }
                    if markers[selectedStepID] != nil {
                        Button("Убрать метку") { markers.removeValue(forKey: selectedStepID) }
                    }
                    Button("Убрать фото", role: .destructive) {
                        self.image = nil
                        markers.removeAll()
                        photoItem = nil
                    }
                }
            } else {
                Section {
                    ContentUnavailableView("Добавьте фото платы", systemImage: "viewfinder",
                        description: Text("Можно снять новое фото или выбрать готовое из галереи."))
                }
            }
            Section("Ручной выбор") {
                ForEach(session.steps) { step in
                    NavigationLink(step.title) { InstructionDetailView(step: step) }
                }
            }
            Section {
                Text("Автоматическое распознавание и AR ещё не подключены. Фото и метки доступны в текущем сеансе и никуда не отправляются.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Камера")
        .fullScreenCover(isPresented: $showingCamera) {
            CameraCapture { replaceImage($0) }.ignoresSafeArea()
        }
        .task(id: photoItem) {
            guard let photoItem else { return }
            loading = true
            defer { loading = false }
            do {
                guard let data = try await photoItem.loadTransferable(type: Data.self),
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 2048
                      ] as CFDictionary) else {
                    if !Task.isCancelled { errorMessage = "Не удалось прочитать фото. Выберите другое изображение." }
                    return
                }
                guard !Task.isCancelled else { return }
                replaceImage(UIImage(cgImage: thumbnail))
            } catch {
                if !Task.isCancelled { errorMessage = "Не удалось загрузить фото. Попробуйте ещё раз." }
            }
        }
        .alert("Камера и фото", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil; needsSettings = false } }
        )) {
            if needsSettings {
                Button("Настройки") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
            Button("Понятно", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func replaceImage(_ newImage: UIImage) {
        image = newImage
        markers.removeAll()
    }

    private func openCamera() async {
        needsSettings = false
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            errorMessage = "Камера недоступна на этом устройстве. Выберите фото из галереи."
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: showingCamera = true
        case .notDetermined:
            if await AVCaptureDevice.requestAccess(for: .video) { showingCamera = true }
            else { needsSettings = true; errorMessage = "Разрешите доступ к камере в настройках или выберите фото из галереи." }
        case .denied:
            needsSettings = true
            errorMessage = "Доступ к камере выключен. Разрешите его в настройках или выберите фото из галереи."
        case .restricted:
            errorMessage = "Доступ к камере ограничен на устройстве. Можно выбрать фото из галереи."
        @unknown default:
            errorMessage = "Камера недоступна. Попробуйте выбрать фото из галереи."
        }
    }
}
