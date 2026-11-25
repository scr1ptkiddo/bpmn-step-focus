// Renders icons/icon<size>.png from icon.svg: `node make-icons.mjs` (google-docs' script).
//
// No rsvg-convert / ImageMagick / PIL on this machine, so the rasteriser is headless Chrome,
// driven over the DevTools pipe – the one-shot --screenshot flag has hung here for minutes. The
// default background is made transparent, or the corners of the rounded square come out white.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [16, 32, 48, 128];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-step-focus-icons-'));
const child = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let seq = 0, buffer = '';
const pending = new Map();
child.stdio[4].on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const wait = msg.id && pending.get(msg.id);
    if (!wait) continue;
    pending.delete(msg.id);
    msg.error ? wait.reject(new Error(msg.error.message)) : wait.resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
  const svg = fs.readFileSync(path.join(HERE, 'icon.svg'), 'utf8');
  fs.mkdirSync(path.join(HERE, 'icons'), { recursive: true });
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false }, sessionId);
    const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
    await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } }, sessionId);
    const file = path.join(HERE, 'icons', `icon${size}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`icon${String(size).padEnd(4)} ${fs.statSync(file).size} bytes`);
  }
} finally {
  child.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }), 300);
}
