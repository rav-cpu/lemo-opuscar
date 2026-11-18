// explainer/qa/verify.mjs — the mandatory quality gate for every explainer film. Run from the library root:
//   node explainer/qa/verify.mjs films/<slug> [--video films/<slug>/<slug>.mp4] [--step 0.125]
// Exits 1 if any ERROR is found. Writes qa/report.md, qa/report.json and qa/contact.jpg.
//
// What it checks
//  LAYOUT (every --step seconds, from the page's own registry of drawn text boxes and lines)
//   1 text-on-text overlap                  2 labels crossed by a trace / curve
//   3 world objects running into the HUD    4 anything under the subtitles
//   5 text outside the safe area (32 px)    6 knob vs labels/traces
//  MOTION / TRANSITIONS
//   7 camera jerk (speed jumps not eased)   8 luminance pops between consecutive video frames
//   9 black / blank frames outside the intended power-off ending
//  AUDIO / TIMING
//  10 voice lines overlapping each other   11 narration during a designed silence (beats.stop, if the film has one)
//  12 subtitle timing (≥ 1.8 s, ≥ line + 0.6 s, no overlap)   13 loudness −14 ±1 LUFS, true peak ≤ −1 dBTP
//  14 video length = timeline length       15 reading time of on-screen text (core readcheck)
//  16 empty scene (a scene that draws nothing)   17 voice provider + pronunciation record (fallback voice = WARN)
import fs from 'fs'; import path from 'path'; import { execFileSync, spawnSync } from 'child_process';
import { openDemo, closeServer } from '../../core/render/page.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(args[0]), STEP = +opt('--step', 0.125), VIDEO = opt('--video', path.join(dir, path.basename(dir) + '.mp4'));
const W = 1080, H = 1920, SAFE = 32, PERSIST = 0.25;   // an overlap must last ≥ PERSIST s to count (a label sweeping past is fine)
fs.mkdirSync(path.join(dir, 'qa'), { recursive: true });
const issues = [];   // {sev, check, t0, t1, what}
const add = (sev, check, t0, t1, what) => issues.push({ sev, check, t0: +t0.toFixed(2), t1: +t1.toFixed(2), what });

// ── geometry ──
const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const area = a => Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
const shrink = (b, p) => ({ ...b, x0: b.x0 + p, x1: b.x1 - p, y0: b.y0 + p, y1: b.y1 - p });
function segHitsBox(p, q, b) {
  const inside = ([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  if (inside(p) || inside(q)) return true;
  const cross = (a, b2, c, d) => { const o = (p1, p2, p3) => Math.sign((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0])); return o(a, b2, c) !== o(a, b2, d) && o(c, d, a) !== o(c, d, b2); };
  const c = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  for (let i = 0; i < 4; i++) if (cross(p, q, c[i], c[(i + 1) % 4])) return true;
  return false;
}
const lineHits = (pts, b) => { for (let i = 1; i < pts.length; i++) if (segHitsBox(pts[i - 1], pts[i], b)) return true; return false; };
const onScreen = b => b.x1 > 0 && b.x0 < W && b.y1 > 0 && b.y0 < H;
const label = b => b.text ? `"${b.text.slice(0, 32)}"` : b.tag || b.kind;

// collapse per-sample findings into time ranges
const open = new Map();
function seen(key, t, sev, check, what) { const o = open.get(key); if (o && t - o.t1 <= STEP * 1.5) o.t1 = t; else { if (o) close(key); open.set(key, { t0: t, t1: t, sev, check, what }); } }
function close(key) { const o = open.get(key); open.delete(key); if (o.t1 - o.t0 + STEP >= PERSIST) add(o.sev, o.check, o.t0, o.t1 + STEP, o.what); }

// ── 1–7: layout and camera, from the page ──
const { browser, page } = await openDemo(dir, { w: W, h: H });
const DUR = await page.evaluate(() => window.DUR);
let prevV = null, prevCam = null;
for (let t = 0; t < DUR; t += STEP) {
  const q = await page.evaluate(tt => window.QA(tt), t);
  if (t >= q.beats.poweroff[0]) break;
  // merge glyph groups (formula, title) into one box each
  const groups = {}, items = [];
  for (const r of q.reg) {
    if (r.kind === 'line') { items.push(r); continue; }
    if (r.group) { const g = groups[r.group] ??= { ...r, text: r.group }; g.x0 = Math.min(g.x0, r.x0); g.x1 = Math.max(g.x1, r.x1); g.y0 = Math.min(g.y0, r.y0); g.y1 = Math.max(g.y1, r.y1); }
    else items.push(r);
  }
  items.push(...Object.values(groups));
  const texts = items.filter(r => r.kind === 'text' && onScreen(r) && r.role !== 'fx') /* fx = the deliberate text-into-geometry morph */, lines = items.filter(r => r.kind === 'line'), boxes = items.filter(r => r.kind === 'box');
  const hud = items.filter(r => r.role === 'hud' && r.kind !== 'line'), zone = items.find(r => r.kind === 'zone');
  // 1 text on text
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]; if (a.role === 'sub' && b.role === 'sub') continue;
    const ov = inter(a, b) / Math.min(area(a), area(b));
    if (ov > 0.08) seen(`tt|${a.text}|${b.text}`, t, 'ERROR', 'text-overlap', `${label(a)} overlaps ${label(b)} (${Math.round(ov * 100)}%)`);
  }
  // 2 + 6 labels/knobs crossed by traces or curves
  for (const L of lines) for (const b of [...texts.filter(x => x.role !== 'sub' && x.role !== 'title'), ...boxes]) {
    if (lineHits(L.pts, shrink(b, 2))) seen(`tl|${L.tag}|${b.text}`, t, 'ERROR', 'label-crossed', `${L.tag} runs through ${label(b)}`);
  }
  for (const k of boxes) for (const b of texts) if (inter(k, b) > 4) seen(`kb|${k.text}|${b.text}`, t, 'ERROR', 'knob-overlap', `${k.text} overlaps ${label(b)}`);
  // 3 world into HUD
  for (const h of hud) {
    const hb = { ...h, x0: h.x0 - 6, x1: h.x1 + 6, y0: h.y0 - 6, y1: h.y1 + 6 };
    for (const b of texts.filter(x => x.role === 'world' || x.role === 'title')) if (inter(hb, b) > 0) seen(`hw|${h.text}|${b.text}`, t, 'ERROR', 'hud-collision', `${label(b)} runs into HUD ${label(h)}`);
    for (const L of lines) if (lineHits(L.pts, hb)) seen(`hl|${h.text}|${L.tag}`, t, 'ERROR', 'hud-collision', `${L.tag} runs through HUD ${label(h)}`);
  }
  // 4 subtitle zone
  if (zone) {
    for (const b of texts.filter(x => x.role !== 'sub')) if (inter(zone, b) > 0) seen(`sz|${b.text}`, t, 'ERROR', 'subtitle-zone', `${label(b)} is under the subtitles`);
    for (const L of lines) if (lineHits(L.pts, zone)) seen(`sl|${L.tag}`, t, 'ERROR', 'subtitle-zone', `${L.tag} runs under the subtitles`);
  }
  // 5 safe area (only text the viewer must read: fully opaque, not sweeping past)
  for (const b of texts) if (b.x0 < SAFE || b.x1 > W - SAFE || b.y0 < SAFE || b.y1 > H - SAFE) seen(`sa|${b.text}`, t, 'WARN', 'safe-area', `${label(b)} outside the ${SAFE}px safe area`);
  // 7 camera jerk: screen-space speed of the world, change per step
  const [cx, cy, z] = q.cam;
  if (prevCam) {
    const v = [(cx - prevCam[0]) * z / STEP, (cy - prevCam[1]) * z / STEP, Math.log(z / prevCam[2]) / STEP * 600];
    if (prevV) { const dv = Math.hypot(v[0] - prevV[0], v[1] - prevV[1], v[2] - prevV[2]); if (dv > 2600) seen(`cj`, t, 'ERROR', 'camera-jerk', `camera speed jumps by ${Math.round(dv)} px/s in ${STEP}s (an un-eased cut)`); }
    prevV = v;
  }
  prevCam = [cx, cy, z];
}
// 16 empty scenes: at the middle of every scene something of it must be drawn
for (const S of (await page.evaluate(() => window.SCENES || []))) {
  const q = await page.evaluate(tt => window.QA(tt), (S.t0 + S.t1) / 2);
  if (!q.reg.some(r => r.role === 'world' || r.role === 'title')) add('ERROR', 'empty-scene', S.t0, S.t1, `scene ${S.id} (${S.type}) draws nothing at its midpoint`);
}
for (const k of [...open.keys()]) close(k);
const meta = await page.evaluate(() => ({ cues: window.CUES, TF: window.TF, beats: window.QA(0).beats, ev: window.EV }));
await browser.close(); closeServer();

// ── 8–9: the rendered video ──
const hasVideo = fs.existsSync(VIDEO);
if (hasVideo) {
  const sig = spawnSync('ffmpeg', ['-hide_banner', '-i', VIDEO, '-vf', 'scale=270:480,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;
  const ys = [...sig.matchAll(/YAVG=([\d.]+)/g)].map(m => +m[1]);
  const end = meta.beats.poweroff[0];
  for (let i = 1; i < ys.length; i++) { const t = i / 24; if (t > end - .05 || t < 1.5) continue; if (Math.abs(ys[i] - ys[i - 1]) > 12) add('ERROR', 'luma-pop', t, t + 1 / 24, `brightness jumps ${ys[i - 1].toFixed(1)} → ${ys[i].toFixed(1)} between frames`); }
  const bd = spawnSync('ffmpeg', ['-hide_banner', '-i', VIDEO, '-vf', 'blackdetect=d=0.08:pix_th=0.02', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  for (const m of bd.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) if (+m[1] < end) add('ERROR', 'black-frames', +m[1], +m[2], 'black/blank frames before the ending');
  const lo = spawnSync('ffmpeg', ['-hide_banner', '-i', VIDEO, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const I = +(lo.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop().match(/-?[\d.]+/)[0]), TP = +(lo.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop().match(/-?[\d.]+/)[0]);
  if (!(Math.abs(I + 14) <= 1)) add('ERROR', 'loudness', 0, 0, `integrated loudness ${I} LUFS (target −14 ±1)`);
  if (!(TP <= -1)) add('ERROR', 'true-peak', 0, 0, `true peak ${TP} dBTP (limit −1)`);
  const vd = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', VIDEO]).toString();
  if (Math.abs(vd - DUR) > .1) add('ERROR', 'length', 0, 0, `video is ${vd}s, timeline is ${DUR}s`);
  var audioStats = { I, TP, length: vd };
  // contact sheet for a human look
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', VIDEO, '-vf', 'fps=1/2,scale=216:-1,tile=9x3', '-frames:v', '1', path.join(dir, 'qa', 'contact.jpg')]);
} else add('WARN', 'video', 0, 0, `no rendered video at ${VIDEO}: video checks skipped`);

// ── 10–12: narration and subtitles ──
const durs = JSON.parse(fs.readFileSync(path.join(dir, 'voice', 'dur.json')));
const voice = meta.ev.filter(e => e.type === 'voice').map(e => ({ id: e.id, t0: e.t, t1: e.t + durs[e.id] })).sort((a, b) => a.t0 - b.t0);
for (let i = 1; i < voice.length; i++) if (voice[i].t0 < voice[i - 1].t1 + .25) add('ERROR', 'voice-overlap', voice[i].t0, voice[i - 1].t1, `${voice[i - 1].id} still speaking when ${voice[i].id} starts (need ≥0.25 s gap)`);
const [s0, s1] = meta.beats.stop || [-1, -1];
for (const v of voice) if (v.t0 < s1 && v.t1 > s0) add('ERROR', 'silence-broken', v.t0, v.t1, `${v.id} talks over the STOP silence (${s0}–${s1}s)`);
for (const v of voice) if (v.t1 > meta.beats.poweroff[0]) add('ERROR', 'voice-late', v.t0, v.t1, `${v.id} runs into the power-off`);
for (const [i, c] of meta.cues.entries()) {
  const v = voice.find(x => x.id === c.id), d = c.t1 - c.t0;
  if (d < 1.8) add('ERROR', 'subtitle-short', c.t0, c.t1, `cue ${c.id} on screen ${d.toFixed(2)}s (< 1.8 s)`);
  if (v && c.t1 < v.t1 + .5) add('ERROR', 'subtitle-early', c.t0, c.t1, `cue ${c.id} leaves before the line ends (+0.6 s rule)`);
  if (i && c.t0 < meta.cues[i - 1].t1) add('ERROR', 'subtitle-overlap', c.t0, meta.cues[i - 1].t1, `cue ${c.id} overlaps the previous cue`);
}
// ── 15: reading time (library tool) ──
const rc = spawnSync('node', ['core/render/readcheck.mjs', dir, '--size', `${W}x${H}`], { encoding: 'utf8' });
if (rc.status === 1) add('ERROR', 'reading-time', 0, 0, (rc.stdout + rc.stderr).trim().split('\n').filter(l => /short|never/i.test(l)).slice(0, 4).join(' | ') || 'readcheck failed');

// ── report ──
issues.sort((a, b) => (a.sev > b.sev ? 1 : -1) || a.t0 - b.t0);
const errs = issues.filter(i => i.sev === 'ERROR').length, warns = issues.length - errs;
const vj = path.join(dir, 'voice', 'voice.json'), vmeta = fs.existsSync(vj) ? JSON.parse(fs.readFileSync(vj)) : null, pron = vmeta?.said;
if (!vmeta) add('ERROR', 'voice', 0, 0, 'no voice/voice.json: the narration did not go through explainer/voice/tts.py (pronunciation gate)');
else if (vmeta.provider !== 'elevenlabs') add('WARN', 'voice', 0, 0, `voice is the local fallback (${vmeta.provider} ${vmeta.voice}); set ELEVENLABS_API_KEY for the human voice`);
let md = `# QA report — ${path.basename(dir)}\n\n**${errs ? 'FAIL' : 'PASS'}**: ${errs} error(s), ${warns} warning(s). Sampled every ${STEP}s over ${DUR}s; overlaps must last ≥ ${PERSIST}s to count.\n\n`;
md += `| Check | Result |\n|---|---|\n`;
const checks = ['voice', 'empty-scene', 'text-overlap', 'label-crossed', 'knob-overlap', 'hud-collision', 'subtitle-zone', 'safe-area', 'camera-jerk', 'luma-pop', 'black-frames', 'voice-overlap', 'silence-broken', 'voice-late', 'subtitle-short', 'subtitle-early', 'subtitle-overlap', 'loudness', 'true-peak', 'length', 'reading-time'];
for (const c of checks) { const n = issues.filter(i => i.check === c); md += `| ${c} | ${n.length ? `${n[0].sev === 'ERROR' ? '❌' : '⚠️'} ${n.length}` : '✅'} |\n`; }
if (audioStats) md += `\nAudio: ${audioStats.I} LUFS integrated, true peak ${audioStats.TP} dBTP, length ${audioStats.length}s.\n`;
if (vmeta) md += `\nVoice: **${vmeta.provider}** (${vmeta.voice}${vmeta.model ? ', ' + vmeta.model : ''}). Lexicon terms: ${vmeta.terms.join(', ') || 'none'}.\n\nExactly what each line was told to say (${vmeta.provider === 'kokoro' ? 'phonemes' : 'text after lexicon respelling'}):\n\n${Object.entries(pron).map(([k, v]) => `- ${k}: \`${v}\``).join('\n')}\n`;
if (issues.length) md += `\n## Findings\n\n${issues.map(i => `- **${i.sev}** \`${i.check}\` ${i.t1 > i.t0 ? `${i.t0}–${i.t1}s` : ''}: ${i.what}`).join('\n')}\n`;
md += `\n## Not covered automatically\n\n- Whether the voice *sounds* natural, and whether the facts in the script are right: a human listens once.\n- Taste: pacing, whether a shot is interesting. The contact sheet (qa/contact.jpg) is for that.\n`;
fs.mkdirSync(path.join(dir, 'qa'), { recursive: true });
fs.writeFileSync(path.join(dir, 'qa', 'report.md'), md);
fs.writeFileSync(path.join(dir, 'qa', 'report.json'), JSON.stringify({ errors: errs, warnings: warns, issues, audio: audioStats }, null, 1));
console.log(md);
process.exit(errs ? 1 : 0);
