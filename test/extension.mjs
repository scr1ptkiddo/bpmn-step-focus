// The whole extension in headless Chrome: a copy loaded unpacked, its content script injected by
// Chrome into a stand-in Confluence page, the service worker finding the model's tab.
// `node test/extension.mjs`, from the extension's folder.
//
// Chrome-branded builds ignore --load-extension, so the copy goes in over the DevTools pipe
// (Extensions.loadUnpacked, with --remote-debugging-pipe and --enable-unsafe-extension-debugging).
// The pages live under their real kinds of address - Confluence under https://harness.atlassian.net
// /wiki/, the model under https://<name>.surge.sh/ - so the manifest's matches hold; the driver
// answers every request itself (Fetch, enabled for the whole browser) and nothing else resolves.
// The model is a stand-in with the hosted page's hook, window.__hostedFocus, and its step pages
// redirect as the built ones do; an older model without the hook stands beside it. Chrome's split
// view cannot be made over the protocol: a model in a window of its own, placed right of Confluence's,
// is on screen as a split view's twin is, and the split-view id is background.mjs's to check. The
// windows are placed side by side on purpose: Chrome cascades new ones, and a window that the next
// one covers all but a 22px strip of reports its page hidden.
//
// Checked: with no `tabs` permission the worker still sees the model's address (its host access)
// and every tab's splitViewId, -1 with none; a click on a step link focuses the step in the model on
// screen, with no tab opened, and so does one in a database grid's own frame
// (/databases/standalone/, inside the page); a Cmd click opens as before; a model off screen - a tab
// behind Confluence - leaves the link to open in a new tab, on the step; a model without the hook
// is sent to the step page in its own tab.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.dirname(HERE);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('FAIL  no end after 150 s'); process.exit(1); }, 150000).unref();

const MODEL = 'https://model-test.surge.sh/';
const OLD = 'https://model-old.surge.sh/';
const HARNESS = 'https://harness.atlassian.net/wiki/spaces/x/database/1';
const wiki = (site) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weak spots</title></head><body>
<p style="margin:40px;font:16px sans-serif">Redline rounds with no clause library<br>
<a id="step" target="_blank" href="${site}step/Task_redlines/">Send the contract redlines</a></p></body></html>`;
const PAGES = {
  model: `<!DOCTYPE html><title>model</title><script>
    window.__hostedFocus = (id) => { document.title = 'focused ' + id; return true; };
    if (location.hash) document.title = 'opened ' + location.hash;</script>`,
  old: `<!DOCTYPE html><title>old</title><script>if (location.hash) document.title = 'opened ' + location.hash;</script>`,
  step: (id) => `<!DOCTYPE html><title>${id}</title><script>location.replace('../../#${id}')</script>`,
};
/* a database page: the grid in a frame of its own, as Confluence draws it */
const database = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weak spots</title></head><body style="margin:0">
<iframe id="grid" src="https://harness.atlassian.net/databases/standalone/grid" style="border:0;margin:30px;width:600px;height:200px"></iframe></body></html>`;
function answer(url) {
  if (url.startsWith('https://harness.atlassian.net/databases/standalone/')) return wiki(MODEL);
  if (url.startsWith('https://harness.atlassian.net/wiki/'))
    return new URL(url).searchParams.has('grid') ? database : wiki(new URL(url).searchParams.get('model') || MODEL);
  const u = new URL(url);
  if (!u.hostname.endsWith('.surge.sh')) return null;
  const step = u.pathname.match(/^\/step\/([^/]+)\/$/);
  if (step) return PAGES.step(step[1]);
  if (u.pathname === '/') return u.origin + '/' === OLD ? PAGES.old : PAGES.model;
  return null;
}

const run = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-step-focus-ext-'));
const copy = fs.mkdtempSync(path.join(run, 'extension-'));
fs.cpSync(EXTENSION, copy, { recursive: true, filter: (from) => !/^test(\/|$)/.test(path.relative(EXTENSION, from)) });

const args = ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${path.join(run, 'profile')}`, '--no-first-run', '--no-default-browser-check',
  '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank'];
const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const [toChrome, fromChrome] = [child.stdio[3], child.stdio[4]];
let seq = 0, buffer = '';
const pending = new Map(), handlers = [];
fromChrome.on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else handlers.forEach((fn) => fn(msg));
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  toChrome.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};

try {
  const { id } = await send('Extensions.loadUnpacked', { path: copy });
  /* every request of every tab answered here - the tabs the extension opens included */
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
  handlers.push((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const body = answer(msg.params.request.url);
    send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: body ? 200 : 404,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
      body: Buffer.from(body || '').toString('base64') }, msg.sessionId).catch(() => {});
  });
  await send('Target.setDiscoverTargets', { discover: true });
  const pages = new Map();
  handlers.push((msg) => {
    if ((msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') && msg.params.targetInfo.type === 'page')
      pages.set(msg.params.targetInfo.targetId, msg.params.targetInfo);
  });
  /* the service worker, running */
  let workerId = null;
  for (let i = 0; i < 50 && !workerId; i++) {
    const { targetInfos } = await send('Target.getTargets');
    workerId = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${id}/background.js`)?.targetId;
    if (!workerId) await sleep(100);
  }
  const inWorker = async (expression) => {
    const { sessionId } = await send('Target.attachToTarget', { targetId: workerId, flatten: true });
    try {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value;
    } finally {
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
  };

  /* a window of its own on the left or right half of a 1400px screen, as split view halves one */
  const tab = async (url, { half, ...opts } = {}) => {
    const { targetId } = await send('Target.createTarget', { url, ...opts, ...(half ? { newWindow: true } : {}) });
    if (half) {
      const { windowId } = await send('Browser.getWindowForTarget', { targetId });
      await send('Browser.setWindowBounds', { windowId, bounds: { left: half === 'right' ? 700 : 0, top: 0, width: 700, height: 600 } });
    }
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result.value;
    return { targetId, sessionId, ev, close: () => send('Target.closeTarget', { targetId }).catch(() => {}) };
  };
  const leftovers = [];   /* tabs a click opened, closed before the next case: a model on screen would take its clicks */
  const tidy = async () => { for (const key of leftovers.splice(0)) await send('Target.closeTarget', { targetId: key }).catch(() => {}); };
  const title = async (targetId) => (await send('Target.getTargetInfo', { targetId })).targetInfo.title;
  const ON_PAGE = `(() => { const r = document.getElementById('step').getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; })()`;
  const IN_GRID = `(() => { const f = document.getElementById('grid'), o = f.getBoundingClientRect(), r = f.contentDocument.getElementById('step').getBoundingClientRect();
    return [o.left + r.left + 10, o.top + r.top + r.height / 2]; })()`;
  const click = async (wikiTab, modifiers = 0, at = ON_PAGE) => {
    const [x, y] = await wikiTab.ev(at);
    const before = new Set(pages.keys());
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, wikiTab.sessionId);
    await sleep(2000);
    const opened = [];
    for (const key of [...pages.keys()].filter((k) => !before.has(k))) {
      const info = (await send('Target.getTargetInfo', { targetId: key }).catch(() => null))?.targetInfo;
      if (info) opened.push({ url: info.url, title: info.title });
      leftovers.push(key);
    }
    return opened;
  };

  // a model in a window of its own, on screen beside Confluence
  let model = await tab(MODEL, { half: 'right' });
  let wikiTab = await tab(HARNESS, { half: 'left' });
  await sleep(1500);
  const seen = await inWorker('chrome.tabs.query({}).then((tabs) => tabs.map((t) => [t.url || null, t.splitViewId ?? "none reported"]))');
  check('no tabs permission: the worker sees the model\'s address and every tab\'s split view, -1 with none',
        { model: Array.isArray(seen) && seen.some(([url]) => url === MODEL), split: Array.isArray(seen) ? [...new Set(seen.map(([, s]) => s))] : seen },
        { model: true, split: [-1] });
  check('both pages are on screen', [await model.ev('document.visibilityState'), await wikiTab.ev('document.visibilityState')], ['visible', 'visible']);
  let opened = await click(wikiTab);
  check('a click on a step link focuses the step in the model, no tab opened',
        { title: await title(model.targetId), opened }, { title: 'focused Task_redlines', opened: [] });
  opened = await click(wikiTab, 4);
  check('a Cmd click opens the step page as before', opened.map((o) => o.url), ['https://model-test.surge.sh/#Task_redlines']);
  await model.close(); await wikiTab.close(); await tidy();

  // the same in a database grid's own frame
  model = await tab(MODEL, { half: 'right' });
  wikiTab = await tab(`${HARNESS}?grid=1`, { half: 'left' });
  await sleep(1500);
  const shown = await model.ev('document.visibilityState');
  opened = await click(wikiTab, 0, IN_GRID);
  check('a click on a step link in the grid\'s frame focuses the step too, no tab opened',
        { shown, title: await title(model.targetId), opened }, { shown: 'visible', title: 'focused Task_redlines', opened: [] });
  await model.close(); await wikiTab.close(); await tidy();

  // a model off screen: a tab behind Confluence, in its window
  wikiTab = await tab(HARNESS, { half: 'left' });
  model = await tab(MODEL, { background: true });
  await sleep(1500);
  const hidden = await model.ev('document.visibilityState');
  opened = await click(wikiTab);
  check('a model tab off screen: the link opens in a new tab, on the step',
        { hidden, title: await title(model.targetId), opened },
        { hidden: 'hidden', title: 'model', opened: [{ url: 'https://model-test.surge.sh/#Task_redlines', title: 'opened #Task_redlines' }] });
  await model.close(); await wikiTab.close(); await tidy();

  // a model without the hook, on screen
  model = await tab(OLD, { half: 'right' });
  wikiTab = await tab(`${HARNESS}?model=${encodeURIComponent(OLD)}`, { half: 'left' });
  await sleep(1500);
  const oldShown = await model.ev('document.visibilityState');
  opened = await click(wikiTab);
  const info = (await send('Target.getTargetInfo', { targetId: model.targetId })).targetInfo;
  check('a model without the hook is sent to the step page in its own tab',
        { shown: oldShown, url: info.url, title: info.title, opened },
        { shown: 'visible', url: 'https://model-old.surge.sh/#Task_redlines', title: 'opened #Task_redlines', opened: [] });
} catch (e) {
  failed++;
  console.log('FAIL  ' + (e.stack || e));
} finally {
  child.kill();
  await sleep(500);
  fs.rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `${failed} failure(s)` : 'all passed');
process.exit(failed ? 1 : 0);
