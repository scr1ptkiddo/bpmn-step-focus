# BPMN step focus

A Chrome extension for reading Confluence next to a BPMN model. Click a link to a step of the
model on a Confluence page, and the model open beside Confluence shows that step: the step grows
and the rest of the model dims. If the step is inside a folded sub-process, that opens first.
Confluence stays as it was.

It works with Confluence Cloud pages and databases (`*.atlassian.net`) and with BPMN models hosted
on surge.sh that have a page per step – links like `https://<model>.surge.sh/step/<step id>/`.

## Install

1. download this repository – **Code → Download ZIP** on GitHub – and unzip it
2. open `chrome://extensions` in Chrome
3. turn on **Developer mode**, top right
4. click **Load unpacked** and pick the unzipped folder, the one with `manifest.json` in it

Chrome runs the extension from that folder, so leave it where it is. If you move it, load it again
from the new place.

## How to use

1. open the Confluence page or database with the step links
2. open the model beside it – both tabs in Chrome's split view, or the model in a second window
   next to Confluence
3. click a step link – the model shows that step

Other cases:

- no model on screen – the link opens in a new tab, on that step
- Cmd, Ctrl, Shift or Alt click, or a middle click – the link opens as usual
- a link in a page you are editing – left alone
- an older model page that cannot focus a step – it reloads on that step

## Update

Replace the folder's files with the new version, then click the reload arrow on the extension's
card in `chrome://extensions` and reload your Confluence tabs.

## Permissions

- **scripting** – to show the step in the model's tab
- **access to `*.surge.sh`** – the sites the models are hosted on; the extension only looks at tabs
  of the clicked link's own model

It also runs a small script on Confluence pages that only watches for clicks on step links. It
stores nothing and sends nothing anywhere.

## For developers

- `content.js` – takes a plain click on a step link in Confluence and hands it to the service worker
- `background.js` – finds the model's tab (the split-view neighbour, else a model page on screen)
  and asks the page to focus the step
- model pages – the extension calls `window.__hostedFocus(<step id>)` in the model's page, which
  focuses the step and returns `true`. A step page at `/step/<step id>/` should open the model on
  that step – links go there when no model is on screen
- tests – Node 22 or newer; the two browser suites need Google Chrome on macOS:

  ```bash
  node test/background.mjs   # which tab, the hook, the fallbacks – no browser
  node test/click.mjs        # real clicks on step links in headless Chrome
  node test/extension.mjs    # the whole extension in headless Chrome
  ```

- `node make-icons.mjs` – redraws `icons/` from `icon.svg`
