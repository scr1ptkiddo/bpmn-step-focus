// BPMN step focus's service worker (a module). content.js hands over a click on a link to a step
// page of a hosted BPMN model; here the tab showing that model beside Confluence is found and the
// step focused in it, through the hook the model page's step panel defines:
// window.__hostedFocus(<element id>) grows the step and dims the rest, opening the step's
// sub-process first, and answers true when it knows the step.
//
// The model's tab is one showing a page of the link's own site: the tab that shares Chrome's split
// view with the tab clicked in (both carry the same splitViewId), or else one whose page is on
// screen – in another window next to Confluence – by its document.visibilityState. A page there
// that cannot focus the step – an older build without the hook, a step it does not know – is sent
// to the link in the same tab, and the step page opens the model on that step. With no model on
// screen the link opens in a new tab beside the one it was clicked in, as the link itself would.
//
// The `scripting` permission and the host access to https://*.surge.sh/* are for the model's tab
// alone: its address tells it is the link's site, a script there reads whether it is on screen and
// calls the hook. No `tabs` permission – the tab clicked in is known by its id, window, place and
// split view, never by its address.
const STEP = /^\/step\/([^/]+)\/?$/;

/* the id of the step a link names, or null */
export function stepOf(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.surge.sh')) return null;
  const match = url.pathname.match(STEP);
  return match ? { origin: url.origin, id: decodeURIComponent(match[1]) } : null;
}

function sameSite(tab, origin) {
  try {
    return new URL(tab.url).origin === origin;
  } catch {
    return false;
  }
}

async function onScreen(tabId) {
  try {
    const [found] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.visibilityState });
    return Boolean(found && found.result === 'visible');
  } catch {
    return false;
  }
}

/* the tab showing the model beside `from`, or null */
export async function modelTab(origin, from) {
  const tabs = (await chrome.tabs.query({})).filter((tab) => tab.id !== from.id && tab.url && sameSite(tab, origin));
  if (!tabs.length) return null;
  const none = chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1;
  if (typeof from.splitViewId === 'number' && from.splitViewId !== none) {
    const twin = tabs.find((tab) => tab.splitViewId === from.splitViewId);
    if (twin) return twin;
  }
  /* the window clicked in first: a split view the API does not report */
  tabs.sort((a, b) => (b.windowId === from.windowId) - (a.windowId === from.windowId));
  for (const tab of tabs) if (await onScreen(tab.id)) return tab;
  return null;
}

async function focusIn(tabId, id) {
  try {
    const [found] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (step) => typeof window.__hostedFocus === 'function' && window.__hostedFocus(step) === true,
      args: [id],
    });
    return Boolean(found && found.result);
  } catch {
    return false;
  }
}

export async function open(href, from) {
  const step = stepOf(href);
  if (!step) return;
  const model = from ? await modelTab(step.origin, from) : null;
  if (model) {
    if (!(await focusIn(model.id, step.id))) await chrome.tabs.update(model.id, { url: href });
    return;
  }
  const place = from ? { index: from.index + 1, openerTabId: from.id, windowId: from.windowId } : {};
  await chrome.tabs.create({ url: href, active: true, ...place });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.bpmnStep !== 'focus' || typeof message.href !== 'string') return undefined;
  open(message.href, sender.tab);
  return undefined;
});
