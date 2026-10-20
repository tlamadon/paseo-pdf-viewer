View PDF files from the current workspace without leaving Paseo. Each PDF opens in its own tab, rendered page by page with zoom and a page counter. Opening a PDF that is already open switches to its tab.

On desktop, a PDFs tab in the Explorer lists every PDF under the workspace directory, newest first, with a filter box. Click a file to open it. You can also send `/pdf` in the composer to show the list, `/pdf path/to/file.pdf` to open a file directly, or choose "Show PDFs" in the Command Center. On phones, where the Explorer has no plugin tabs, the list opens as a regular tab instead.

When an agent's turn creates or rewrites PDFs in its workspace, a card listing them appears at the end of that turn in the conversation; tap a file to open it. An open file is checked every two seconds and redraws when it changes, which suits documents rebuilt by LaTeX or Typst in watch mode.

A download button in the viewer copies the PDF to your device: a regular download in the desktop and web apps, or the share sheet on iOS, where you can choose Save to Files. It is not available in the Android app.

Pages are rendered to images on the daemon machine by PDFium, the PDF engine used in Chrome, running as WebAssembly in a background thread, so the viewer works the same on desktop and mobile clients.

Setup: the daemon machine needs npm on its PATH, because installing the plugin downloads PDFium's WebAssembly build (the `@hyzyla/pdfium` package) from the npm registry. Requires Paseo 0.11.2 or later, below 0.13.

The plugin only opens files inside the workspace directory, including after following symbolic links. It sends rendered page images and downloaded files to your Paseo clients and nothing to other services. To build turn cards it lists the workspace's PDFs and their modification times when each agent turn starts and ends. It keeps the paths of the 10 most recently opened PDFs in `~/.local/state/paseo-pdf-viewer/documents.json` so their tabs survive an app reload; those PDFs also appear in the New tab menu. In the iOS and Android apps, a PDF tab restored after relaunching the app shows as unavailable until you close it and open the file again. Password-protected PDFs are not supported. The file list stops at 500 entries and skips hidden folders and `node_modules`. Text selection and search are not available, because pages are images.
