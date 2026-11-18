# Writing a tech explainer: topic → scenes.json

You get a topic ("Why do GPUs make AI fast?"). You write `films/<slug>/scenes.json`. The engine does the rest:
timing comes from the voice, the camera glides from one scene panel to the next, and the QA gate checks the result.

## 1. Script first (the part that makes it good)

Shape for a 30–60 s vertical short, 5–8 scenes:

| Beat | Job | Usual visual |
|---|---|---|
| Hook (1 scene) | The question, as the viewer would ask it | `title` |
| Core idea (1–2) | The one mechanism, in plain words, then its compact form | `formula`, `readout` |
| Build (2–3) | Show the mechanism working, or compare two things | `signal`, `bars`, `graph` |
| Payoff (1) | The answer in one line the viewer can repeat | `xy`, `signal` with a sum, or a `readout` |

Rules for the lines (`say`):
- **One idea per scene, at most 24 words** (lint fails above). Short sentences. Spoken English, contractions welcome.
- Write for the ear: "And a negative weight? It pushes back!" beats "Negative weights produce inhibitory effects."
- `...` makes a natural pause; `?` and `!` change the delivery. Don't overdo either.
- Write acronyms whole, exactly as the lexicon lists them: `AI`, `GPU`, `ReLU`. Never `A I` or `A.I.` (the gate refuses both).
  A new acronym or CamelCase word **must** be added to `explainer/voice/lexicon.json` (or the film's own `lexicon.json`) with a `say` respelling, or the build stops.
- Numbers: digits are fine ("16 cores"). Say units in words where it matters ("gigabytes", or use `GB`, which the lexicon says right).
- Facts: if you are not sure, simplify until you are. Viewers forgive simple; they don't forgive wrong.
- `sub` (optional) is the subtitle when it should differ from what's said (for example `0 and 1` on screen for "zero and one").

Pick visuals that **show** what the line says, at the moment it is said. A visual that only decorates is a wasted scene.

## 2. The file

```jsonc
{
 "title": "Why do GPUs make AI fast?",            // small, top-left in the HUD
 "topic": "the user's words",
 "voice": {
  "provider": "auto",                              // auto | elevenlabs | kokoro
  "elevenlabs": {"voice_id": "…", "model": "eleven_multilingual_v2", "settings": {"stability": 0.45, "style": 0.35}},
  "kokoro": {"voice": "af_heart", "speed": 1.0}
 },
 "bpm": 96,                                        // optional, the score's tempo
 "outro": 1.2,                                     // optional, seconds held after the last scene before the CRT power-off
 "scenes": [
  {"id": "s1", "say": "…", "sub": "…", "hold": 0.0, "visual": {"type": "title", "text": "…"}}
 ]
}
```

Every visual takes an optional `caption` (short mono line at the top of the panel, ≤ 60 characters).
A scene lasts as long as its line plus breathing room, and longer if its on-screen text needs reading time; `hold` adds seconds.

## 3. Visual primitives

| type | fields | shows |
|---|---|---|
| `title` | `text` (≤ 3 lines at 92 px, shrinks to fit), `sub`, `italic` | text written by the beam glyph by glyph, then a beam underline |
| `formula` | `tex`, `notes` (≤ 3 short lines), `pin` (true: stays in the HUD for the rest of the film) | typed glyph by glyph with a white-hot flash, an amber measurement cursor under it |
| `signal` | `traces`: 1–4 × `{label, wave, freq, amp, phase, offset, duty, expr}`, `sum`: `{label}`, `tps` (px per second, default 200) | scrolling oscilloscope channels; `sum` adds a channel with all traces added (the "many become one" move) |
| `graph` | `fn` or `fns` (≤ 3 × `{expr, label}`), `x: [min,max]`, `y: [min,max]`, `xlabel`, `ylabel`, `point` | axes with ticks, curves drawn by the beam one after another (solid, dashed, dotted), legend top-right; `point` rides a measured dot along the first curve |
| `xy` | `fx`, `fy` (frequency ratio, e.g. 3 and 2), `phase`, `r`, `readout` | X-Y mode: a Lissajous figure drawn with afterglow |
| `bars` | `values` (0–1) or `count` (≤ 96), `mode`: `parallel` \| `serial`, `counter` | spectrum-style bars; `parallel` rise together and shimmer, `serial` light one at a time across the scene |
| `readout` | `rows` (≤ 6 × `[key, value]`), `big`: `{value, prefix, unit, decimals, label}` | measurement rows typed in; `big` counts up to a number in large serif |

Waves: `sine`, `square`, `saw`, `pulse` (with `duty`), `noise`, `dc`, `expr` (any expression in `x` = time in seconds).
Expressions (`expr`, graph `fn`) are maths only: numbers, `+ - * / ^ %`, comparisons, `x`, and
`sin cos tan exp log log2 log10 sqrt abs min max pow tanh sign floor ceil round PI E sigmoid relu step gauss`.
Keep `amp + |offset|` ≤ 1 per trace.

Formula markup: `_` subscript and `^` superscript (one character, or `{…}`), `*` becomes `·`, single letters and
Greek are italic, words of 3+ letters are upright (`max`, `exp`, `ReLU`). Example: `y = σ(w_1x_1 + w_2x_2 + b)`, `e^{-z}`.

## 4. Check before you render

```sh
.venv/bin/python explainer/lint.py films/<slug>                    # schema, pacing, expressions
.venv/bin/python explainer/voice/tts.py films/<slug> --check-only  # pronunciation gate only
node core/render/still.mjs films/<slug> 4 9 15 --size 1080x1920    # look at a few frames
```
