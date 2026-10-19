View PDF files from the current workspace without leaving Paseo. Each PDF opens in its own tab, rendered page by page with zoom and a page counter. Opening a PDF that is already open switches to its tab.

On desktop, a PDFs tab in the Explorer lists every PDF under the workspace directory, newest first, with a filter box. Click a file to open it. You can also send `/pdf` in the composer to show the list, `/pdf path/to/file.pdf` to open a file directly, or choose "Show PDFs" in the Command Center. Paths can be relative to the workspace, absolute, or start with `~/`. On phones, where the Explorer has no plugin tabs, the list opens as a regular tab instead.

Pages are rendered to images on the daemon machine with MuPDF, so the viewer works the same on desktop and mobile clients. An open file is checked every two seconds and redraws when it changes, which suits documents rebuilt by LaTeX or Typst in watch mode.

Setup: the daemon machine needs npm on its PATH, because installing the plugin downloads the MuPDF WebAssembly build (the `mupdf` package) from the npm registry. Requires Paseo 0.11.2 or later, below 0.13.

The plugin reads PDF files on the daemon machine and sends rendered page images to your Paseo clients. It sends nothing to other services. It keeps the paths of the 30 most recently opened PDFs in `~/.local/state/paseo-pdf-viewer/documents.json` so their tabs survive an app reload. Password-protected PDFs are not supported. The file list stops at 500 entries and skips hidden folders and `node_modules`. Text selection and search are not available, because pages are images.
