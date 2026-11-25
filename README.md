# BPMN step focus

A plain click in Confluence on a link to a step of a hosted BPMN model focuses that step in the
model when the model is open beside Confluence – in Chrome's split view, or in a window on screen
next to it. The step grows and the rest of the model dims, as a click on the step there does, its
folded sub-process opened first; no health panel opens, and Confluence keeps the focus. With no
model on screen the link opens as it always did, in a new tab, on that step.

Asked 24 Nov 2026 for the weak-spot database of the payment method integration model: its
*Step on the model* column links each weak spot to the activity it sits on. Built that day as a
feature of the Confluence & Jira tweaks extension (1.50.0); its own extension since 25 Nov 2026,
and Confluence & Jira tweaks 1.52.0 no longer has it.

**Load unpacked** from this folder: `chrome://extensions` → Developer mode → Load unpacked →
`code/custom tweaks/extensions/chrome/bpmn-step-focus/`. It stores nothing, so its manifest has no
`key` and the ID follows the folder's path – after a move, Load unpacked again from the new place.
Changed files are read on **Reload** there; a Confluence tab open from before keeps the old content
script until it reloads too.

## The links

A step link is a step page of a hosted model: `https://<model>.surge.sh/step/<element id>/`. The
hosted pages' build (bpmn-guru's `build.sh.template`, with step data) writes one per activity and
collapsed sub-process, titled with the step's name; opened on its own it redirects to
`index.html#<element id>`, and the model's step panel (`step-panel.js`) focuses that element on
load and on every change of the address's `#`. `window.__hostedFocus(<element id>)` does the same
from a script and answers true when it knows the step.

## How it works

- `content.js` – the manifest's one content script: wiki pages and the database grid's own frame
  (`*.atlassian.net/wiki/*`, `*.atlassian.net/databases/standalone/*`), every frame,
  `document_start`, capture phase on `window`, ahead of the grid's handlers, which open a cell's
  link themselves. A plain left click on a step link is stopped and handed to the service worker.
  Middle, Cmd, Ctrl, Shift and Alt clicks, a link inside an editor and any other link go through
  untouched, as does every click in a frame left behind by a reload of the extension
- `background.js` – the service worker (a module). The model's tab is the one sharing Chrome's
  split view with the tab clicked in (`tab.splitViewId`, −1 when none), or else a tab of the
  link's own site whose page is on screen (`document.visibilityState`, the clicked-in window's
  tabs first). There `chrome.scripting.executeScript` in the page's own world calls
  `window.__hostedFocus(<element id>)`; a page without the hook, or one that refuses, is sent to
  the step link in its own tab. With no model on screen the link opens beside the tab clicked in,
  in front

## Permissions

- `scripting` – a script in the model's tab: whether its page is on screen, and the hook
- host access to `https://*.surge.sh/*` – the hosted models' sites: the worker sees which tabs show
  the link's model (their addresses) and may run those scripts there
- no `tabs` permission: the tab clicked in is known by its id, window, place and split view, which
  Chrome hands over without it; its address is never read

## Tests

```bash
node test/background.mjs   # 17 – which tab shows the model, the hook, the fallbacks; chrome stood in for
node test/click.mjs        # 9 – real clicks on step links: stopped and handed over, or let through
node test/extension.mjs    # 7 – the whole extension in headless Chrome: the worker seeing the model's address and the split-view ids without `tabs`; a model on screen focused from a page and from a database grid's frame; a Cmd click opening as before; one off screen left to a new tab; one without the hook sent to the step page
```

Chrome's split view cannot be made over the DevTools protocol: `extension.mjs` puts the model in a
window of its own on the right half of the screen, Confluence's on the left, and `background.mjs`
checks the split-view id path. Side by side on purpose – Chrome cascades new windows, and one that
the next window covers all but a 22px strip of reports its page hidden.

## Icon

`icon.svg` is the source – three steps of a flow on a dimmed model, the middle one grown and lit;
`node make-icons.mjs` renders `icons/icon<size>.png` with headless Chrome.
