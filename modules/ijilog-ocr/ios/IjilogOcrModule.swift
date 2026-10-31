import ExpoModulesCore
import Vision

/// 端末の中で写真の文字を読む。画像は外部に送らない
public class IjilogOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("IjilogOcr")

    AsyncFunction("recognizeAsync") { (uri: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let request = VNRecognizeTextRequest { request, error in
          if let error = error {
            promise.reject(error)
            return
          }
          let observations = request.results as? [VNRecognizedTextObservation] ?? []
          // Vision の座標は左下が原点。上の行から、同じ高さなら左から並べる
          let lines = observations
            .sorted { a, b in
              let dy = a.boundingBox.midY - b.boundingBox.midY
              if abs(dy) > 0.01 { return dy > 0 }
              return a.boundingBox.minX < b.boundingBox.minX
            }
            .compactMap { $0.topCandidates(1).first?.string }
          promise.resolve(lines)
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ja-JP", "en-US"]
        request.usesLanguageCorrection = true

        do {
          try VNImageRequestHandler(url: uri, options: [:]).perform([request])
        } catch {
          promise.reject(error)
        }
      }
    }
  }
}
