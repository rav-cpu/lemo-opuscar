"""explainer/engine/mix.py films/<slug>: score, foley and voice → films/<slug>/out/mix.wav
Reads out/timeline.json (from export.mjs), so the sound follows the real line lengths. Oscilloscope Math sound palette:
an electrical hum bed, a soft pad and plucked arpeggio that changes chord with every scene, relay clacks, beam ticks,
measurement blips, sweeps on camera moves, a bell when a drawing resolves, a CRT zap at power-off. Music ducks ~10 dB under the voice."""
import os, sys, json, math
import numpy as np, soundfile as sf, soxr
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('LIB', os.path.abspath(os.path.join(HERE, '..', '..')))
sys.path.insert(0, os.path.join(LIB, 'core', 'audio'))
import sfx
from sfx import SR, t_, env_exp, bp, lp, hp, noise, add, compress, limit

film = os.path.abspath(sys.argv[1])
TL = json.load(open(os.path.join(film, 'out', 'timeline.json')))
SC = json.load(open(os.path.join(film, 'scenes.json'), encoding='utf-8'))
DUR, EV, SCN = TL['dur'], TL['ev'], TL['scenes']
n = int(DUR * SR) + SR
mus = np.zeros((n, 2)); fol = np.zeros((n, 2)); vox = np.zeros((n, 2))
rng = np.random.default_rng(7)
mtof = lambda m: 440 * 2 ** ((m - 69) / 12)
BPM = SC.get('bpm', 96); beat = 60 / BPM
END = next(e['t'] for e in EV if e['type'] == 'zap')

def adsr(d, a=.01, r=.2):
    e = np.ones(len(t_(d))); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr and nr < len(e): e[-nr:] *= np.linspace(1, 0, nr)
    return e
def tone(f, d, harm=(1,), decay=.5, a=.005):
    t = t_(d); x = sum(np.sin(2 * np.pi * f * k * t) / (k ** 1.2) for k in harm)
    return x * env_exp(d, decay) * adsr(d, a, min(.05, d / 3))
def pad(f, d, a=.8):
    t = t_(d); x = np.sin(2 * np.pi * f * t + .3 * np.sin(2 * np.pi * 5 * t)) + .3 * np.sin(2 * np.pi * 2 * f * t)
    return x * adsr(d, a, a)

# ── score: one chord per scene (A F C G …), pad + 8th-note plucks whose timbre brightens as the film goes on ──
CH = [57, 53, 48, 55, 57, 50, 53, 52]
ARP = lambda r: [r + 12, r + 15 + (r in (53, 48, 55)) * 1, r + 19, r + 24]
for k, S in enumerate(SCN):
    root = CH[k % len(CH)]; t0, t1 = S['t0'], min(S['t1'], END)
    d = t1 - t0 + .6
    for m, g in ((root - 12, .045), (root - 5, .03), (root + 4 if root in (53, 48, 55) else root + 3, .025)): add(mus, pad(mtof(m), d, .7), t0, g, (-.3, .3, 0)[(m % 3)])
    harm = (1,) if k < 2 else (1, 2) if k < 4 else (1, 2, 3, 5)
    t, step = t0 + beat, 0
    while t < t1 - .2:
        m = ARP(root)[step % 4]
        if step % 2 == 0 or k >= 2: add(mus, tone(mtof(m), beat * .9, harm, .22), t, .045, .25 * math.sin(step))
        if step % 4 == 0 and k >= 1: add(mus, tone(mtof(root - 24), beat * 1.8, (1, 2, 3), .6, .01), t, .07)
        t += beat / 2; step += 1
add(mus, sum(pad(mtof(m), 1.6, .4) for m in (57, 61, 64, 69)), END - 1.0, .035)

# ── foley ──
def blip(f, v=1): d = .07; return np.sin(2 * np.pi * f * t_(d)) * env_exp(d, .02) * v
def tick(): return hp(noise(.012), 3000) * env_exp(.012, .002)
def bell(f, big=0):
    d = 2.5 if big else 1.6; t = t_(d)
    return sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / dd) for r, a, dd in ((1, 1, .9), (2.76, .4, .4), (5.4, .2, .2), (.5, .3 if big else 0, 1.5)))
def sweep(d, up=0):
    x = noise(d); out = np.zeros_like(x); seg = int(SR * .02)
    for i in range(0, len(x), seg):
        u = i / len(x); fc = 300 * (12 ** u) if up else 3500 * (1 - .8 * u)
        out[i:i + seg] = bp(x[i:i + seg], max(80, fc * .7), min(SR / 2 - 100, fc * 1.4), 1)
    return out * np.sin(np.pi * np.linspace(0, 1, len(x))) * .5
def buzz(d): t = t_(d); return (np.sign(np.sin(2 * np.pi * 120 * t)) * .3 + np.sin(2 * np.pi * 240 * t)) * .15 * adsr(d, .05, .2)
def zap(): d = .9; t = t_(d); f = 1800 * np.exp(-t * 5) + 40; return np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(d, .35)
def warm(): d = 1.2; t = t_(d); f = 60 + 900 * t; return np.sin(2 * np.pi * np.cumsum(f) / SR) * adsr(d, .05, .6) * .25
for e in EV:
    ty, t = e['type'], e['t']
    if ty == 'relay': add(fol, sfx.clack(1.0, 1.0), t, .5)
    elif ty == 'warm': add(fol, warm(), t, .5)
    elif ty == 'tick': add(fol, tick(), t, .25 * e.get('g', 1), rng.uniform(-.3, .3))
    elif ty == 'pluck': add(fol, blip(880 * (1 + .25 * e['ch'])), t, .3)
    elif ty == 'blip': add(fol, blip(e['f']), t, .25)
    elif ty == 'sweep': add(fol, sweep(e['d'], e.get('up', 0)), t, .3)
    elif ty == 'bell': add(mus, bell(e['f'], e.get('big', 0)), t, .12 if not e.get('big') else .15)
    elif ty == 'buzz': add(fol, buzz(e['d']), t, .35)
    elif ty == 'scene' and e['i']: add(fol, sfx.clack(1.2, .7), t - .5, .25)
    elif ty == 'zap': add(fol, zap(), t, .5); add(fol, sfx.thump(.8), t + .9, .5)
th = np.arange(n) / SR
hum = (np.sin(2 * np.pi * 50 * th) * .5 + np.sin(2 * np.pi * 100 * th) * .3 + np.sin(2 * np.pi * 150 * th) * .15) + lp(noise(n / SR)[:n], 400) * .2
hum *= np.clip((th - .15) / .5, 0, 1) * np.clip(1 - (th - END - .8) / .4, 0, 1)
fol += (hum * .012)[:, None]

# ── voice: warmth, a small room, compression ──
for e in EV:
    if e['type'] != 'voice': continue
    x, sr = sf.read(os.path.join(film, 'voice', e['id'] + '.wav'))
    if x.ndim > 1: x = x.mean(1)
    x = soxr.resample(x, sr, SR); x = compress(x / (np.abs(x).max() + 1e-9) * .9, .3, 3.0)
    x = x + .15 * bp(x, 150, 400) - .2 * hp(x, 7000)
    ir = noise(.28) * env_exp(.28, .06); ir[0] = 0; ir = lp(ir, 5000) * .05
    x = x + np.convolve(x, ir)[:len(x)] * .8
    add(vox, x, e['t'], .3)

# ── duck music under the voice ──
venv = np.abs(vox).mean(1); k = int(.05 * SR); venv = np.convolve(venv, np.ones(k) / k, 'same')
duck = 1 - .6 * np.clip(venv / .02, 0, 1)
mid = np.stack([bp(mus[:, c], 300, 4000) for c in range(2)], 1)
mus = mus - mid * (1 - duck)[:, None] * .6
mus *= (.55 + .45 * duck)[:, None]; fol *= (.75 + .25 * duck)[:, None]
outm = (mus * .6 + fol + vox)[:int(DUR * SR)]
outm = outm / max(1e-9, np.abs(outm).max()) * .9
outm = np.stack([limit(outm[:, c], .95) for c in range(2)], 1)
sf.write(os.path.join(film, 'out', 'mix.wav'), outm.astype(np.float32), SR, subtype='FLOAT')
rms = lambda x: 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)
spk = venv[:len(outm)] > .01
print(f'mix.wav {DUR:.1f}s  voice over music while speaking: {rms(vox[:len(outm)][spk]) - rms(.6 * mus[:len(outm)][spk]):.1f} dB')
