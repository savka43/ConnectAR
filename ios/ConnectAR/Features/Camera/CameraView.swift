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
    @State private var photoID = UUID()
    @State private var photoCorners: [BoardPoint] = []
    @State private var editingCorners = true
    @State private var photoZoom = 1.0
    @State private var selectedStepID: String?

    var body: some View {
        List {
            Section {
                Text(session.board.name).font(.headline)
                Text("Сфотографируйте плату и отметьте четыре её угла. Разъёмы вашего плана появятся на фото.")
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
                    BoardPhotoView(image: image, corners: $photoCorners, editing: $editingCorners,
                                   zoom: $photoZoom, selectedStepID: $selectedStepID).id(photoID)
                    Button("Убрать фото", role: .destructive) {
                        self.image = nil
                        photoID = UUID()
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
        .navigationDestination(item: $selectedStepID) { id in
            if let step = session.steps.first(where: { $0.id == id }) { InstructionDetailView(step: step) }
        }
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
        // Consume the picker request: .task restarts when returning from a pushed
        // instruction, and must not reload the same image and clear its corners.
        photoItem = nil
        photoID = UUID()
        photoCorners = []
        editingCorners = true
        photoZoom = 1
        selectedStepID = nil
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
