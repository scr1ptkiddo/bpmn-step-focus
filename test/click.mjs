// content.js against real clicks in headless Chrome, driven over the DevTools protocol with
// Node's own WebSocket - no install. `node test/click.mjs`, from the extension's folder.
//
// The page holds the links the script meets: a step page link as the Step on the model column
// holds it, one with its text in a span, a link to the model page itself, a step path on another
// site, and a step link inside something being edited - every one target=_blank, as the grid opens
// them. The script is loaded with `chrome` stood in for, and a capture listener on document stands
// for the grid's own handlers.
//
// A plain click on a step link is stopped - no tab opens, nothing of the page sees it - and handed
// over once. A Cmd, Shift or middle click, the model page's own link, another site's and a link
// being edited go through untouched, and so does every link after the extension was reloaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(path.dirname(HERE), 'content.js'), 'utf8');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STEP = 'https://model-abc.surge.sh/step/Task_redlines/';
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { font: 16px sans-serif; } a, div { display: block; margin: 14px; padding: 6px; }</style></head><body>
<a id="step" target="_blank" href="${STEP}">Send the contract redlines</a>
<a id="nested" target="_blank" href="${STEP}"><span id="inner">Send the contract redlines, its text in a span</span></a>
<a id="model" target="_blank" href="https://model-abc.surge.sh/#Task_redlines">the model page itself</a>
<a id="other" target="_blank" href="https://example.com/step/Task_redlines/">a step path on another site</a>
<div contenteditable="true"><a id="edited" target="_blank" href="${STEP}">a step link being edited</a></div>
</body></html>`;

const run = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-step-focus-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(run, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
process.on('exit', () => chrome.kill());
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
  chrome.stderr.on('data', (d) => {
    const m = (buf += d).match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map(), created = [], errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === 'Target.targetCreated' && msg.params.targetInfo.type === 'page') {
    created.push(msg.params.targetInfo);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
await send('Target.setDiscoverTargets', { discover: true });

async function open() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await ev(`document.open(); document.write(${JSON.stringify(PAGE)}); document.close();
    window.__sent = []; window.__reached = [];
    document.addEventListener('click', (e) => __reached.push(e.target.closest('a') && e.target.closest('a').id), true);
    document.addEventListener('auxclick', (e) => __reached.push(e.target.closest('a') && e.target.closest('a').id), true);
    window.__stub = { runtime: { id: 'stub', sendMessage(message) { __sent.push(message); } } };
    new Function('chrome', ${JSON.stringify(SRC)})(__stub);`);
  await sleep(100);
  /* a real press on the element's middle: button 'left' or 'middle', modifiers 4 Cmd, 8 Shift */
  const press = async (id, button = 'left', modifiers = 0) => {
    const [x, y] = await ev(`(() => { const r = document.getElementById('${id}').getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const before = created.length;
    await ev('__sent.length = 0; __reached.length = 0');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button, modifiers, clickCount: 1,
        buttons: type === 'mousePressed' ? (button === 'left' ? 1 : 4) : 0 }, sessionId);
    await sleep(400);
    const opened = created.slice(before);
    for (const target of opened) await send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
    return { handed: await ev('__sent.slice()'), reached: await ev('__reached.slice()'), tabs: opened.length };
  };
  return { ev, press, close: () => send('Target.closeTarget', { targetId }) };
}

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};
const handed = { handed: [{ bpmnStep: 'focus', href: STEP }], reached: [], tabs: 0 };
const through = (id) => ({ handed: [], reached: [id], tabs: 1 });

try {
  const page = await open();
  check('a plain click on a step link: stopped, handed over', await page.press('step'), handed);
  check('a step link whose text is in a span', await page.press('inner'), handed);
  check('a Cmd click goes through', await page.press('step', 'left', 4), through('step'));
  check('a Shift click goes through', await page.press('step', 'left', 8), through('step'));
  check('a middle click goes through', await page.press('step', 'middle'), through('step'));
  check('the model page\'s own link goes through', await page.press('model'), through('model'));
  check('a step path on another site goes through', await page.press('other'), through('other'));
  const edited = await page.press('edited');
  check('a step link being edited is left to the editor', { handed: edited.handed, reached: edited.reached }, { handed: [], reached: ['edited'] });
  await page.ev('__stub.runtime.id = undefined');
  check('after a reload of the extension, a step link goes through', await page.press('step'), through('step'));
  await page.close();
} catch (e) {
  failed++;
  console.log('FAIL  ' + (e.stack || e));
} finally {
  if (errors.length) { failed++; console.log('FAIL  script errors: ' + JSON.stringify(errors)); }
  ws.close();
  chrome.kill();
  await sleep(300);
  fs.rmSync(run, { recursive: true, force: true });
}
console.log(failed ? `${failed} failure(s)` : 'all passed');
process.exit(failed ? 1 : 0);
