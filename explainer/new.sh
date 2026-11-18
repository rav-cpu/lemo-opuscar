#!/bin/sh
# explainer/new.sh <slug> "<topic>": start a film folder films/<slug>/ with the page and a scenes.json skeleton.
# Then write the script in films/<slug>/scenes.json (explainer/SCENES.md) and build with sh explainer/make.sh films/<slug>.
set -e
[ -n "$2" ] || { echo 'usage: sh explainer/new.sh <slug> "<topic>"'; exit 2; }
LIB=$(cd "$(dirname "$0")/.." && pwd); D="$LIB/films/$1"
[ ! -e "$D/scenes.json" ] || { echo "films/$1/scenes.json already exists"; exit 1; }
mkdir -p "$D"; cp "$LIB/explainer/engine/index.html" "$D/index.html"
TOPIC="$2" python3 - "$D/scenes.json" <<'EOF'
import json, os, sys
t = os.environ['TOPIC']
json.dump({"title": t, "topic": t, "voice": {"provider": "auto", "kokoro": {"voice": "af_heart", "speed": 1.0}},
  "scenes": [{"id": "s1", "say": "REPLACE: the hook, as the viewer would ask it.", "visual": {"type": "title", "text": t}}]},
  open(sys.argv[1], 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
EOF
echo "films/$1/ ready. Write the scenes (explainer/SCENES.md), then: sh explainer/make.sh films/$1"
