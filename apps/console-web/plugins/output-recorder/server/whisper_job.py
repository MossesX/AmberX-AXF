"""One transcription, run as its own process by transcripts.py: `python whisper_job.py <audio> --model base.en --threads 2`.

Its own process so the model's memory is handed back when it ends and a crash can't touch the console. Prints one JSON
line: {language, text, segments: [[start seconds, text], …]}. Local faster-whisper, no network but the model's first
download, no key and no tokens. The audio's two tracks (left = mic, right = playback) are mixed down by the decoder.
"""
from __future__ import annotations

import argparse
import json
import os


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("audio")
    a.add_argument("--model", default="base.en")
    a.add_argument("--threads", type=int, default=2)
    a.add_argument("--models-dir", default="")
    o = a.parse_args()
    os.nice(19)
    from faster_whisper import WhisperModel  # the heavy import stays out of the console itself

    model = WhisperModel(o.model, device="cpu", compute_type="int8", cpu_threads=o.threads, download_root=o.models_dir or None)
    segments, info = model.transcribe(o.audio, vad_filter=True, beam_size=1, condition_on_previous_text=False)
    rows = [[round(s.start, 1), s.text.strip()] for s in segments if s.text.strip()]
    print(json.dumps({"language": info.language, "text": " ".join(t for _, t in rows), "segments": rows}, ensure_ascii=False))


if __name__ == "__main__":
    main()
