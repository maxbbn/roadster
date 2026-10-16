// Records the autopilot run frame by frame and encodes it to MP4.
// Usage: node scripts/record-demo.mjs [--url http://localhost:5188] [--out media/roadster-demo.mp4] [--frames DIR]
// Requires the dev server to be running and ffmpeg on PATH.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('url', 'http://localhost:5188');
const out = resolve(opt('out', 'media/roadster-demo.mp4'));
const framesDir = resolve(opt('frames', join(tmpdir(), 'roadster-frames')));
const width = Number(opt('width', 1920));
const height = Number(opt('height', 1080));
const fps = 60;
const tailSeconds = 3.5;

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(`${url}/?autopilot`);
await page.waitForFunction(() => window.game && window.game.autopilot);

const gpu = await page.evaluate(() => {
  const g = window.game;
  g.manual = true;
  g.autopilot = new g.autopilot.constructor(3.2);
  g.clock = 0;
  const gl = g.stage.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(`renderer: ${gpu}`);

let frame = 0;
let tail = -1;
const started = Date.now();
while (frame < fps * 120) {
  const state = await page.evaluate((dt) => {
    const g = window.game;
    g.advance(dt);
    // Step CSS animations (toasts, fades) in game time instead of wall-clock time.
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = (Number(a.currentTime) || 0) + dt * 1000;
    }
    const finish = document.querySelector('[data-k=finish]');
    return { state: g.state, results: finish && !finish.classList.contains('hidden') };
  }, 1 / fps);
  await page.screenshot({ path: join(framesDir, `${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  frame++;
  if (state.results && tail < 0) tail = frame + Math.round(tailSeconds * fps);
  if (tail > 0 && frame >= tail) break;
  if (frame % 120 === 0) console.log(`frame ${frame} (${state.state}) ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
await browser.close();

console.log(`encoding ${frame} frames -> ${out}`);
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-framerate', String(fps),
  '-i', join(framesDir, '%05d.jpg'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  out,
]);
console.log('done');
