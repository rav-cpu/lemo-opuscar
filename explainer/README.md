# Tech explainer pipeline (Oscilloscope Math, vertical 1080×1920)

Topic in, checked film out. Built on the library's `core/` tools and the
[Oscilloscope Math](../styles/oscilloscope-math/STYLE.md) style: green phosphor beam on black, a graticule,
serif maths, amber measurement cursors, a HUD, and a CRT power-off at the end.

```sh
sh explainer/setup.sh                                  # once per machine / container (~3 min)
sh explainer/new.sh gpu-ai "Why do GPUs make AI fast?" # film folder + skeleton
#   write films/gpu-ai/scenes.json (explainer/SCENES.md)
sh explainer/make.sh films/gpu-ai                      # everything below, ~6 min for a 45 s film on 4 cores
```

`make.sh` stops at the first failing step, and copies the film to `films/<slug>/dist/` **only if QA passes**:

| Step | Tool | Fails when |
|---|---|---|
| 1 lint | `explainer/lint.py` | bad schema, a line over 24 words, a non-maths expression, too many rows/curves |
| 2 voice | `explainer/voice/tts.py` | an acronym or CamelCase word missing from the lexicon, split letters ("A I"), a term's phonemes lost; the hosted voice refuses |
| 3 timeline | `explainer/engine/export.mjs` | a page error (bad scenes.json) |
| 4 frames | `core/render/video.mjs` | render error |
| 5 mix | `explainer/engine/mix.py` | – |
| 6 master | ffmpeg two-pass loudnorm −14 LUFS, true peak ≤ −1 dBTP, H.264 + AAC | – |
| 7 subtitles + poster | `core/render/srt.py` | – |
| 8 **QA gate** | `explainer/qa/verify.mjs` | any ERROR below |

QA gate checks (report in `films/<slug>/qa/report.md`, contact sheet `qa/contact.jpg`):
text-on-text overlap, labels crossed by traces/curves, anything running into the HUD or under the subtitles,
safe area (warn), empty scenes, camera jerks (un-eased moves), brightness pops between frames, black frames,
voice lines overlapping, narration running into the ending, subtitle timing (≥ 1.8 s, line + 0.6 s, no overlap),
loudness −14 ±1 LUFS, true peak, video length, the page's 1080×1920 size, reading time of every on-screen text (core `readcheck`),
and the voice record: which provider spoke, and exactly what each line was told to say. The local fallback voice is a WARN.

Not automatic: whether the facts are right and whether it *sounds* good. Listen once before publishing.

## Files

| Path | What |
|---|---|
| `SCENES.md` | how to write the script and the scenes.json schema (the "topic → script" half) |
| `engine/film.js` | the scene engine: timing from voice durations, camera, 7 visual primitives, HUD, subtitles, bloom, CRT power-off, QA registry |
| `engine/index.html` | the page every film uses (copied into the film folder) |
| `engine/export.mjs` | timeline + sound events + subtitle cues → `out/timeline.json` |
| `engine/mix.py` | score (chord per scene), foley from events, voice warmth, ducking |
| `voice/tts.py` | pronunciation gate + pluggable voice (ElevenLabs / `core/tts/tts.py`'s `load()` hook for Kokoro) |
| `voice/lexicon.json` | how to say tech terms; grows with every film |
| `qa/verify.mjs` | the QA gate |
| `examples/gpu-ai/scenes.json` | the first test film |
| `test/fixture/` | the tiny film CI builds end to end (export → frames → mix → master → QA), with a synthetic voice |
| `test/synthetic_voice.py` | writes that fixture's `voice/<id>.wav` from its committed `voice/dur.json`; no voice model |

The CI `fast-film` job runs the same pipeline on that fixture: `python3 explainer/test/synthetic_voice.py explainer/test/fixture`,
then `sh explainer/make.sh explainer/test/fixture --skip-voice` (about 80 s on two cores).

## Voice

`voice.provider` in scenes.json, `--provider` on make.sh, or `EXPLAINER_VOICE`: `auto` (default), `elevenlabs`, `kokoro`.

- **ElevenLabs (preferred, human-sounding).** Needs `ELEVENLABS_API_KEY` in the environment and network access to
  `api.elevenlabs.io`. In a Claude Code cloud environment: environment settings → add the key (as a network secret for
  `api.elevenlabs.io` or the env var `ELEVENLABS_API_KEY`) and allow the host. Choose the voice with
  `voice.elevenlabs.voice_id` or `ELEVENLABS_VOICE_ID` (default: a stock voice). Each line is sent with its neighbours
  (`previous_text` / `next_text`) for natural flow; responses are cached in `voice/.cache/`, so re-builds cost nothing.
  Lexicon terms are sent as their `say` respelling ("GPU" → "G.P.U.", "ReLU" → "ray-loo").
- **Kokoro (local fallback).** Offline, no key. Lexicon terms are forced at phoneme level (IPA), so acronyms are never guessed.
  Less natural; `auto` uses it when no key is set and the QA report says so.

To add a term: put it in `voice/lexicon.json` as `"TERM": {"say": "respelling"}` (add `"ipa"` only if Kokoro still gets it wrong).
A term only one film needs can go in `films/<slug>/lexicon.json`.

## In this cloud container

- ffmpeg is 6.x, so `core/render/mux.sh` (needs 7) is not used; `make.sh` masters with ffmpeg-6-safe filters.
- `huggingface.co` is blocked, so the Whisper speech check (`core/tts/asr_check.py`) can't run here.
- Rendering uses Playwright's headless shell; 4 workers is right for a 4-core container.
