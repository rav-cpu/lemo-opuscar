"""explainer/voice/tts.py: the narration for one film, with a pluggable voice and a pronunciation gate.

    .venv/bin/python explainer/voice/tts.py films/<slug> [--provider auto|elevenlabs|kokoro] [--check-only]

Reads films/<slug>/scenes.json (each scene's `say`) and the pronunciation lexicon
(explainer/voice/lexicon.json, plus an optional films/<slug>/lexicon.json that adds or overrides terms).
Writes films/<slug>/voice/<id>.wav, dur.json and voice.json (provider, voice, exactly what each line was told to say).

Providers
  elevenlabs  hosted, human-sounding. Needs ELEVENLABS_API_KEY and network access to api.elevenlabs.io.
              Voice: scenes.json voice.elevenlabs.voice_id, else $ELEVENLABS_VOICE_ID, else a stock voice.
              Each line is sent with the lines before and after it (previous_text / next_text) so the delivery flows.
  kokoro      local, offline fallback (core/tts, voice tier). Lexicon terms are spoken with their IPA, never guessed.
  auto        (default) elevenlabs when a key is set, else kokoro, and says so loudly.

Pronunciation gate (runs first, for every provider; exit 1 on failure):
  - every acronym / CamelCase word (AI, GPU, ReLU, PyTorch, x86…) must be in the lexicon;
  - letters split by spaces ("A I") are refused: write the acronym whole and list it;
  - hosted voices get the lexicon's `say` respelling; Kokoro's phonemes must contain the lexicon IPA for every term.
"""
import sys, os, re, json, hashlib, subprocess, argparse, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('LIB', os.path.abspath(os.path.join(HERE, '..', '..')))

ap = argparse.ArgumentParser()
ap.add_argument('film'); ap.add_argument('--provider', default=None); ap.add_argument('--check-only', action='store_true')
A = ap.parse_args()
film = os.path.abspath(A.film); SC = json.load(open(os.path.join(film, 'scenes.json'), encoding='utf-8'))
VC = SC.get('voice', {})
LEX = {k: v for k, v in json.load(open(os.path.join(HERE, 'lexicon.json'), encoding='utf-8')).items() if not k.startswith('_')}
local = os.path.join(film, 'lexicon.json')
if os.path.exists(local): LEX.update({k: v for k, v in json.load(open(local, encoding='utf-8')).items() if not k.startswith('_')})
lines = [{'id': s['id'], 'text': s['say']} for s in SC['scenes']]
out = os.path.join(film, 'voice'); os.makedirs(out, exist_ok=True)

# ── 1. pronunciation gate ──
ACR = re.compile(r"\b(?:[A-Z][A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*|[a-z]+[0-9]+[a-z0-9]*)\b")   # AI, GPUs, ReLU, PyTorch, x86, GPT4
errs = []
for L in lines:
    t = L['text']
    if re.search(r'\b[A-Z]( [A-Z])+\b', t): errs.append(f"{L['id']}: letters split by spaces in {t!r}: write the acronym whole and add it to the lexicon")
    if re.search(r'\b[A-Z]\.[A-Z]\.', t): errs.append(f"{L['id']}: dotted letters in {t!r}: write the acronym whole (AI, not A.I.) and let the lexicon say it")
    for w in ACR.findall(t):
        if w not in LEX and not w.isdigit(): errs.append(f"{L['id']}: {w!r} is not in the lexicon (explainer/voice/lexicon.json or the film's lexicon.json)")
if errs: print('PRONUNCIATION CHECK FAILED\n  ' + '\n  '.join(errs)); sys.exit(1)
TERM = re.compile(r'(?<![\w.])(' + '|'.join(sorted(map(re.escape, LEX), key=len, reverse=True)) + r')(?![\w])')
def spoken(t): return TERM.sub(lambda m: LEX[m.group(1)]['say'], t)
terms = sorted({m for L in lines for m in TERM.findall(L['text'])})
print('pronunciation gate: OK; lexicon terms used:', ', '.join(terms) or 'none')
if A.check_only: sys.exit(0)

# ── 2. pick the provider ──
prov = (A.provider or os.environ.get('EXPLAINER_VOICE') or VC.get('provider') or 'auto').lower()
KEY = os.environ.get('ELEVENLABS_API_KEY', '').strip()
if prov == 'auto':
    prov = 'elevenlabs' if KEY else 'kokoro'
    if not KEY: print('\n!! VOICE FALLBACK: no ELEVENLABS_API_KEY, using the local Kokoro voice (less natural). See explainer/README.md, "Voice".\n')
if prov == 'elevenlabs' and not KEY: sys.exit('tts.py: provider elevenlabs needs ELEVENLABS_API_KEY in the environment')

import numpy as np, soundfile as sf
def trim(a, sr):
    nz = np.where(np.abs(a) > np.abs(a).max() * .02)[0]
    return a[max(0, nz[0] - int(.03 * sr)): nz[-1] + int(.08 * sr)]
dur, said = {}, {}

if prov == 'elevenlabs':
    E = VC.get('elevenlabs', {})
    vid = E.get('voice_id') or os.environ.get('ELEVENLABS_VOICE_ID') or '21m00Tcm4TlvDq8ikWAM'
    model = E.get('model', 'eleven_multilingual_v2')
    vs = {'stability': .45, 'similarity_boost': .8, 'style': .35, 'use_speaker_boost': True, **E.get('settings', {})}
    cache = os.path.join(out, '.cache'); os.makedirs(cache, exist_ok=True)
    texts = [spoken(L['text']) for L in lines]
    for i, L in enumerate(lines):
        body = {'text': texts[i], 'model_id': model, 'voice_settings': vs}
        if i: body['previous_text'] = texts[i - 1]
        if i + 1 < len(texts): body['next_text'] = texts[i + 1]
        h = hashlib.sha256(json.dumps([vid, body], sort_keys=True).encode()).hexdigest()[:20]; mp3 = os.path.join(cache, h + '.mp3')
        if not os.path.exists(mp3):
            req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_128', data=json.dumps(body).encode(),
                                         headers={'xi-api-key': KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
            try:
                with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
            except urllib.error.HTTPError as e: sys.exit(f"tts.py: ElevenLabs refused line {L['id']}: HTTP {e.code} {e.read()[:300].decode('utf-8', 'replace')}")
            except urllib.error.URLError as e: sys.exit(f"tts.py: can't reach api.elevenlabs.io ({e.reason}). Allow the host in the environment's network settings, or run with --provider kokoro")
            open(mp3 + '.tmp', 'wb').write(data); os.replace(mp3 + '.tmp', mp3)
        wav = os.path.join(out, L['id'] + '.wav')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp3, '-ac', '1', '-ar', '44100', wav], check=True)
        a, sr = sf.read(wav); a = trim(a, sr); sf.write(wav, a, sr)
        dur[L['id']] = round(len(a) / sr, 3); said[L['id']] = texts[i]; print(L['id'], dur[L['id']], texts[i])
    meta = {'provider': 'elevenlabs', 'voice': vid, 'model': model}
else:
    # Kokoro through the library's own loader (espeak path fix, model check), then phoneme-level lexicon substitution
    src = open(os.path.join(LIB, 'core', 'tts', 'tts.py'), encoding='utf-8').read().split('avail = k.get_voices()')[0]
    lj = os.path.join(out, 'lines.json'); json.dump(lines, open(lj, 'w', encoding='utf-8'), ensure_ascii=False)
    sys.argv = [os.path.join(LIB, 'core', 'tts', 'tts.py'), lj, out]
    g = {'__name__': 'tts_lib', '__file__': sys.argv[0]}; exec(compile(src, 'tts.py', 'exec'), g); k = g['k']
    from kokoro_onnx.tokenizer import Tokenizer
    tok = Tokenizer(); K = VC.get('kokoro', {}); voice = K.get('voice', 'af_heart'); speed = K.get('speed', 1.0); lang = K.get('lang', 'en-us')
    ipa = {term: (LEX[term].get('ipa') or tok.phonemize(LEX[term]['say'].replace('.', ''), lang).strip()) for term in terms}
    for L, S in zip(lines, SC['scenes']):
        ph = tok.phonemize(L['text'], lang)
        for term in sorted(set(TERM.findall(L['text'])), key=len, reverse=True):
            guess = tok.phonemize(term, lang).strip()
            if guess != ipa[term]:
                if guess not in ph: print(f"PRONUNCIATION CHECK FAILED: {L['id']}: can't locate {term!r} ({guess}) in {ph}"); sys.exit(1)
                # a plural said alone loses its s ("GPUs" → …juː) but keeps it in a sentence (…juːz): swallow it so it isn't doubled
                ph = re.sub(re.escape(guess) + ('[zs]?' if term.endswith('s') else ''), lambda m: ipa[term], ph)
            if ipa[term] not in ph: print(f"PRONUNCIATION CHECK FAILED: {L['id']} lost {term}"); sys.exit(1)
        a, sr = k.create(ph, voice=S.get('voice', voice), speed=S.get('speed', speed), lang=lang, is_phonemes=True)
        a = trim(a, sr); sf.write(os.path.join(out, L['id'] + '.wav'), a, sr)
        dur[L['id']] = round(len(a) / sr, 3); said[L['id']] = ph; print(L['id'], dur[L['id']], ph)
    meta = {'provider': 'kokoro', 'voice': voice, 'ipa': ipa}

json.dump(dur, open(os.path.join(out, 'dur.json'), 'w'), indent=1)
json.dump({**meta, 'terms': terms, 'said': said}, open(os.path.join(out, 'voice.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"voice: {meta['provider']} ({meta['voice']}), {len(lines)} lines, {sum(dur.values()):.1f}s of speech")
