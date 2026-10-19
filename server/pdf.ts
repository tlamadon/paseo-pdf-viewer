import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type * as Mupdf from "mupdf";
import type { listPdfs, pdfInfo, renderPage } from "../shared/pdf";
import { PLUGIN_ROOT } from "./plugin-root.generated";

// Paseo bundles server code into one evaluated script, so mupdf (ESM with a sibling .wasm file)
// cannot be bundled. Load it from the plugin's own node_modules at runtime instead.
let mupdfModule: Promise<typeof Mupdf> | null = null;
function loadMupdf(): Promise<typeof Mupdf> {
  mupdfModule ??= import(
    pathToFileURL(path.join(PLUGIN_ROOT, "node_modules/mupdf/dist/mupdf.js")).href
  ) as Promise<typeof Mupdf>;
  return mupdfModule;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "target", "__pycache__"]);
const MAX_LISTED = 500;
const MAX_DEPTH = 8;

export async function listPdfFiles({
  directory,
}: RpcInput<typeof listPdfs>): Promise<RpcOutput<typeof listPdfs>> {
  const root = resolveDirectory(directory);
  const files: RpcOutput<typeof listPdfs>["files"] = [];
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_LISTED) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIPPED_DIRECTORIES.has(entry.name)) await walk(full, depth + 1);
      } else if (entry.isFile() && isPdfName(entry.name)) {
        const info = await stat(full).catch(() => null);
        if (info) files.push({ path: path.relative(root, full), size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }

  await walk(root, 0);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { files, truncated };
}

export async function readPdfInfo(input: RpcInput<typeof pdfInfo>): Promise<RpcOutput<typeof pdfInfo>> {
  const { absolutePath, mtimeMs, doc, aspects } = await openPdf(input.directory, input.path);
  return { absolutePath, title: doc.getMetaData("info:Title") || null, mtimeMs, aspects };
}

const renderedPages = new Map<string, RpcOutput<typeof renderPage>>();
const MAX_RENDERED_PAGES = 40;

export async function renderPdfPage(input: RpcInput<typeof renderPage>): Promise<RpcOutput<typeof renderPage>> {
  const mupdf = await loadMupdf();
  const { absolutePath, mtimeMs, doc } = await openPdf(input.directory, input.path);
  const key = `${absolutePath}|${mtimeMs}|${input.page}|${input.width}`;
  const cached = renderedPages.get(key);
  if (cached) return touch(renderedPages, key, cached);

  if (input.page >= doc.countPages()) throw new Error(`Page ${input.page + 1} does not exist`);
  const page = doc.loadPage(input.page);
  const [x0, , x1] = page.getBounds();
  const scale = input.width / (x1 - x0);
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  const result = {
    uri: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    width: pixmap.getWidth(),
    height: pixmap.getHeight(),
  };
  pixmap.destroy();
  page.destroy();
  return remember(renderedPages, key, result, MAX_RENDERED_PAGES);
}

interface OpenDocument {
  absolutePath: string;
  mtimeMs: number;
  doc: Mupdf.Document;
  aspects: number[];
}

const openDocuments = new Map<string, OpenDocument>();
const MAX_OPEN_DOCUMENTS = 4;

async function openPdf(directory: string, requested: string): Promise<OpenDocument> {
  const absolutePath = resolvePdfPath(directory, requested);
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`No such PDF: ${absolutePath}`);

  const cached = openDocuments.get(absolutePath);
  if (cached && cached.mtimeMs === info.mtimeMs) return touch(openDocuments, absolutePath, cached);
  if (cached) {
    cached.doc.destroy();
    openDocuments.delete(absolutePath);
  }

  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(await readFile(absolutePath), "application/pdf");
  if (doc.needsPassword()) {
    doc.destroy();
    throw new Error("Password-protected PDFs are not supported");
  }
  const aspects: number[] = [];
  for (let index = 0; index < doc.countPages(); index++) {
    const page = doc.loadPage(index);
    const [x0, y0, x1, y1] = page.getBounds();
    page.destroy();
    aspects.push((x1 - x0) / (y1 - y0 || 1));
  }
  const opened = { absolutePath, mtimeMs: info.mtimeMs, doc, aspects };
  remember(openDocuments, absolutePath, opened, MAX_OPEN_DOCUMENTS, (evicted) => evicted.doc.destroy());
  return opened;
}

function resolveDirectory(directory: string): string {
  return path.resolve(expandHome(directory));
}

export function resolvePdfPath(directory: string, requested: string): string {
  const trimmed = requested.trim().replace(/^["']|["']$/g, "");
  const absolutePath = path.resolve(resolveDirectory(directory), expandHome(trimmed));
  if (!isPdfName(absolutePath)) throw new Error(`Not a PDF file: ${absolutePath}`);
  return absolutePath;
}

function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? path.join(homedir(), value.slice(1)) : value;
}

function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

// Maps keep insertion order, so re-inserting on access gives a small LRU.
function touch<V>(cache: Map<string, V>, key: string, value: V): V {
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function remember<V>(
  cache: Map<string, V>,
  key: string,
  value: V,
  limit: number,
  onEvict?: (value: V) => void,
): V {
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as string;
    onEvict?.(cache.get(oldest) as V);
    cache.delete(oldest);
  }
  return value;
}

export function closeAllDocuments(): void {
  for (const { doc } of openDocuments.values()) doc.destroy();
  openDocuments.clear();
  renderedPages.clear();
}
