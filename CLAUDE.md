@AGENTS.md

## This fork: the tech explainer pipeline (read this first)

The owner of this fork makes short vertical tech explainers (1080×1920, 30–60 s) in the Oscilloscope Math style.
When they give you a topic ("make a video on X", "explain Y"), use the pipeline in [`explainer/`](explainer/README.md)
instead of building a film from scratch. It replaces the Brief / Treatment / Look steps of AGENTS.md for this kind of film:
the style, format and voice are already decided. Ask nothing up front unless a fact about the topic is genuinely unclear.

1. **Setup** (once per container): `sh explainer/setup.sh`. Run it in the background right away; it takes ~3 min.
2. **Start**: `sh explainer/new.sh <slug> "<topic>"`.
3. **Script**: write `films/<slug>/scenes.json` following [`explainer/SCENES.md`](explainer/SCENES.md): hook → core idea → build → payoff,
   5–8 scenes, one idea and ≤ 24 spoken words each, every visual a primitive that shows what the line says.
   Copy `explainer/examples/gpu-ai/scenes.json` for the shape. Add any new acronym or CamelCase term to `explainer/voice/lexicon.json`
   with a `say` respelling (keep it in the PR: the dictionary grows with every film).
4. **Build**: `sh explainer/make.sh films/<slug>`. It lints, voices, renders, mixes, masters, and runs the **mandatory QA gate**.
   If anything fails, read the message (or `films/<slug>/qa/report.md`), fix scenes.json or the engine, and run again.
   Never hand over a film that did not pass; never weaken a QA check to get a pass.
5. **Look** at `films/<slug>/qa/contact.jpg` and a few stills (`node core/render/still.mjs films/<slug> <t> … --size 1080x1920`)
   before delivering: the gate catches layout and timing faults, not taste.
6. **Deliver** `films/<slug>/dist/` (mp4, srt, poster, QA report, contact sheet). Say which voice was used.

Owner's standing preferences:
- A **human, expressive voice**: ElevenLabs when `ELEVENLABS_API_KEY` is set (and `api.elevenlabs.io` is reachable); the local Kokoro voice is
  only a fallback, and you must say so when it was used.
- **Correct pronunciation** of every tech term: A.I. as letters, never "eye"; the lexicon gate enforces it.
- **Polish**: no overlaps, no jumpy transitions, timing that breathes. The QA gate exists because of this.
