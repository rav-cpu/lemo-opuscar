#!/bin/sh
# explainer/setup.sh: everything the explainer pipeline needs, from the library root. Idempotent; ~3 min the first time.
#   node packages + headless browser + .venv (core) + Kokoro voice tier (local fallback voice and its model)
# Then reports whether the hosted voice (ElevenLabs) is usable.
set -e
LIB=$(cd "$(dirname "$0")/.." && pwd); cd "$LIB"
command -v ffmpeg >/dev/null || { echo "✗ ffmpeg is missing (apt-get install -y ffmpeg / brew install ffmpeg)"; exit 1; }
command -v node >/dev/null || { echo "✗ node 20+ is missing"; exit 1; }
sh plugin/skills/lemo-opuscar/scripts/setup.sh deps voice
echo
if [ -n "$ELEVENLABS_API_KEY" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/user || true)
  case $code in
    200) echo "✓ ElevenLabs: key works; films use the hosted voice" ;;
    401|403) echo "✗ ElevenLabs: the key was refused (HTTP $code); films will fall back to the local voice" ;;
    *) echo "✗ ElevenLabs: api.elevenlabs.io unreachable (HTTP $code): allow the host in the network settings; films will fall back to the local voice" ;;
  esac
else
  echo "• ElevenLabs: no ELEVENLABS_API_KEY; films use the local Kokoro voice (see explainer/README.md, Voice)"
fi
echo "✓ explainer ready: sh explainer/new.sh <slug> \"<topic>\""
