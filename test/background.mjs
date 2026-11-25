// The service worker, in Node with `chrome` stood in for - no browser.
// `node test/background.mjs`, from the extension's folder.
//
// Which tab shows the model: the split-view twin of the tab clicked in, else a model page on
// screen - the clicked-in window's first - never another site's, never one off screen. The step
// focused there through the page's hook; a page without the hook, or one that refuses scripts,
// sent to the link in the same tab; no model on screen, the link opened beside the tab clicked in.
// Links that are no step page, and other messages, left alone.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = pathToFileURL(path.join(path.dirname(HERE), 'background.js')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};

const SITE = 'https://model-abc.surge.sh';
const LINK = `${SITE}/step/Task_redlines/`;
const WIKI = 'https://x.atlassian.net/wiki/spaces/x/database/1';
const FROM = { id: 1, windowId: 1, index: 3, url: WIKI };

let copy = 0;
async function worker({ tabs, visible = {}, hook = {}, refuses = [], none } = {}) {
  const calls = [];
  let listener = null;
  globalThis.chrome = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    tabs: {
      ...(none === undefined ? {} : { SPLIT_VIEW_ID_NONE: none }),
      query: async () => tabs.map((tab) => ({ ...tab })),
      update: async (id, props) => { calls.push(['update', id, props.url]); },
      create: async (props) => { calls.push(['create', props]); return { id: 99 }; },
    },
    scripting: {
      executeScript: async ({ target, world, args }) => {
        if (refuses.includes(target.tabId)) throw new Error('Cannot access contents of the page');
        if (world === 'MAIN') { calls.push(['focus', target.tabId, args[0]]); return [{ result: hook[target.tabId] === true }]; }
        return [{ result: visible[target.tabId] ? 'visible' : 'hidden' }];
      },
    },
  };
  const mod = await import(`${MODULE}?copy=${++copy}`);
  return { mod, calls, send: (message, sender) => listener(message, sender) };
}
const model = (id, extra = {}) => ({ id, windowId: 2, index: 0, url: `${SITE}/#Task_build`, ...extra });

try {
  // ---- stepOf
  const { mod } = await worker({ tabs: [] });
  check('a step page names its step', mod.stepOf(LINK), { origin: SITE, id: 'Task_redlines' });
  check('without the trailing slash too', mod.stepOf(`${SITE}/step/Task_redlines`), { origin: SITE, id: 'Task_redlines' });
  check('an escaped id is read back', mod.stepOf(`${SITE}/step/Task%20x/`), { origin: SITE, id: 'Task x' });
  check('the model page itself is no step page', mod.stepOf(`${SITE}/#Task_redlines`), null);
  check('a step path elsewhere is not one', mod.stepOf('https://example.com/step/Task_redlines/'), null);
  check('nor over http', mod.stepOf(`http://model-abc.surge.sh/step/Task_redlines/`), null);
  check('nor a path below a step', mod.stepOf(`${SITE}/step/Task_redlines/more`), null);

  // ---- which tab
  let w = await worker({ tabs: [FROM, model(2, { windowId: 1, splitViewId: 5 }), model(3, { splitViewId: -1 })],
    visible: { 3: true }, hook: { 2: true, 3: true }, none: -1 });
  await w.mod.open(LINK, { ...FROM, splitViewId: 5 });
  check('the split-view twin is focused, even with another model on screen', w.calls, [['focus', 2, 'Task_redlines']]);

  w = await worker({ tabs: [FROM, model(2), model(3)], visible: { 3: true }, hook: { 2: true, 3: true } });
  await w.mod.open(LINK, FROM);
  check('no split view reported: the model page on screen', w.calls, [['focus', 3, 'Task_redlines']]);

  w = await worker({ tabs: [FROM, model(2), model(3, { windowId: 1 })], visible: { 2: true, 3: true }, hook: { 2: true, 3: true } });
  await w.mod.open(LINK, FROM);
  check('two on screen: the one in the window clicked in', w.calls, [['focus', 3, 'Task_redlines']]);

  w = await worker({ tabs: [FROM, model(2, { splitViewId: 7 })], visible: { 2: true }, hook: { 2: true }, none: -1 });
  await w.mod.open(LINK, { ...FROM, splitViewId: -1 });
  check('the tab clicked in is in no split view: the model on screen', w.calls, [['focus', 2, 'Task_redlines']]);

  w = await worker({ tabs: [FROM, { ...model(2), url: 'https://other-model.surge.sh/' }], visible: { 2: true }, hook: { 2: true } });
  await w.mod.open(LINK, FROM);
  check('another model\'s site on screen is not taken: the link opens beside',
        w.calls, [['create', { url: LINK, active: true, index: 4, openerTabId: 1, windowId: 1 }]]);

  w = await worker({ tabs: [FROM, model(2)], visible: {}, hook: { 2: true } });
  await w.mod.open(LINK, FROM);
  check('the model off screen: the link opens beside the tab clicked in',
        w.calls, [['create', { url: LINK, active: true, index: 4, openerTabId: 1, windowId: 1 }]]);

  // ---- a page that cannot focus
  w = await worker({ tabs: [FROM, model(2)], visible: { 2: true }, hook: {} });
  await w.mod.open(LINK, FROM);
  check('a page without the hook is sent to the link, in its tab', w.calls, [['focus', 2, 'Task_redlines'], ['update', 2, LINK]]);

  w = await worker({ tabs: [FROM, model(2, { windowId: 1, splitViewId: 5 })], refuses: [2], none: -1 });
  await w.mod.open(LINK, { ...FROM, splitViewId: 5 });
  check('a twin refusing scripts is sent to the link', w.calls, [['update', 2, LINK]]);

  // ---- messages
  w = await worker({ tabs: [FROM, model(2)], visible: { 2: true }, hook: { 2: true } });
  check('another message is not answered', w.send({ jumplist: 'rule' }, { tab: FROM }), undefined);
  w.send({ bpmnStep: 'focus', href: 'https://example.com/elsewhere' }, { tab: FROM });
  w.send({ bpmnStep: 'focus', href: LINK }, { tab: FROM });
  await sleep(20);
  check('a step link handed over is focused; a link to no step page is left alone', w.calls, [['focus', 2, 'Task_redlines']]);
} catch (e) {
  failed++;
  console.log('FAIL  ' + (e.stack || e));
}
console.log(failed ? `${failed} failure(s)` : 'all passed');
process.exit(failed ? 1 : 0);
