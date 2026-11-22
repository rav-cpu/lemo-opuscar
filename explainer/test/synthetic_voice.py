#!/usr/bin/env python3
"""explainer/test/synthetic_voice.py <film>: the fixture's voice, without a voice model.

    python3 explainer/test/synthetic_voice.py explainer/test/fixture

Reads the film's scenes.json and committed voice/dur.json, and writes voice/<id>.wav for every scene, each exactly
as long as dur.json says: a soft two-tone, so the mix and the QA gate measure something real. The standard library
only, so CI runs this instead of explainer/voice/tts.py (which needs the ~350 MB Kokoro model or ELEVENLABS_API_KEY).
voice/voice.json is committed beside dur.json: the QA gate needs the voice record.
"""
import array, json, math, os, sys, wave

film = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "")
if not os.path.isfile(os.path.join(film, "scenes.json")):
    sys.exit("usage: python3 explainer/test/synthetic_voice.py <film folder with scenes.json>")
SC = json.load(open(os.path.join(film, "scenes.json"), encoding="utf-8"))
DUR = json.load(open(os.path.join(film, "voice", "dur.json"), encoding="utf-8"))
ids = [s["id"] for s in SC["scenes"]]
missing = [i for i in ids if i not in DUR]
extra = [i for i in DUR if i not in ids]
if missing or extra:
    sys.exit(f"voice/dur.json must name every scene exactly once (missing: {missing}, extra: {extra})")

SR = 44100
out = os.path.join(film, "voice")
os.makedirs(out, exist_ok=True)
for n, sid in enumerate(ids):
    d = DUR[sid]
    if not isinstance(d, (int, float)) or not 0.2 <= d <= 30:
        sys.exit(f"voice/dur.json: {sid} is {d!r}, not a duration in seconds")
    freq = 196.0 * 2 ** ((n % 3) / 12)   # a different note per line
    frames = array.array("h")
    for k in range(round(d * SR)):
        t = k / SR
        fade = min(1.0, t / 0.03, (d - t) / 0.08)   # no click at either end
        v = 0.06 * fade * (math.sin(2 * math.pi * freq * t) + 0.35 * math.sin(4 * math.pi * freq * t))
        frames.append(round(v * 32767))
    with wave.open(os.path.join(out, sid + ".wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(frames.tobytes())
    print(f"voice/{sid}.wav {d:.3f}s")
print(f"synthetic voice: {len(ids)} lines, {sum(DUR[i] for i in ids):.1f}s")
