package expo.modules.ijilogocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** 端末の中で写真の文字を読む。画像は外部に送らない */
class IjilogOcrModule : Module() {
  private var recognizer: TextRecognizer? = null

  private fun getRecognizer(): TextRecognizer =
    recognizer ?: TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build()).also { recognizer = it }

  override fun definition() = ModuleDefinition {
    Name("IjilogOcr")

    AsyncFunction("recognizeAsync") { uri: String, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        promise.reject("ERR_OCR_IMAGE", "画像を読み込めませんでした", e)
        return@AsyncFunction
      }
      getRecognizer().process(image)
        .addOnSuccessListener { result ->
          promise.resolve(result.textBlocks.flatMap { block -> block.lines.map { it.text } })
        }
        .addOnFailureListener { e -> promise.reject("ERR_OCR", e.message, e) }
    }

    OnDestroy {
      recognizer?.close()
      recognizer = null
    }
  }
}
