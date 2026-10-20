# Paseo PDF viewer

A [Paseo](https://paseo.sh) plugin that shows PDF files from a workspace, one tab per document, on desktop and mobile clients.

![PDF list in the Explorer with a document open](assets/screenshot-desktop.png)

- **Explorer list (desktop):** a PDFs tab in the Explorer lists the workspace's PDFs, newest first. Click one to open it in its own tab; clicking an open document focuses its tab.
- **`/pdf [path]`:** with a path, opens that PDF; without one, shows the list. Paths are relative to the workspace, or absolute paths inside it.
- **Phones:** the list opens as a regular tab, since the phone layout's Explorer has no plugin tabs.
- **Download:** saves the PDF to your device: a browser download on desktop and web, the share sheet on iOS (Save to Files, Mail, ...). Not available on Android, where React Native's share sheet only takes text.
- **Turn cards:** when an agent's turn creates or rewrites PDFs in its workspace, a card listing them appears in the conversation; tap one to open it.
- **Live reload:** an open PDF redraws when the file changes, so it works well next to `typst watch` or `latexmk -pvc`.

## Install

Plugins must be enabled on the daemon (Settings → Plugins, or `"pluginsEnabled": true` in the daemon's `config.json`).

Install the reviewed version from the [Paseo plugin directory](https://paseo.sh/plugins/tlamadon/pdf-viewer):

```sh
paseo plugin add tlamadon/pdf-viewer
```

Or install the latest code straight from GitHub:

```sh
paseo plugin add git:tlamadon/paseo-pdf-viewer
```

The daemon needs `npm` on its `PATH`: installation runs `npm ci` to fetch the `@hyzyla/pdfium` WebAssembly package. Supported Paseo versions: `>=0.11.2 <0.13.0`.

## How it works

The daemon side renders pages with [PDFium](https://pdfium.googlesource.com/pdfium/) compiled to WebAssembly ([`@hyzyla/pdfium`](https://github.com/hyzyla/pdfium)), using its inline build so the WebAssembly travels inside the bundled JavaScript. Paseo evaluates plugin server code as one bundled script, so PDFium runs in a `worker_threads` worker started from source text: `server/pdfium.ts` passes it the Emscripten loader and a compiled WebAssembly module, and `server/pdfium-worker.ts` opens documents, renders pages and encodes PNGs. Calls run one at a time with a 20-second deadline; a call past its deadline, or a PDFium abort, replaces the worker, and an idle worker shuts down after two minutes. The client side uses React Native components only, so the same panels work in the desktop app, the web UI, and the mobile apps.

Every RPC names a workspace, not a directory. The daemon looks up the workspace's directory through the Paseo API and refuses paths outside it, both as written and after resolving symbolic links (`server/workspace.ts`).

Turn cards come from lifecycle hooks: when an agent turn starts, the plugin records the modification times of the workspace's PDFs; when it ends, any PDF that is new, rewritten, or modified after the turn started is listed in a timeline row appended to that agent's conversation.

Paseo panels take no parameters and each panel id maps to one tab, so the plugin registers a panel per opened document at runtime. Registered panels also show up in the New tab menu, so the plugin keeps the list short: the last 10, stored in `$XDG_STATE_HOME/paseo-pdf-viewer/documents.json` (default `~/.local/state/...`).

Paseo resolves a restored tab's panel once, when the tab first renders, and does not re-check when a plugin registers the panel later. Restored tabs therefore need their panels registered synchronously during setup, before any RPC can answer. Desktop and web clients keep a copy of the list in `localStorage` for that; native apps have no synchronous storage, so after relaunching the iOS or Android app a restored PDF tab shows as unavailable until it is closed and reopened.

## Development

```sh
git clone https://github.com/tlamadon/paseo-pdf-viewer
cd paseo-pdf-viewer
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin reload pdf-viewer   # after edits
```

## License

AGPL-3.0-or-later.
