"""explainer/lint.py films/<slug>: check scenes.json before anything is rendered (exit 1 on errors).
Schema of every primitive, script length and pacing, expressions, on-screen text that would not fit or not be readable."""
import sys, os, re, json
film = os.path.abspath(sys.argv[1]); p = os.path.join(film, 'scenes.json')
try: SC = json.load(open(p, encoding='utf-8'))
except Exception as e: sys.exit(f'lint: {p}: {e}')
E, Wn = [], []
MATH = 'sin cos tan exp log log2 log10 sqrt abs min max pow tanh sign floor ceil round PI E sigmoid relu step gauss x'.split()
NEED = {'title': ['text'], 'formula': ['tex'], 'signal': ['traces'], 'graph': [], 'xy': [], 'bars': [], 'readout': []}
WAVES = {'sine', 'square', 'saw', 'pulse', 'noise', 'dc', 'expr'}
def expr_ok(where, ex):
    if not re.fullmatch(r"[\w\s.+\-*/%^(),<>=?:!&|]*", str(ex)): E.append(f'{where}: expression {ex!r} has characters other than maths')
    for n in re.findall(r'[A-Za-z_]\w*', str(ex)):
        if n not in MATH: E.append(f'{where}: expression {ex!r} uses {n!r}; allowed: {", ".join(MATH)}')
if not SC.get('title'): Wn.append('no "title" (shown small in the HUD)')
sc = SC.get('scenes') or []
if not sc: E.append('no scenes')
ids = [s.get('id') for s in sc]
if len(set(ids)) != len(ids) or None in ids: E.append(f'scene ids must be unique and present: {ids}')
words = 0
for s in sc:
    i = s.get('id', '?'); say = s.get('say', '').strip(); v = s.get('visual') or {}
    if not say or 'REPLACE' in say: E.append(f'{i}: "say" is empty or still the placeholder')
    nw = len(say.split()); words += nw
    if nw > 24: E.append(f'{i}: {nw} words in one line; keep each line ≤ 24 words (split the scene)')
    if len(s.get('sub', say)) > 120: E.append(f'{i}: subtitle over 120 characters')
    t = v.get('type')
    if t not in NEED: E.append(f'{i}: visual.type {t!r} is not one of {", ".join(NEED)}'); continue
    for k in NEED[t]:
        if k not in v: E.append(f'{i}: {t} needs "{k}"')
    if t == 'signal':
        tr = v.get('traces', [])
        if not 1 <= len(tr) <= 4: E.append(f'{i}: signal takes 1–4 traces (plus an optional sum)')
        for j, r in enumerate(tr + ([v['sum']] if v.get('sum') else [])):
            if r.get('wave', 'sine') not in WAVES: E.append(f'{i}: trace {j} wave {r.get("wave")!r} not in {sorted(WAVES)}')
            if r.get('wave') == 'expr': expr_ok(f'{i} trace {j}', r.get('expr', ''))
            if abs(r.get('amp', 1)) + abs(r.get('offset', 0)) > 1.15: Wn.append(f'{i}: trace {j} amp+offset > 1.15 is clipped')
    if t == 'graph':
        fns = v.get('fns') or ([{'expr': v.get('fn')}] if v.get('fn') else [])
        if not fns: E.append(f'{i}: graph needs "fn" or "fns"')
        if len(fns) > 3: E.append(f'{i}: graph takes at most 3 curves')
        for f in fns: expr_ok(i, f.get('expr', ''))
        for ax in ('x', 'y'):
            r = v.get(ax)
            if r and not (len(r) == 2 and r[0] < r[1]): E.append(f'{i}: graph "{ax}" must be [min, max]')
    if t == 'readout':
        if not v.get('rows') and not v.get('big'): E.append(f'{i}: readout needs "rows" or "big"')
        if len(v.get('rows', [])) > 6: E.append(f'{i}: readout takes at most 6 rows')
        if v.get('big') and not isinstance(v['big'].get('value'), (int, float)): E.append(f'{i}: readout.big.value must be a number')
    if t == 'bars' and v.get('mode', 'parallel') not in ('parallel', 'serial'): E.append(f'{i}: bars.mode is parallel or serial')
    if t == 'formula' and len(v.get('notes', [])) > 3: E.append(f'{i}: formula takes at most 3 notes')
    for k in ('caption',):
        if len(v.get(k, '')) > 60: Wn.append(f'{i}: {k} over 60 characters will be shrunk')
est = words / 2.6 + len(sc) * 1.4 + 3
if not 15 <= est <= 95: Wn.append(f'estimated length {est:.0f}s (aim for 25–60 s for a short)')
for w in Wn: print('WARN ', w)
for e in E: print('ERROR', e)
print(f'lint: {len(sc)} scenes, {words} words, ~{est:.0f}s; {len(E)} error(s), {len(Wn)} warning(s)')
sys.exit(1 if E else 0)
