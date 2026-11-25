// BPMN step focus, in Confluence. A click on a link to a step of a hosted BPMN model – a step page,
// https://<model>.surge.sh/step/<element id>/, as the Step on the model column of a weak-spot
// database holds – focuses that step in the model when the model is open beside Confluence: in
// Chrome's split view, or in a window on screen next to it. There the step grows and the rest of the
// model dims, as a click on the step does (its sub-process opened first when the step sits inside
// one), without the health panel, and Confluence keeps the focus. With no model on screen the link
// opens as it always did – in a new tab, where the step page opens the model on that step.
//
// Only a plain click is taken: a middle click, a click with Ctrl, Cmd, Shift or Alt, a link inside
// something being edited, and a frame left behind by a reload of the extension go through as
// before. The service worker (background.js) finds the model's tab and focuses the step there, or
// opens the link.
//
// The manifest's one content script: wiki pages and the database grid's own frame
// (/databases/standalone/*), every frame, at document_start – registered on window in the capture
// phase, ahead of the grid's own handlers, which open a cell's link themselves.
(() => {
  const STEP = /^\/step\/[^/]+\/?$/;

  function stepLink(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    return url.protocol === 'https:' && url.hostname.endsWith('.surge.sh') && STEP.test(url.pathname);
  }

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.isContentEditable || !stepLink(link.href)) return;
    if (!chrome.runtime || !chrome.runtime.id) return; // the extension was reloaded under this frame
    event.preventDefault();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage({ bpmnStep: 'focus', href: link.href });
  }

  window.addEventListener('click', onClick, true);
})();
