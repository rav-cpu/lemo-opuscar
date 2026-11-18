// node explainer/engine/export.mjs films/<slug>: the film's computed timeline (scene times, sound events, subtitle cues)
// → films/<slug>/out/timeline.json and out/cues.json. Run after the voice exists (timings follow the real line lengths).
import fs from 'fs'; import path from 'path';
import { openDemo, closeServer } from '../../core/render/page.mjs';
const dir = path.resolve(process.argv[2] || '');
const { browser, page } = await openDemo(dir, { w: 1080, h: 1920, gl: false });
const tl = await page.evaluate(() => ({ dur: window.DUR, ev: window.EV, cues: window.CUES, scenes: window.SCENES }));
await browser.close(); closeServer();
fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
fs.writeFileSync(path.join(dir, 'out', 'timeline.json'), JSON.stringify(tl, null, 1));
fs.writeFileSync(path.join(dir, 'out', 'cues.json'), JSON.stringify(tl.cues.map(c => ({ t0: c.t0, t1: c.t1, text: c.text })), null, 1));
console.log(`timeline: ${tl.scenes.length} scenes, ${tl.dur}s, ${tl.ev.length} events`);
for (const s of tl.scenes) console.log(`  ${s.id.padEnd(4)} ${s.type.padEnd(8)} ${s.t0.toFixed(2)}–${s.t1.toFixed(2)}s  voice ${s.vt.toFixed(2)}+${s.d}s`);
