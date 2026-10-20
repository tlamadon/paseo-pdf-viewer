// Runs inside a worker thread. Paseo evaluates plugin server code as one bundled script, so the
// worker cannot load modules from disk: server/pdfium.ts sends this function as source text,
// together with PDFium's Emscripten loader (also as source) and its compiled WebAssembly module.
// Everything below must therefore stay self-contained: no imports and no outside helpers.

export type PdfiumRequest =
  | { op: "open"; key: string; bytes: Uint8Array }
  | { op: "render"; key: string; page: number; width: number }
  | { op: "close"; key: string };

export interface PdfiumOpenResult {
  title: string | null;
  // Width / height of each page.
  aspects: number[];
}

export interface PdfiumRenderResult {
  png: Uint8Array;
  width: number;
  height: number;
}

export type PdfiumResponse =
  | { id: number; ok: true; value: unknown }
  // `fatal` means PDFium aborted; the worker must be replaced.
  | { id: number; ok: false; message: string; fatal: boolean };

export interface PdfiumWorkerData {
  glue: string;
  // Names the bundler gave `import.meta` and the `_defineProperty` helper inside the glue.
  importMetaName: string;
  definePropertyName: string;
  wasm: object;
}

interface WorkerPort {
  on(event: "message", listener: (message: { id: number } & PdfiumRequest) => void): void;
  postMessage(message: PdfiumResponse, transfer?: ArrayBuffer[]): void;
}

export function pdfiumWorkerMain(port: WorkerPort, data: PdfiumWorkerData, nodeRequire: (id: string) => unknown): void {
  const zlib = nodeRequire("node:zlib") as { deflateSync(input: Uint8Array, options: { level: number }): Uint8Array };

  // PDFium C API, as exported by the Emscripten module.
  interface Pdfium {
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
    _FPDF_InitLibrary(): void;
    _FPDF_LoadMemDocument(data: number, size: number, password: number): number;
    _FPDF_GetLastError(): number;
    _FPDF_CloseDocument(doc: number): void;
    _FPDF_GetPageCount(doc: number): number;
    _FPDF_LoadPage(doc: number, index: number): number;
    _FPDF_ClosePage(page: number): void;
    _FPDF_GetPageWidthF(page: number): number;
    _FPDF_GetPageHeightF(page: number): number;
    _FPDF_GetMetaText(doc: number, tag: number, buffer: number, length: number): number;
    _FPDFBitmap_CreateEx(width: number, height: number, format: number, buffer: number, stride: number): number;
    _FPDFBitmap_FillRect(bitmap: number, left: number, top: number, width: number, height: number, color: number): void;
    _FPDFBitmap_Destroy(bitmap: number): void;
    _FPDF_RenderPageBitmap(bitmap: number, page: number, x: number, y: number, w: number, h: number, rotate: number, flags: number): void;
  }

  const BITMAP_BGRA = 4;
  const RENDER_ANNOT = 0x01;
  const RENDER_REVERSE_BYTE_ORDER = 0x10; // BGRA buffer receives RGBA bytes.
  const LOAD_ERRORS: Record<number, string> = {
    2: "The PDF could not be read",
    3: "The file is not a valid PDF or is damaged",
    4: "Password-protected PDFs are not supported",
    5: "This PDF uses an unsupported security scheme",
  };

  const defineProperty = (target: object, key: string, value: unknown) =>
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  const factory = new Function(data.importMetaName, data.definePropertyName, `return (${data.glue});`)(
    { url: "file:///pdfium.js" },
    defineProperty,
  ) as (options: object) => Promise<Pdfium>;
  const ready = factory({
    // Instantiate the module compiled on the main thread instead of fetching a .wasm file.
    instantiateWasm(imports: object, receive: (instance: unknown, module: unknown) => void) {
      const wasm = (globalThis as unknown as { WebAssembly: { instantiate(m: object, i: object): Promise<unknown> } })
        .WebAssembly;
      wasm.instantiate(data.wasm, imports).then((instance) => receive(instance, data.wasm));
      return {};
    },
  }).then((pdfium) => {
    pdfium._FPDF_InitLibrary();
    return pdfium;
  });

  const documents = new Map<string, { doc: number; bytes: number }>();

  function open(pdfium: Pdfium, key: string, bytes: Uint8Array): PdfiumOpenResult {
    close(pdfium, key);
    // PDFium reads from this buffer for the document's whole life.
    const buffer = pdfium._malloc(bytes.length);
    pdfium.HEAPU8.set(bytes, buffer);
    const doc = pdfium._FPDF_LoadMemDocument(buffer, bytes.length, 0);
    if (!doc) {
      const code = pdfium._FPDF_GetLastError();
      pdfium._free(buffer);
      throw new Error(LOAD_ERRORS[code] ?? `PDFium could not open the PDF (error ${code})`);
    }
    documents.set(key, { doc, bytes: buffer });
    const aspects: number[] = [];
    const count = pdfium._FPDF_GetPageCount(doc);
    for (let index = 0; index < count; index++) {
      const page = pdfium._FPDF_LoadPage(doc, index);
      if (!page) {
        aspects.push(1 / Math.SQRT2);
        continue;
      }
      aspects.push(pdfium._FPDF_GetPageWidthF(page) / (pdfium._FPDF_GetPageHeightF(page) || 1));
      pdfium._FPDF_ClosePage(page);
    }
    return { title: metaText(pdfium, doc, "Title"), aspects };
  }

  function metaText(pdfium: Pdfium, doc: number, tag: string): string | null {
    const tagBytes = new TextEncoder().encode(`${tag}\0`);
    const tagPtr = pdfium._malloc(tagBytes.length);
    pdfium.HEAPU8.set(tagBytes, tagPtr);
    try {
      // Returns the UTF-16LE byte length including the terminator.
      const length = pdfium._FPDF_GetMetaText(doc, tagPtr, 0, 0);
      if (length <= 2) return null;
      const buffer = pdfium._malloc(length);
      try {
        pdfium._FPDF_GetMetaText(doc, tagPtr, buffer, length);
        const text = new TextDecoder("utf-16le").decode(pdfium.HEAPU8.slice(buffer, buffer + length - 2)).trim();
        return text || null;
      } finally {
        pdfium._free(buffer);
      }
    } finally {
      pdfium._free(tagPtr);
    }
  }

  function render(pdfium: Pdfium, key: string, index: number, width: number): PdfiumRenderResult {
    const entry = documents.get(key);
    if (!entry) throw new Error("The PDF is not open");
    if (index >= pdfium._FPDF_GetPageCount(entry.doc)) throw new Error(`Page ${index + 1} does not exist`);
    const page = pdfium._FPDF_LoadPage(entry.doc, index);
    if (!page) throw new Error(`Page ${index + 1} could not be loaded`);
    const height = Math.max(
      1,
      Math.round((width * pdfium._FPDF_GetPageHeightF(page)) / (pdfium._FPDF_GetPageWidthF(page) || 1)),
    );
    const stride = width * 4;
    const pixels = pdfium._malloc(stride * height);
    let bitmap = 0;
    try {
      bitmap = pdfium._FPDFBitmap_CreateEx(width, height, BITMAP_BGRA, pixels, stride);
      pdfium._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      pdfium._FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, RENDER_ANNOT | RENDER_REVERSE_BYTE_ORDER);
      return { png: encodePng(pdfium.HEAPU8.subarray(pixels, pixels + stride * height), width, height), width, height };
    } finally {
      if (bitmap) pdfium._FPDFBitmap_Destroy(bitmap);
      pdfium._free(pixels);
      pdfium._FPDF_ClosePage(page);
    }
  }

  function close(pdfium: Pdfium, key: string): void {
    const entry = documents.get(key);
    if (!entry) return;
    pdfium._FPDF_CloseDocument(entry.doc);
    pdfium._free(entry.bytes);
    documents.delete(key);
  }

  // Minimal PNG writer: opaque RGB, 8 bits per channel, "Up" filter, which suits text and diagrams.
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const rowBytes = width * 3;
    const raw = new Uint8Array((rowBytes + 1) * height);
    let previous: Uint8Array | null = null;
    for (let y = 0; y < height; y++) {
      const row = new Uint8Array(rowBytes);
      for (let x = 0, source = y * width * 4; x < rowBytes; x += 3, source += 4) {
        row[x] = rgba[source];
        row[x + 1] = rgba[source + 1];
        row[x + 2] = rgba[source + 2];
      }
      const start = y * (rowBytes + 1);
      raw[start] = previous ? 2 : 0;
      for (let x = 0; x < rowBytes; x++) raw[start + 1 + x] = previous ? (row[x] - previous[x]) & 0xff : row[x];
      previous = row;
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header.set([8, 2, 0, 0, 0], 8);
    const chunks = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
      pngChunk("IEND", new Uint8Array(0)),
    ];
    const png = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      png.set(chunk, offset);
      offset += chunk.length;
    }
    return png;
  }

  function pngChunk(type: string, body: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(12 + body.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(body, 8);
    view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
    return chunk;
  }

  port.on("message", (message) => {
    ready
      .then((pdfium) => {
        if (message.op === "open") {
          port.postMessage({ id: message.id, ok: true, value: open(pdfium, message.key, message.bytes) });
        } else if (message.op === "render") {
          const result = render(pdfium, message.key, message.page, message.width);
          port.postMessage({ id: message.id, ok: true, value: result }, [result.png.buffer as ArrayBuffer]);
        } else {
          close(pdfium, message.key);
          port.postMessage({ id: message.id, ok: true, value: null });
        }
      })
      .catch((error: unknown) => {
        // Emscripten aborts surface as WebAssembly.RuntimeError and leave the module unusable.
        const fatal = error instanceof Error && error.name === "RuntimeError";
        port.postMessage({ id: message.id, ok: false, message: error instanceof Error ? error.message : String(error), fatal });
      });
  });
}
