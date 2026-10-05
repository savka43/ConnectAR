// Contract for the future recognition module. The prototype returns an
// explicit unavailable state instead of pretending to recognize a board.
enum RecognitionStatus {
    case unavailable
}

protocol RecognitionService {
    var status: RecognitionStatus { get }
}

struct PrototypeRecognitionService: RecognitionService {
    let status: RecognitionStatus = .unavailable
}
