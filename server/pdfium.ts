import { Worker } from "node:worker_threads";
import { PDFiumLibrary, PDFiumModule } from "@hyzyla/pdfium/inline";
import {
  type PdfiumOpenResult,
  type PdfiumRenderResult,
  type PdfiumRequest,
  type PdfiumResponse,
  type PdfiumWorkerData,
  pdfiumWorkerMain,
} from "./pdfium-worker";

// PDFium runs in one worker thread so a heavy page cannot stall the plugin's other requests, and
// so a crash or a runaway render costs only the worker: calls run one at a time, a call past its
// deadline terminates the worker, and the next call starts a fresh one. Paseo gives up on plugin
// RPCs after 30 s, so the deadline sits below that.
const CALL_DEADLINE_MS = 20_000;
const IDLE_SHUTDOWN_MS = 120_000;
const MAX_OPEN_DOCUMENTS = 4;

const WORKER_SOURCE = `const { parentPort, workerData } = require("node:worker_threads");
(${pdfiumWorkerMain.toString()})(parentPort, workerData, require);`;

let workerData: Promise<PdfiumWorkerData> | undefined;
let worker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 1;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
// Documents open in the current worker, oldest first. They die with it.
const openInWorker = new Map<string, true>();

// The inline build decodes its embedded WebAssembly in init() and hands the bytes to initBase;
// capture them there instead of starting PDFium on this thread.
async function wasmBytes(): Promise<ArrayBuffer> {
  const library = PDFiumLibrary as unknown as { initBase?: (options: { wasmBinary: ArrayBuffer }) => unknown };
  library.initBase = async (options) => options.wasmBinary;
  try {
    return (await PDFiumLibrary.init({ disableBase64Warning: true })) as unknown as ArrayBuffer;
  } finally {
    delete library.initBase;
  }
}

async function prepareWorkerData(): Promise<PdfiumWorkerData> {
  // Bundled, the loader refers to `import.meta` and a `_defineProperty` helper under names the
  // bundler chose; unbundled it reads `import.meta` directly. The worker supplies both.
  const glue = PDFiumModule.toString().replace(/\bimport\.meta\b/g, "import_meta");
  const importMetaName = /\b(import_meta\d*)\.url\b/.exec(glue)?.[1];
  const definePropertyName = /\b(_defineProperty\d*)\(this,/.exec(glue)?.[1];
  if (!importMetaName || !definePropertyName) throw new Error("Unexpected PDFium build: cannot start the renderer");
  const wasm = (globalThis as unknown as { WebAssembly: { compile(bytes: ArrayBuffer): Promise<object> } }).WebAssembly;
  return { glue, importMetaName, definePropertyName, wasm: await wasm.compile(await wasmBytes()) };
}

async function ensureWorker(): Promise<Worker> {
  const data = await (workerData ??= prepareWorkerData().catch((error: unknown) => {
    workerData = undefined;
    throw error;
  }));
  if (worker) return worker;
  const created = new Worker(WORKER_SOURCE, { eval: true, workerData: data });
  created.unref();
  created.on("message", (response: PdfiumResponse) => {
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.value);
    else {
      if (response.fatal) stopWorker(created);
      entry.reject(new Error(response.message));
    }
  });
  created.on("error", (error) => stopWorker(created, error));
  created.on("exit", (code) => stopWorker(created, new Error(`The PDF renderer stopped (exit code ${code})`)));
  worker = created;
  return created;
}

function stopWorker(target: Worker, error = new Error("The PDF renderer was restarted")): void {
  if (worker !== target) return;
  worker = undefined;
  openInWorker.clear();
  for (const [id, entry] of pending) {
    pending.delete(id);
    entry.reject(error);
  }
  void target.terminate();
}

// Calls run strictly one after another, each with its own deadline.
function call<T>(request: PdfiumRequest, transfer: ArrayBuffer[] = []): Promise<T> {
  const run = async (): Promise<T> => {
    clearTimeout(idleTimer);
    const target = await ensureWorker();
    const id = nextId++;
    try {
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          stopWorker(target);
          reject(new Error("Rendering the PDF took too long"));
        }, CALL_DEADLINE_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        target.postMessage({ id, ...request }, transfer);
      });
    } finally {
      idleTimer = setTimeout(() => worker && stopWorker(worker, new Error("Idle")), IDLE_SHUTDOWN_MS);
      idleTimer.unref?.();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

// Opens the document in the worker if needed. `key` must change whenever the file does.
export async function openPdfium(key: string, readBytes: () => Promise<Uint8Array>): Promise<PdfiumOpenResult> {
  const bytes = await readBytes();
  const result = await call<PdfiumOpenResult>({ op: "open", key, bytes }, [bytes.buffer as ArrayBuffer]);
  openInWorker.set(key, true);
  while (openInWorker.size > MAX_OPEN_DOCUMENTS) {
    const oldest = openInWorker.keys().next().value as string;
    openInWorker.delete(oldest);
    await call({ op: "close", key: oldest }).catch(() => undefined);
  }
  return result;
}

export async function renderPdfium(
  key: string,
  readBytes: () => Promise<Uint8Array>,
  page: number,
  width: number,
): Promise<PdfiumRenderResult> {
  if (openInWorker.has(key)) {
    openInWorker.delete(key);
    openInWorker.set(key, true);
  } else {
    await openPdfium(key, readBytes);
  }
  return call<PdfiumRenderResult>({ op: "render", key, page, width });
}

export async function closePdfium(key: string): Promise<void> {
  if (!openInWorker.delete(key)) return;
  await call({ op: "close", key }).catch(() => undefined);
}

export function shutdownPdfium(): void {
  clearTimeout(idleTimer);
  if (worker) stopWorker(worker, new Error("The plugin stopped"));
}
