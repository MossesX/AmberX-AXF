package ai.amberx.axf.phoneconnect.watch

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import ai.amberx.axf.phoneconnect.link.PhoneStore
import org.json.JSONObject
import java.util.Locale

/**
 * voice@1: `voice.say` speaks one line (text to speech); `voice.listen` hears one phrase, only when "Let the console
 * listen once" is on in the app (Brett's own opt-in, off by default). Nothing hands-free, no wake word.
 */
object Voice {
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null

    fun register() {
        Commands.register("voice.say") { ctx, _, a ->
            val text = a.optString("text").take(600)
            if (text.isBlank()) return@register Outcome.Failed("validation", "Nothing to say.")
            main.post { speak(ctx.applicationContext, text) }
            Outcome.Done(JSONObject().put("said", true))
        }
        Commands.register("voice.listen") { ctx, id, a ->
            if (!PhoneStore(ctx).listen) return@register Outcome.Failed("consent_required", "Listening is off on the phone: switch on \"Let the console listen once\" in Phone Connect.")
            if (!SpeechRecognizer.isRecognitionAvailable(ctx)) return@register Outcome.Failed("not_found", "This phone has no speech recognizer.")
            val seconds = a.optInt("timeoutSeconds", 10).coerceIn(1, 30)
            main.post { listen(ctx.applicationContext, id, seconds) }
            Outcome.Pending("running")
        }
    }

    private fun speak(ctx: Context, text: String) {
        val t = tts
        if (t != null) { t.speak(text, TextToSpeech.QUEUE_ADD, null, "phone-connect"); return }
        var made: TextToSpeech? = null
        made = TextToSpeech(ctx) { status ->
            if (status == TextToSpeech.SUCCESS) { made?.language = Locale.getDefault(); made?.speak(text, TextToSpeech.QUEUE_ADD, null, "phone-connect") }
        }
        tts = made
    }

    private fun listen(ctx: Context, id: String, seconds: Int) {
        val sr = SpeechRecognizer.createSpeechRecognizer(ctx)
        var done = false
        fun finish(o: Outcome) { if (!done) { done = true; Commands.later.add(id to o); sr.destroy() } }
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                finish(Outcome.Done(JSONObject().put("text", text)))
            }
            override fun onError(error: Int) { finish(if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) Outcome.Done(JSONObject().put("text", "")) else Outcome.Failed("unavailable", "The recognizer stopped (error $error).")) }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        sr.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))
        main.postDelayed({ if (!done) { sr.stopListening(); main.postDelayed({ finish(Outcome.Done(JSONObject().put("text", ""))) }, 1500) } }, seconds * 1000L)
    }
}
