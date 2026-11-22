#!/bin/sh
# explainer/make.sh films/<slug> [--provider auto|elevenlabs|kokoro] [--workers 4] [--skip-voice]
# One command from scenes.json to a checked film:
#   lint → pronunciation gate + voice → timeline → frames → mix → master (−14 LUFS) → subtitles → QA gate.
# Exits non-zero at the first failed step. The film is delivered to films/<slug>/dist/ ONLY if the QA gate passes.
# --skip-voice uses the voice files already in the film folder (the test fixture's synthetic voice); it checks they are
# complete and match scenes.json, so a missing line fails here instead of quietly recording nothing.
set -e
[ -n "$1" ] || { echo "usage: sh explainer/make.sh films/<slug> [--provider P] [--workers N] [--skip-voice]"; exit 2; }
LIB=$(cd "$(dirname "$0")/.." && pwd); export LIB; cd "$LIB"
FILM=$(cd "$1" && pwd); SLUG=$(basename "$FILM"); shift
PROVIDER=""; WORKERS=4; SKIP_VOICE=0
while [ $# -gt 0 ]; do case $1 in --provider) PROVIDER="--provider $2"; shift 2 ;; --workers) WORKERS=$2; shift 2 ;; --skip-voice) SKIP_VOICE=1; shift ;; *) echo "unknown option $1"; exit 2 ;; esac; done
PY=.venv/bin/python
[ -x "$PY" ] || { echo "✗ no .venv: run sh explainer/setup.sh first"; exit 1; }
[ -f "$FILM/index.html" ] || cp explainer/engine/index.html "$FILM/index.html"
step() { printf '\n── %s ──\n' "$1"; }
step "1/8 lint scenes.json";            $PY explainer/lint.py "$FILM"
if [ "$SKIP_VOICE" = 1 ]; then
  step "2/8 voice (skipped: using the voice already in $SLUG/voice)"
  $PY - "$FILM" <<'PY'
import json, os, sys, wave
film = sys.argv[1]
scenes = json.load(open(os.path.join(film, 'scenes.json'), encoding='utf-8'))['scenes']
durs = json.load(open(os.path.join(film, 'voice', 'dur.json'), encoding='utf-8'))
ids = {s['id'] for s in scenes}
bad = [f"voice/dur.json has no duration for scene {i!r}" for i in sorted(ids - set(durs))]
bad += [f"voice/dur.json names {i!r}, which is not a scene" for i in sorted(set(durs) - ids)]
for s in scenes:
    i, d = s['id'], durs.get(s['id'])
    if not isinstance(d, (int, float)) or d <= 0: bad.append(f"voice/dur.json: {i} is {d!r}, not a duration"); continue
    p = os.path.join(film, 'voice', i + '.wav')
    if not os.path.isfile(p): bad.append(f"voice/{i}.wav is missing"); continue
    try:
        with wave.open(p) as w: got = w.getnframes() / w.getframerate()
    except Exception as e: bad.append(f"voice/{i}.wav is not a readable WAV: {e}"); continue
    if abs(got - d) > 0.02: bad.append(f"voice/{i}.wav is {got:.3f}s but voice/dur.json says {d:.3f}s")
vj = os.path.join(film, 'voice', 'voice.json')
if not os.path.isfile(vj): bad.append('voice/voice.json is missing (the QA gate needs the voice record)')
else:
    try: json.load(open(vj, encoding='utf-8'))
    except Exception as e: bad.append(f'voice/voice.json is not valid JSON: {e}')
if bad: print('VOICE CHECK FAILED (--skip-voice)\n  ' + '\n  '.join(bad)); sys.exit(1)
print(f"voice: {len(scenes)} lines already in voice/ ({sum(durs[i] for i in ids):.1f}s; --skip-voice)")
PY
else
  step "2/8 pronunciation gate + voice";  $PY explainer/voice/tts.py "$FILM" $PROVIDER
fi
step "3/8 timeline";                    node explainer/engine/export.mjs "$FILM"
step "4/8 frames";                      node core/render/video.mjs "$FILM" --fps 24 --workers "$WORKERS" --size 1080x1920 --out "$FILM/out/video.mp4"
step "5/8 mix";                         $PY explainer/engine/mix.py "$FILM"
step "6/8 master + mux"
cd "$FILM/out"
# two-pass loudnorm to −14 LUFS, oversampled true-peak limit (works on ffmpeg 6 and 7)
J=$(ffmpeg -hide_banner -i mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
[ -n "$J" ] || { echo "✗ ffmpeg measured nothing for out/mix.wav (loudnorm): see its output above"; exit 1; }
M=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}\")")
ffmpeg -y -loglevel error -i mix.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11:$M:linear=true,volume=-0.6dB,aresample=192000,alimiter=limit=0.74:level=false:attack=1:release=50,aresample=48000" -c:a pcm_s16le master.wav
ffmpeg -y -loglevel error -i video.mp4 -i master.wav -map 0:v -map 1:a -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$FILM/$SLUG.mp4"
cd "$LIB"
step "7/8 subtitles + poster"
$PY core/render/srt.py "$FILM/out/cues.json" "$FILM/$SLUG.srt"
PT=$(python3 -c "import json;s=json.load(open('$FILM/out/timeline.json'))['scenes'];x=s[len(s)//2];print(round((x['t0']+x['t1'])/2,2))")
ffmpeg -y -loglevel error -ss "$PT" -i "$FILM/$SLUG.mp4" -frames:v 1 -q:v 2 "$FILM/poster.jpg"
step "8/8 QA gate"
if node explainer/qa/verify.mjs "$FILM" --video "$FILM/$SLUG.mp4"; then
  mkdir -p "$FILM/dist"; cp "$FILM/$SLUG.mp4" "$FILM/$SLUG.srt" "$FILM/poster.jpg" "$FILM/qa/report.md" "$FILM/qa/contact.jpg" "$FILM/dist/"
  echo "✓ PASSED: $FILM/dist/$SLUG.mp4 (report: $FILM/qa/report.md)"
else
  echo "✗ QA FAILED: nothing delivered. Read $FILM/qa/report.md, fix scenes.json (or the engine), run again."; exit 1
fi
