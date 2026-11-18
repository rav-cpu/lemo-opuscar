// explainer/engine/film.js: the generic Oscilloscope Math scene engine (vertical 1080x1920).
// A film folder holds index.html (loads this file), scenes.json (the script and visuals) and voice/dur.json (from voice/tts.py).
// Everything on screen comes from scenes.json: one scene = one spoken line + one visual primitive.
// Primitives: title, formula, signal, graph, xy, bars, readout. Schema: explainer/SCENES.md.
// Page contract (core/README.md): READY, render(t), DUR, EV (sound events), TEXTS(t) (readcheck), plus QA(t) and CUES for explainer/qa/verify.mjs.
import { clamp, lerp, seg, ss, eio, eo } from '/core/lib.js';

const SC = await (await fetch('scenes.json')).json();
let DURS = {}; try { DURS = await (await fetch('voice/dur.json')).json(); } catch { }
const W = innerWidth, H = innerHeight;
const cv = document.getElementById('c'); cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const [Fc, F] = mk(W, H), [Gc, GW] = mk(W, H), [Uc, UW] = mk(W, H), [GHc, GH] = mk(W, H), [UHc, UH] = mk(W, H), [B0c, B0] = mk(W / 2, H / 2);
let G = GW, U = UW;                        // world layers (masked to the band between HUD and subtitles) vs glass layers (HUD, subtitles)
const BAND = [330, 1560], FEATHER = 60;
const BLOOM = [[2, 1.2, .50], [4, 2.0, .42], [8, 2.6, .30], [16, 3.0, .20]].map(([ds, sg, w]) => [...mk(W / ds, H / ds), ds, sg, w]);
const C = { bg: '#010402', beam: '#4DFF88', ui: '#8DFFB0', hot: '#E6FFEC', amb: '#FFB547' };
const MONO = 'JetBrains Mono', SERIF = 'STIX Two Text';
const SCY = H * 0.47, PANEL = 1180;        // panel k is centred on world y = -k*PANEL; closer than the band height, so a glide always shows the outgoing or incoming visual
const FX = 56, FY = 150;

const fmt = (v, d = 2, sign = false) => { const s = Math.abs(v).toFixed(d); const neg = v < 0 && +s !== 0; return (neg ? '−' : sign ? '+' : '') + s; };
const commas = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function bigStr(b, u) { const v = b.value * u; return (b.prefix || '') + (Number.isInteger(b.value) ? commas(v) : v.toFixed(b.decimals ?? 2)) + (b.unit ? ' ' + b.unit : ''); }

// ───────── timing: derived from voice durations and reading time ─────────
const ENTER = 0.5, LEAD = 1.8, VPRE = 0.45, VPOST = 0.9, MOVE = 0.85;   // the camera leaves MOVE s before a scene starts and lands 0.15 s after
const nonspace = s => (s || '').replace(/\s/g, '').length;
const readNeed = s => nonspace(s) / 15 + 1.5;
const SCENES = SC.scenes.map((s, i) => ({ ...s, idx: i, v: s.visual || { type: 'readout', rows: [] }, sub: s.sub || s.say }));
// texts each visual shows for reading (and when they appear, relative to scene start); used both for timing and for TEXTS(t)
function readTexts(S) {
  const v = S.v, out = [];
  if (v.caption) out.push({ k: 'cap', text: v.caption, at: 0.45 });
  if (v.type === 'title') out.push({ k: 'title', text: v.text, at: 0.3 }), v.sub && out.push({ k: 'tsub', text: v.sub, at: 1.9 });
  if (v.type === 'formula') { out.push({ k: 'f', text: v.tex, at: 0.35 }); (v.notes || []).forEach((n, i) => out.push({ k: 'n' + i, text: n, at: 1.6 + i * .45 })); }
  if (v.type === 'readout') { (v.rows || []).forEach((r, i) => out.push({ k: 'r' + i, text: r.join('  '), at: 0.4 + i * .5 })); if (v.big) out.push({ k: 'big', text: bigStr(v.big, 1), at: 0.45 + 1.6 }), v.big.label && out.push({ k: 'bigl', text: v.big.label, at: .6 }); }
  if (v.type === 'bars' && v.counter) out.push({ k: 'cnt', text: v.counter, at: 0.6 });
  if (v.type === 'graph' && v.fns) out.push({ k: 'leg', text: v.fns.map(f => f.label || '').join('  '), at: 0.4 });
  if (v.type === 'xy' && v.readout) out.push({ k: 'xyr', text: v.readout, at: 2.4 });
  if (v.type === 'signal') (v.traces || []).concat(v.sum ? [v.sum] : []).forEach((tr, i) => tr.label && out.push({ k: 'lab' + i, text: tr.label, at: .4 + i * .35 }));
  return out;
}
{
  let t = LEAD;
  for (const S of SCENES) {
    const d = DURS[S.id] ?? Math.max(1.5, S.say.split(/\s+/).length / 2.6);   // fallback before the voice exists
    S.d = d; S.t0 = t; S.ta = S.idx ? t - ENTER : t; S.vt = t + VPRE;   // ta: visuals start drawing while the camera is still arriving
    const need = Math.max(VPRE + d + VPOST, 2.6, ...readTexts(S).map(r => r.at + readNeed(r.text) + MOVE + .25)) + (S.hold || 0);
    S.len = need; t += need; S.t1 = t; S.Y = -S.idx * PANEL;
  }
  var END = t + (SC.outro ?? 1.2);
}
const POWEROFF = [END, END + 0.8], DUR = +(END + 1.1).toFixed(3);

// ───────── camera: eased moves between panels, never a cut ─────────
const camKeys = [[0, 0]]; for (const S of SCENES) { if (S.idx === 0) continue; camKeys.push([S.t0 - MOVE, -(S.idx - 1) * PANEL], [S.t0 + .15, S.Y]); }
function camY(t) {
  let y = camKeys[0][1];
  for (let i = 1; i < camKeys.length; i += 2) { const [a, ya] = camKeys[i], [b, yb] = camKeys[i + 1]; if (t >= a) y = lerp(ya, yb, eio(seg(t, a, b))); }
  return y;
}
// a slow breathing zoom, and a pull-back at the very end
const cam = t => { const z = 1 + .03 * Math.sin(t * .35) - .12 * ss(seg(t, END - 1.0, END)); return [0, camY(t), z]; };
let CAM = [0, 0, 1];
const w2s = (x, y) => [W / 2 + (x - CAM[0]) * CAM[2], SCY - (y - CAM[1]) * CAM[2]];

// ───────── drawing + QA registry ─────────
function seg2(g, x0, y0, x1, y1, col, a, lw) { g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function poly(g, pts, col, a, lw, dash) {
  if (pts.length < 2) return; g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.lineCap = 'round';
  g.beginPath(); g.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) g.lineTo(...pts[i]); g.stroke(); g.setLineDash([]);
}
function dot(g, x, y, r, col, a) { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
let REG = [], ROLE = 'world', GROUP = null;
const setRole = r => { ROLE = r; const glass = r === 'hud' || r === 'sub'; G = glass ? GH : GW; U = glass ? UH : UW; };
const inBand = () => ROLE === 'world' || ROLE === 'title' || ROLE === 'fx';
const reg = o => {
  if (inBand() && o.kind !== 'line') { o.y0 = Math.max(o.y0, BAND[0] - FEATHER / 2); o.y1 = Math.min(o.y1, BAND[1] + FEATHER / 2); if (o.y1 - o.y0 < 4) return; }
  REG.push({ role: ROLE, group: GROUP, ...o });
};
const font = (size, o = {}) => `${o.it ? 'italic ' : ''}${o.wt || 400} ${size}px '${o.f || MONO}'`;
function text(g, s, x, y, size, col, a, o = {}) {
  g.globalAlpha = clamp(a); g.fillStyle = col; g.font = font(size, o);
  g.textAlign = o.al || 'left'; g.textBaseline = 'alphabetic'; g.fillText(s, x, y);
  if (o.noreg || (g === G && col === C.hot)) return;
  if (a > .3 && s.trim()) { const m = g.measureText(s); reg({ kind: 'text', text: s, x0: x - m.actualBoundingBoxLeft, x1: x + m.actualBoundingBoxRight, y0: y - m.actualBoundingBoxAscent, y1: y + m.actualBoundingBoxDescent }); }
}
const measure = (s, size, o = {}) => { U.font = font(size, o); return U.measureText(s).width; };
const fit = (s, size, maxw, o) => { const w = measure(s, size, o); return w > maxw ? size * maxw / w : size; };
function regLine(pts, a, tag) {
  if (a <= .3) return; let run = [];
  const lo = BAND[0] - FEATHER / 2, hi = BAND[1] + FEATHER / 2, flush = () => { if (run.length > 1) reg({ kind: 'line', tag, pts: run }); run = []; };
  pts.forEach((p, i) => { if (p[1] < lo || p[1] > hi) { flush(); return; } if (i % 2 === 0 || i === pts.length - 1) run.push([Math.round(p[0]), Math.round(p[1])]); });
  flush();
}
// a beam stroke with slope-dependent brightness (fast beam = dimmer), registered for QA
function beam(pts, a, tag, o = {}) {
  G.lineCap = 'round';
  if (o.dash) { poly(G, pts, o.col || C.beam, a, o.lw || 2.4, o.dash); regLine(pts, a, tag); return; }   // dashes need one continuous path
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (x0 == null || x1 == null) continue;
    const slope = Math.abs(y1 - y0) / Math.max(.5, Math.abs(x1 - x0)), fast = o.flat ? 1 : Math.max(.56, 1 / (1 + .12 * slope));
    const age = o.age ? o.age(i / pts.length) : 1;
    seg2(G, x0, y0, x1, y1, o.col || C.beam, a * fast * age, o.lw || 2.4);
  }
  regLine(pts.filter(p => p[0] != null), a, tag);
}

// ───────── maths for the primitives ─────────
const MATH = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, tanh: Math.tanh, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round, PI: Math.PI, E: Math.E,
  sigmoid: z => 1 / (1 + Math.exp(-z)), relu: z => Math.max(0, z), step: z => z >= 0 ? 1 : 0, gauss: (z, m = 0, s = 1) => Math.exp(-((z - m) ** 2) / (2 * s * s)) };
// expressions are maths only: numbers, operators, x and the names above (checked before compiling, so a scenes.json can't run code)
const compile = expr => {
  expr = String(expr);
  if (!/^[\w\s.+\-*/%^(),<>=?:!&|]*$/.test(expr)) throw new Error(`expression "${expr}": only maths characters are allowed`);
  for (const id of expr.match(/[A-Za-z_]\w*/g) || []) if (id !== 'x' && !(id in MATH)) throw new Error(`expression "${expr}": unknown name "${id}" (allowed: x, ${Object.keys(MATH).join(', ')})`);
  expr = expr.replace(/\^/g, '**');
  const f = new Function(...Object.keys(MATH), 'x', `return (${expr});`); return x => f(...Object.values(MATH), x); };
const vn = (s, seed) => { const i = Math.floor(s), f = s - i, h = k => { const v = Math.sin((k + seed * 97.13) * 127.1) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; }; return lerp(h(i), h(i + 1), f * f * (3 - 2 * f)); };
function wave(tr, s) {
  const f = tr.freq ?? 1, a = tr.amp ?? 1, p = (tr.phase ?? 0) + 2 * Math.PI * f * s, o = tr.offset ?? 0;
  switch (tr.wave || 'sine') {
    case 'square': return o + a * Math.tanh(5 * Math.sin(p));
    case 'saw': { const u = (p / (2 * Math.PI)) % 1; return o + a * (2 * (u < .9 ? u / .9 : (1 - u) / .1) - 1); }
    case 'pulse': { const u = ((p / (2 * Math.PI)) % 1 + 1) % 1, d = tr.duty ?? .2; return o + a * (2 * ss(seg(u, 0, .04)) * (1 - ss(seg(u, d, d + .04))) - 1); }
    case 'noise': return o + a * (.7 * vn(s * f * 4, 1) + .3 * vn(s * f * 11, 2));
    case 'dc': return o + a;
    case 'expr': return o + a * compile(tr.expr)(s);
    default: return o + a * Math.sin(p);
  }
}

// ───────── formula layout: "y = σ(W_1 x + b)", "e^{-z}", words ≥3 letters upright ─────────
function parseTex(src) {
  const out = [], words = (w, sub) => { if (/^[A-Za-z]{3,}$/.test(w)) out.push({ s: w, it: 0, sub }); else for (const ch of w) out.push({ s: ch, it: /[A-Za-zα-ωθλμσφψ]/.test(ch) ? 1 : 0, sub }); };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '_' || c === '^') { const sub = c === '_' ? 1 : 2; i++; let g; if (src[i] === '{') { const j = src.indexOf('}', i); g = src.slice(i + 1, j); i = j + 1; } else g = src[i++]; for (const m of g.match(/[A-Za-z]+|[^A-Za-z]/g) || []) words(m, sub); continue; }
    const m = /^[A-Za-z]+/.exec(src.slice(i)); if (m) { words(m[0], 0); i += m[0].length; continue; }
    if (c === '*') { out.push({ s: '·', it: 0, sub: 0 }); i++; continue; }
    out.push({ s: c, it: /[α-ωθλμσφψ]/.test(c) ? 1 : 0, sub: 0 }); i++;
  }
  return out;
}
function layoutTex(toks, size) {
  let x = 0; const gl = toks.map(t => { const sz = t.sub ? size * .6 : size, w = measure(t.s, sz, { f: SERIF, it: t.it }); const o = { ...t, sz, x, dy: t.sub === 1 ? size * .22 : t.sub === 2 ? -size * .42 : 0 }; x += w + (t.it && !t.sub ? size * .03 : 0); return o; });
  return { gl, w: x };
}
const texPlain = s => parseTex(s).map(t => t.s).join('');
function wrapWords(s, size, maxw, o) { const words = s.split(' '), out = []; let cur = ''; for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (measure(tst, size, o) > maxw && cur) { out.push(cur); cur = w; } else cur = tst; } out.push(cur); return out; }

// per-scene layout, computed once after fonts load
function prepare(S) {
  const v = S.v;
  if (v.caption) S.capSize = fit(v.caption, 28, 900);
  if (v.type === 'title') {
    let size = v.size || 92, lines; for (; ; size -= 4) { lines = wrapWords(v.text, size, 900, { f: SERIF }); if (lines.length <= 3 || size < 56) break; }
    S.tl = []; lines.forEach((ln, li) => { let x = 0; const gs = []; for (const ch of ln) { const w = measure(ch, size, { f: SERIF, it: v.italic }); gs.push({ ch, x, w, li }); x += w; } gs.forEach(g => { g.x -= x / 2; if (g.ch !== ' ') S.tl.push(g); }); });
    S.tsize = size; S.tlines = lines.length;
  }
  if (v.type === 'formula') { const toks = parseTex(v.tex); let size = v.size || 84; let L = layoutTex(toks, size); if (L.w > 920) { size *= 920 / L.w; L = layoutTex(toks, size); } S.F = L; S.fsize = size; if (v.pin) { let hs = 44, HL = layoutTex(toks, hs); if (HL.w > 680) { hs *= 680 / HL.w; HL = layoutTex(toks, hs); } S.HF = HL; } }
  if (v.type === 'graph') { S.fns = (v.fns || [{ expr: v.fn, label: v.label }]).map(f => ({ ...f, f: compile(f.expr) })); }
  if (v.type === 'bars') { const n = Math.min(96, v.values ? v.values.length : v.count || 32); S.vals = v.values || Array.from({ length: n }, (_, i) => .45 + .5 * Math.abs(vn(i * .7, 3))); }
}

// ───────── primitives (local coords: x right, y up, origin = panel centre; content in x ±460, y −440…+400; caption at +470) ─────────
const P = {};
P.title = (S, t, L) => {
  const v = S.v, u0 = S.ta + .3, per = 1.5 / S.tl.length;
  const [cx, cy] = L(0, 40 + (S.tlines - 1) * S.tsize * .55);
  setRole('title'); GROUP = 'title' + S.idx;
  S.tl.forEach((g, i) => {
    const st = u0 + i * per, u = seg(t, st, st + per * 3.2); if (u <= 0) return;
    const x = cx + g.x, y = cy + g.li * S.tsize * 1.12;
    G.font = font(S.tsize, { f: SERIF, it: v.italic }); G.textAlign = 'left'; G.lineWidth = 1.6; G.strokeStyle = C.beam;
    G.globalAlpha = 1 - seg(u, .7, 1) * .7; G.setLineDash([S.tsize * 7 * Math.min(1, u / .6), 1e4]); G.strokeText(g.ch, x, y); G.setLineDash([]);
    if (u > .55) text(U, g.ch, x, y, S.tsize, C.ui, seg(u, .55, .85), { f: SERIF, it: v.italic });
    const fl = Math.exp(-Math.max(0, t - (st + per * 3.2 * .8)) / .15) * (u > .8); if (fl > .01) text(G, g.ch, x, y, S.tsize, C.hot, fl * .8, { f: SERIF, it: v.italic });
  });
  GROUP = null; setRole('world');
  if (v.sub) { const [sx, sy] = L(0, -140 - (S.tlines - 1) * S.tsize * .55); text(U, v.sub, sx, sy, fit(v.sub, 30, 880), C.ui, seg(t, S.ta + 1.9, S.ta + 2.3) * .85, { al: 'center' }); }
  // a sweeping underline written by the beam
  const uu = eo(seg(t, S.ta + 1.4, S.ta + 2.2)); if (uu > 0) { const [ax, ay] = L(-380, -70 - (S.tlines - 1) * S.tsize * .55), [bx] = L(-380 + 760 * uu, 0); beam([[ax, ay], [bx, ay]], .7, 'underline', { flat: 1 }); }
};
P.formula = (S, t, L) => {
  const v = S.v, a0 = S.ta + .35, n = S.F.gl.length, typ = Math.min(1.6, n * .09), lit = (t - a0) / typ * n;
  const [ox, oy] = L(-S.F.w / 2, 60);
  GROUP = 'formula' + S.idx;
  S.F.gl.forEach((g, i) => { if (i >= lit) return; const age = t - (a0 + i * typ / n), fl = Math.exp(-age / .12) * (age >= 0);
    text(U, g.s, ox + g.x, oy + g.dy, g.sz, C.ui, .95, { f: SERIF, it: g.it }); if (fl > .01) text(G, g.s, ox + g.x, oy + g.dy, g.sz, C.hot, fl * .9, { f: SERIF, it: g.it }); });
  GROUP = null;
  // bracket cursors under the formula once typed
  const bu = eo(seg(t, a0 + typ, a0 + typ + .5)); if (bu > 0) { const [lx, ly] = L(-S.F.w / 2, 60 - S.fsize * .55), [rx] = L(-S.F.w / 2 + S.F.w * bu, 0); poly(G, [[lx, ly], [rx, ly]], C.amb, .8 * bu, 1.6, [8, 7]); }
  (v.notes || []).forEach((nt, i) => { const [x, y] = L(0, -60 - i * 54); text(U, nt, x, y, fit(nt, 28, 900), C.ui, seg(t, S.ta + 1.6 + i * .45, S.ta + 1.9 + i * .45) * .9, { al: 'center' }); });
};
P.signal = (S, t, L) => {
  const v = S.v, trs = (v.traces || []).slice(0, 4), all = trs.concat(v.sum ? [{ ...v.sum, _sum: 1 }] : []), n = all.length;
  const sp = Math.min(300, 820 / n), A = sp * .3, TX0 = -400, TX1 = 420, TPS = v.tps || 200, sNow = t - S.t0, totA = trs.reduce((a, r) => a + Math.abs(r.amp ?? 1) + Math.abs(r.offset ?? 0), 0) || 1;
  all.forEach((tr, k) => {
    const on = S.ta + .4 + k * .35; if (t < on) return; const a = seg(t, on, on + .25), base = 380 - sp * (k + .5) - 20;
    const fn = tr._sum ? s => trs.reduce((acc, r) => acc + wave(r, s), 0) / totA : s => wave(tr, s);
    const [lx0, ly] = L(TX0, base), [lx1] = L(TX1, base); poly(U, [[lx0, ly], [lx1, ly]], C.ui, .22 * a, 1, [3, 6]);
    const sOn = on - S.t0, pts = []; for (let X = TX0; X <= TX1 + .01; X += 4) { const s = sNow - (TX1 - X) / TPS; if (s < sOn) continue; pts.push(L(X, base + A * clamp(fn(s), -1.15, 1.15))); }
    beam(pts, a, 'trace', { age: u => 1 - .55 * Math.pow(1 - u, 1.4), lw: tr._sum ? 3 : 2.4 });
    if (pts.length) { const h = pts[pts.length - 1]; dot(G, h[0], h[1], 3.4, C.hot, a); }
    if (tr.label) { const [tx, ty] = L(TX0, base + A * 1.15 + 26); text(U, tr.label, tx, ty, fit(tr.label, 24, 820), tr._sum ? C.hot : C.ui, a * .95, { noreg: 0 }); }
  });
};
P.graph = (S, t, L) => {
  const v = S.v, [xa, xb] = v.x || [-4, 4], [ya, yb] = v.y || [0, 1], X0 = -390, X1 = 400, Y0 = -330, Y1 = 330;
  const mx = x => lerp(X0, X1, (x - xa) / (xb - xa)), my = y => lerp(Y0, Y1, (y - ya) / (yb - ya));
  const a = seg(t, S.ta + .3, S.ta + .6);
  const [ax0, ay0] = L(X0, Y0), [ax1] = L(X1, Y0), [, ay1] = L(X0, Y1);
  seg2(U, ax0, ay0, ax1, ay0, C.ui, .65 * a, 1.4); seg2(U, ax0, ay0, ax0, ay1, C.ui, .65 * a, 1.4);
  const nice = r => { const raw = r / 5, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
  const sx = nice(xb - xa), sy = nice(yb - ya), lab = x => (Math.abs(x) < 1e-9 ? '0' : Number.isInteger(+x.toFixed(6)) ? (x < 0 ? '−' + (-x) : '' + x) : fmt(x, 1));
  for (let x = Math.ceil(xa / sx) * sx; x <= xb + 1e-9; x += sx) { const [px] = L(mx(x), 0); seg2(U, px, ay0, px, ay0 + 8, C.ui, .6 * a, 1.2); text(U, lab(x), px, ay0 + 36, 22, C.ui, .6 * a, { al: 'center' }); }
  for (let y = Math.ceil(ya / sy) * sy; y <= yb + 1e-9; y += sy) { const [, py] = L(0, my(y)); seg2(U, ax0 - 8, py, ax0, py, C.ui, .6 * a, 1.2); text(U, lab(y), ax0 - 14, py + 8, 22, C.ui, .6 * a, { al: 'right' }); if (y > ya) poly(U, [[ax0, py], [ax1, py]], C.ui, .12 * a, 1, [3, 6]); }
  if (v.xlabel) text(U, v.xlabel, ax1, ay0 + 70, fit(v.xlabel, 24, 600), C.ui, .85 * a, { al: 'right' });
  if (v.ylabel) text(U, v.ylabel, ax0 - 14, ay1 - 26, fit(v.ylabel, 24, 600), C.ui, .85 * a, { al: 'left' });
  const DASH = [null, [14, 9], [3, 7]];
  S.fns.forEach((f, k) => {
    const d0 = S.ta + .6 + k * 1.2, u = seg(t, d0, d0 + 1.3); if (u <= 0) return;
    const xm = lerp(xa, xb, u), pts = []; let last = null;
    for (let i = 0; i <= 240; i++) { const x = lerp(xa, xb, i / 240); if (x > xm) break; const y = f.f(x); if (!isFinite(y) || y < ya - 1e-9 || y > yb + 1e-9) { pts.push([null, null]); continue; } last = L(mx(x), my(y)); pts.push(last); }
    // split at gaps so out-of-range parts are not joined
    let run = []; const flush = () => { if (run.length > 1) beam(run, .95, 'curve', { dash: DASH[k % 3] || undefined, lw: 2.6 }); run = []; };
    for (const p of pts) { if (p[0] == null) flush(); else run.push(p); } flush();
    if (u < 1 && last) dot(G, last[0], last[1], 3.6, C.hot, 1);
  });
  if (v.fns && v.fns.length > 1) {   // legend above the plot
    // right-aligned, so it never meets the y-axis label on the left
    const ws = v.fns.map(f => 56 + measure(f.label || '', 24)); let x = 420 - ws.reduce((a, b) => a + b, 0) - 50 * (ws.length - 1);
    v.fns.forEach((f, k) => { const [lx, ly] = L(x, 400); const la = seg(t, S.ta + .4, S.ta + .7); poly(U, [[lx, ly - 8], [lx + 44, ly - 8]], C.beam, .9 * la, 2.6, DASH[k % 3] || []); text(U, f.label || '', lx + 56, ly, 24, C.ui, la * .95); x += ws[k] + 50; });
  }
  if (v.point) {   // a measured point rides the first curve
    const pu = seg(t, S.ta + 2.0, S.t1 - .3); if (pu > 0 && pu < 1) { const x = lerp(xa, xb, .1 + .8 * ss(pu)), y = S.fns[0].f(x); if (isFinite(y) && y >= ya && y <= yb) { const [px, py] = L(mx(x), my(y)); poly(G, [[px, py], [px, ay0]], C.amb, .6, 1.2, [4, 5]); poly(G, [[px, py], [ax0, py]], C.amb, .6, 1.2, [4, 5]); dot(G, px, py, 5, C.hot, 1); } }
  }
};
P.xy = (S, t, L) => {
  const v = S.v, fa = v.fx ?? 3, fb = v.fy ?? 2, ph = v.phase ?? Math.PI / 2, R = v.r || 340, d0 = S.ta + .4, span = 2 * Math.PI;
  const a = seg(t, S.ta + .3, S.ta + .6), [cx, cy] = L(0, 20);
  const [hx0] = L(-R - 40, 0), [hx1] = L(R + 40, 0), [, vy0] = L(0, 20 - R - 40), [, vy1] = L(0, 20 + R + 40);
  seg2(U, hx0, cy, hx1, cy, C.ui, .3 * a, 1); seg2(U, cx, vy0, cx, vy1, C.ui, .3 * a, 1);
  const u = seg(t, d0, d0 + 2.2), tau = u * span + Math.max(0, t - d0 - 2.2) * .9, pts = [];
  for (let q = Math.max(0, tau - span); q <= tau; q += .01) pts.push(L(R * Math.sin(fa * q + ph), 20 + R * Math.sin(fb * q)));
  if (pts.length > 1) { beam(pts, .95, 'xy', { age: k => .35 + .65 * k, lw: 2.6 }); const h = pts[pts.length - 1]; dot(G, h[0], h[1], 4, C.hot, 1); }
  if (v.readout) { const [rx, ry] = L(0, -R - 110); text(U, v.readout, rx, ry, fit(v.readout, 28, 880), C.ui, seg(t, S.ta + 2.4, S.ta + 2.8) * .9, { al: 'center' }); }
};
P.bars = (S, t, L) => {
  const v = S.v, n = S.vals.length, X0 = -420, X1 = 420, Y0 = -290, Hm = 600, gap = (X1 - X0) / n, lw = Math.max(2, Math.min(14, gap * .55)), mode = v.mode || 'parallel';
  const [ax0, ay] = L(X0 - 10, Y0), [ax1] = L(X1 + 10, Y0); seg2(U, ax0, ay, ax1, ay, C.ui, .5 * seg(t, S.ta + .3, S.ta + .6), 1.2);
  const r0 = S.ta + .6, r1 = S.t1 - MOVE - .3;
  S.vals.forEach((val, i) => {
    let h;
    if (mode === 'serial') { const ti = lerp(r0, r1, i / n), tj = lerp(r0, r1, (i + 1) / n); h = eo(seg(t, ti, tj)); }
    else h = eo(seg(t, r0 + i * .004, r0 + .7 + i * .004)) * (1 + .06 * Math.sin(t * 9 + i * 1.7) * seg(t, r0 + .8, r0 + 1.2));
    if (h <= .01) return; const x = X0 + gap * (i + .5), [bx, by0] = L(x, Y0 + 2), [, by1] = L(x, Y0 + 2 + Hm * val * h);
    G.lineCap = 'butt'; seg2(G, bx, by0, bx, by1, C.beam, .85, lw); dot(G, bx, by1, lw * .35 + 1.5, C.hot, .9);
    if (mode === 'serial' && h < 1) dot(G, bx, by1, lw * .6 + 4, C.hot, .5);
  });
  if (v.counter) { const [x, y] = L(0, Y0 - 70); text(U, v.counter, x, y, fit(v.counter, 30, 880), C.ui, seg(t, S.ta + .6, S.ta + 1) * .95, { al: 'center' }); }
};
P.readout = (S, t, L) => {
  const v = S.v, rows = v.rows || [], size = 34;
  const y0 = v.big ? -160 : 120 + (rows.length - 1) * 40;
  rows.forEach((r, i) => {
    const st = S.ta + .4 + i * .5, a = seg(t, st, st + .25); if (a <= 0) return;
    const [k, val] = r, kx = -420, vx = 420, [lx, ly] = L(kx, y0 - i * 80), [rx] = L(vx, 0);
    const n = Math.floor(seg(t, st, st + .4) * (val || '').length);
    text(U, k, lx, ly, size, C.ui, a * .9); text(G, (val || '').slice(0, n), rx, ly, size, C.beam, a, { al: 'right', noreg: n < (val || '').length });
    if (n >= (val || '').length) { const m = measure(val, size), [, yy] = L(0, y0 - i * 80 - 22); poly(U, [[lx + measure(k, size) + 18, yy + 0], [rx - m - 18, yy]], C.ui, .25 * a, 1, [2, 8]); }
  });
  if (v.big) {
    const b = v.big, st = S.ta + .45, u = eio(seg(t, st, st + 1.6)), s = bigStr(b, u), size = fit(bigStr(b, 1), 120, 900, { f: SERIF });
    const [x, y] = L(0, 220); if (t >= st) text(U, s, x, y, size, C.ui, seg(t, st, st + .2), { al: 'center', f: SERIF, noreg: u < 1 });
    if (u < 1 && t >= st) { const m = measure(s, size, { f: SERIF }); text(G, s, x, y, size, C.hot, .35, { al: 'center', f: SERIF, noreg: 1 }); }
    if (b.label) { const [lx, ly] = L(0, 90); text(U, b.label, lx, ly, fit(b.label, 30, 880), C.ui, seg(t, S.ta + .6, S.ta + 1) * .85, { al: 'center' }); }
  }
};

// ───────── subtitles ─────────
const CUES = SCENES.map((S, k) => { const next = SCENES[k + 1] ? SCENES[k + 1].vt : DUR; return { id: S.id, t0: +S.vt.toFixed(3), t1: +Math.min(next - .12, Math.max(S.vt + S.d + .6, S.vt + 1.8)).toFixed(3), text: S.sub }; });
let SCRIM = null;
function subtitles(t) {
  const c = CUES.find(c => t >= c.t0 && t < c.t1); if (!c) return;
  const a = Math.min(seg(t, c.t0, c.t0 + .12), 1 - seg(t, c.t1 - .15, c.t1));
  const size = 40, lines = wrapWords(c.text, size, W - 150, { f: SERIF, it: 1 }), lh = 52, yb = H - 200, y0 = yb - (lines.length - 1) * lh;
  SCRIM = { x: 40, y: y0 - 50, w: W - 80, h: (yb - y0) + 80, a };
  seg2(U, 58, y0 - 38, 58, yb + 12, C.ui, a * .9, 2.2);
  lines.forEach((l, i) => text(U, l, 78, y0 + i * lh, size, C.ui, a, { f: SERIF, it: 1 }));
}

// ───────── graticule ─────────
function graticule(t, a) {
  if (a <= 0) return 100;
  const z = CAM[2], sp = 100, dotSp = sp / 5, wx0 = CAM[0] - W / 2 / z, wx1 = CAM[0] + W / 2 / z, wy1 = CAM[1] + SCY / z, wy0 = CAM[1] - (H - SCY) / z;
  U.fillStyle = C.ui; U.globalAlpha = a * .24;
  for (let x = Math.ceil(wx0 / sp) * sp; x <= wx1; x += sp) { const sx = w2s(x, 0)[0]; for (let y = Math.ceil(wy0 / dotSp) * dotSp; y <= wy1; y += dotSp) U.fillRect(sx - .8, w2s(0, y)[1] - .8, 1.6, 1.6); }
  for (let y = Math.ceil(wy0 / sp) * sp; y <= wy1; y += sp) { const sy = w2s(0, y)[1]; for (let x = Math.ceil(wx0 / dotSp) * dotSp; x <= wx1; x += dotSp) U.fillRect(w2s(x, 0)[0] - .8, sy - .8, 1.6, 1.6); }
  return sp;
}

// ───────── HUD ─────────
function hud(t) {
  if (t < 1.2) return;
  const a = seg(t, 1.2, 1.8) * .85, cur = SCENES.filter(S => t >= S.t0 - MOVE).pop();
  text(U, t < LEAD ? 'READY' : 'RUN', W - 56, 66, 24, t < LEAD ? C.amb : C.ui, a, { al: 'right', wt: 600 });
  if (cur) text(U, `CH ${cur.idx + 1}/${SCENES.length}`, W - 56, 100, 21, C.ui, a * .8, { al: 'right' });
  if (SC.title) text(U, SC.title, FX, 66, fit(SC.title, 22, W - 56 - FX - 220), C.ui, a * .7);
  // the latest pinned formula, once its scene is over
  const pin = SCENES.filter(S => S.HF && t >= S.t1 - .3).pop();
  if (pin) { const pa = seg(t, pin.t1 - .3, pin.t1 + .2) * .95; GROUP = 'pin' + pin.idx; pin.HF.gl.forEach(g => text(U, g.s, FX + g.x, FY + g.dy, g.sz, C.ui, pa, { f: SERIF, it: g.it })); GROUP = null; }
}

// ───────── the frame ─────────
function frame(t) {
  CAM = cam(t);
  for (const g of [GW, UW, GH, UH]) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; }
  SCRIM = null; REG = []; GROUP = null;
  setRole('hud');
  if (t < 1.4) { const cx = W / 2, cy = SCY; if (t >= .15) { const hw = W * .46 * eo(seg(t, .45, .9)); seg2(G, cx - hw, cy, cx + hw, cy, C.beam, .9 * (1 - seg(t, .9, 1.4)), 2.2); dot(G, cx, cy, 4 + 3 * Math.exp(-(t - .15) / .2), C.hot, 1 - seg(t, .9, 1.4) * .9); } }
  graticule(t, seg(t, .9, 2.0));
  setRole('world');
  for (const S of SCENES) {
    if (t < S.t0 - MOVE - .2 || t > S.t1 + MOVE + .4) continue;
    const L = (x, y) => w2s(x, S.Y + y);
    if (S.v.caption) { const [x, y] = L(0, 470); text(U, S.v.caption, x, y, S.capSize, C.ui, seg(t, S.ta + .45, S.ta + .8) * .9, { al: 'center' }); }
    (P[S.v.type] || P.readout)(S, t, L);
  }
  setRole('hud'); hud(t);
  setRole('sub'); subtitles(t); setRole('world');
  if (SCRIM) REG.push({ role: 'sub', kind: 'zone', text: 'subtitle', x0: SCRIM.x, x1: SCRIM.x + SCRIM.w, y0: SCRIM.y, y1: SCRIM.y + SCRIM.h });
}

function compose(t) {
  F.setTransform(1, 0, 0, 1, 0, 0); F.globalCompositeOperation = 'source-over'; F.globalAlpha = 1; F.filter = 'none';
  F.fillStyle = C.bg; F.fillRect(0, 0, W, H);
  const amb = F.createRadialGradient(W / 2, H * .5, 0, W / 2, H * .5, H * .65); amb.addColorStop(0, 'rgba(11,36,18,.55)'); amb.addColorStop(1, 'rgba(11,36,18,0)'); F.fillStyle = amb; F.fillRect(0, 0, W, H);
  if (SCRIM) { F.globalAlpha = SCRIM.a * .75; F.filter = 'blur(18px)'; F.fillStyle = '#000'; F.fillRect(SCRIM.x, SCRIM.y, SCRIM.w, SCRIM.h); F.filter = 'none'; F.globalAlpha = 1; }
  F.globalCompositeOperation = 'lighter';
  for (const g of [GW, UW]) {
    g.globalCompositeOperation = 'destination-in'; g.globalAlpha = 1;
    const m = g.createLinearGradient(0, 0, 0, H);
    m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop((BAND[0] - FEATHER) / H, 'rgba(0,0,0,0)'); m.addColorStop(BAND[0] / H, 'rgba(0,0,0,1)');
    m.addColorStop(BAND[1] / H, 'rgba(0,0,0,1)'); m.addColorStop((BAND[1] + FEATHER) / H, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
  }
  F.globalAlpha = .92; F.drawImage(Uc, 0, 0); F.drawImage(UHc, 0, 0); F.globalAlpha = 1; F.drawImage(Gc, 0, 0); F.drawImage(GHc, 0, 0);
  B0.globalCompositeOperation = 'source-over'; B0.globalAlpha = 1; B0.clearRect(0, 0, W / 2, H / 2);
  B0.globalCompositeOperation = 'lighter'; B0.drawImage(Gc, 0, 0, W / 2, H / 2); B0.drawImage(GHc, 0, 0, W / 2, H / 2); B0.globalAlpha = .22; B0.drawImage(Uc, 0, 0, W / 2, H / 2); B0.drawImage(UHc, 0, 0, W / 2, H / 2);
  for (const [c, g, ds, sg, w] of BLOOM) { g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, c.width, c.height); g.filter = `blur(${sg}px)`; g.drawImage(B0c, 0, 0, c.width, c.height); g.filter = 'none'; F.globalAlpha = w * 1.05; F.drawImage(c, 0, 0, W, H); }
  F.globalCompositeOperation = 'source-over'; F.globalAlpha = 1;
  const vg = F.createRadialGradient(W / 2, H / 2, H * .32, W / 2, H / 2, H * .72); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); F.fillStyle = vg; F.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none';
  const [p0, p1] = POWEROFF;
  if (t < p0) { ctx.drawImage(Fc, 0, 0); return; }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const m = p0 + (p1 - p0) * .55, u1 = Math.min(1, (t - p0) / (m - p0)), u2 = clamp((t - m) / (p1 - m));
  const sy = Math.max(2, H * Math.pow(1 - u1, 3)), sx = Math.max(3, W * Math.pow(1 - u2, 3)), fade = t > p1 ? Math.max(0, 1 - (t - p1) / .25) : 1; if (fade <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 1 + Math.round(2.5 * u1); k++) { ctx.globalAlpha = fade * (k ? .6 : 1); ctx.drawImage(Fc, (W - sx) / 2, (H - sy) / 2, sx, sy); }
  ctx.filter = 'blur(10px)'; ctx.globalAlpha = fade * u1; ctx.drawImage(Fc, (W - sx) / 2, (H - sy) / 2, sx, sy); ctx.filter = 'none';
  if (u1 > .9) { ctx.globalAlpha = fade; ctx.fillStyle = C.hot; ctx.fillRect((W - sx) / 2, H / 2 - 1.5, sx, 3); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ───────── sound events for explainer/engine/mix.py ─────────
function events() {
  const ev = [], add = (t, type, o = {}) => ev.push({ t: +t.toFixed(4), type, ...o });
  add(.15, 'relay'); add(.2, 'warm');
  for (const S of SCENES) {
    const v = S.v;
    add(S.t0, 'scene', { i: S.idx, len: +S.len.toFixed(3) });
    if (S.idx) add(S.t0 - MOVE, 'sweep', { d: MOVE + .15 });
    add(S.ta + .3, 'blip', { f: 900 + 120 * (S.idx % 5) });
    if (v.type === 'title') S.tl.forEach((g, i) => add(S.ta + .3 + i * 1.5 / S.tl.length, 'tick', { g: .5 }));
    if (v.type === 'formula') { const n = S.F.gl.length, typ = Math.min(1.6, n * .09); S.F.gl.forEach((g, i) => g.s.trim() && add(S.ta + .35 + i * typ / n, 'tick', { g: .7 })); add(S.ta + .35 + typ + .1, 'bell', { f: 659.25 }); }
    if (v.type === 'signal') (v.traces || []).concat(v.sum ? [v.sum] : []).forEach((_, k) => add(S.ta + .4 + k * .35, 'pluck', { ch: k }));
    if (v.type === 'graph') S.fns.forEach((_, k) => add(S.ta + .6 + k * 1.2, 'buzz', { d: 1.3 }));
    if (v.type === 'xy') { add(S.ta + .4, 'buzz', { d: 2.2 }); add(S.ta + 2.6, 'bell', { f: 880 }); }
    if (v.type === 'bars') { if ((v.mode || 'parallel') === 'serial') { const n = S.vals.length, r0 = S.ta + .6, r1 = S.t1 - MOVE - .3; for (let i = 0; i < n; i++) add(lerp(r0, r1, i / n), 'tick', { g: .6 }); } else add(S.ta + .6, 'sweep', { d: .7, up: 1 }); }
    if (v.type === 'readout') { (v.rows || []).forEach((r, i) => add(S.ta + .4 + i * .5, 'blip', { f: 1300 })); if (v.big) { for (let k = 0; k < 12; k++) add(S.ta + .45 + k * 1.6 / 12, 'tick', { g: .5 }); add(S.ta + 2.05, 'bell', { f: 1318.5, big: 1 }); } }
    add(S.vt, 'voice', { id: S.id });
  }
  add(END - .9, 'bell', { f: 880, big: 1 });
  add(POWEROFF[0], 'zap');
  return ev.sort((a, b) => a.t - b.t);
}

// ───────── texts for core/render/readcheck.mjs: full text from the first visible frame, only while fully inside the band ─────────
window.TEXTS = t => {
  const out = []; CAM = cam(t);
  for (const S of SCENES) {
    if (t < S.t0 - MOVE || t > S.t1 + MOVE) continue;
    for (const r of readTexts(S)) {
      if (t < S.ta + r.at) continue;
      const [, y] = w2s(0, S.Y + ({ cap: 470, title: 40, f: 60 }[r.k] ?? 0));
      if (y < BAND[0] + 40 || y > BAND[1] - 40) continue;
      out.push({ id: `${S.id}-${r.k}`, text: r.k === 'f' ? texPlain(r.text) : r.text, x0: 60, y0: y - 40, x1: W - 60, y1: y + 10 });
    }
  }
  return out;
};

await document.fonts.load(`400 50px '${SERIF}'`); await document.fonts.load(`italic 400 50px '${SERIF}'`); await document.fonts.load(`400 24px '${MONO}'`);
await document.fonts.load(`italic 400 50px '${SERIF}'`, 'σΣθλ'); await document.fonts.load(`400 24px '${MONO}'`, 'Σσθλ');
SCENES.forEach(prepare);
window.DUR = DUR;
window.EV = events();
window.CUES = CUES;
window.SCENES = SCENES.map(S => ({ id: S.id, type: S.v.type, t0: S.t0, t1: S.t1, vt: S.vt, d: S.d }));
window.render = t => { frame(t); compose(t); };
window.QA = t => { frame(t); return { reg: REG, cam: cam(t), W, H, beats: { poweroff: POWEROFF, stop: null }, cues: CUES }; };
window.READY = true;
