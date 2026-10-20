import type { Dirent } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  DOWNLOAD_CHUNK_BYTES,
  type listPdfs,
  MAX_DOWNLOAD_BYTES,
  type pdfInfo,
  type readPdfChunk,
  type renderPage,
} from "../shared/pdf";
import { closePdfium, openPdfium, renderPdfium, shutdownPdfium } from "./pdfium";
import { resolveInWorkspace, workspaceRoot } from "./workspace";

type Context = PluginHandlerContext;

const SKIPPED_DIRECTORIES = new Set(["node_modules", "target", "__pycache__"]);
const MAX_LISTED = 500;
const MAX_DEPTH = 8;

export interface ScannedPdf {
  path: string;
  size: number;
  mtimeMs: number;
}

// PDFs under `root`, newest first, as workspace-relative paths. Skips hidden folders.
export async function scanPdfs(root: string): Promise<{ files: ScannedPdf[]; truncated: boolean }> {
  const files: ScannedPdf[] = [];
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

export async function listPdfFiles(
  { workspaceId }: RpcInput<typeof listPdfs>,
  { paseo }: Context,
): Promise<RpcOutput<typeof listPdfs>> {
  return scanPdfs(await workspaceRoot(paseo, workspaceId));
}

// The resolved, workspace-confined path of a PDF the client named.
export async function resolvePdf(paseo: Context["paseo"], workspaceId: string, requested: string): Promise<string> {
  const absolutePath = await resolveInWorkspace(await workspaceRoot(paseo, workspaceId), requested);
  if (!isPdfName(absolutePath)) throw new Error(`Not a PDF file: ${path.basename(absolutePath)}`);
  return absolutePath;
}

interface DocumentInfo {
  key: string;
  absolutePath: string;
  mtimeMs: number;
  title: string | null;
  aspects: number[];
}

// Page sizes and titles, keyed by path and modification time, so polling for changes is cheap.
const documentInfo = new Map<string, DocumentInfo>();
const MAX_DOCUMENT_INFO = 20;

async function loadDocument(paseo: Context["paseo"], workspaceId: string, requested: string): Promise<DocumentInfo> {
  const absolutePath = await resolvePdf(paseo, workspaceId, requested);
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`No such PDF: ${path.basename(absolutePath)}`);
  const key = `${absolutePath}|${info.mtimeMs}`;
  const cached = documentInfo.get(key);
  if (cached) return touch(documentInfo, key, cached);

  const opened = await openPdfium(key, () => readFile(absolutePath));
  // A rebuilt file gets a new key; close the old version.
  for (const [oldKey, old] of documentInfo) {
    if (old.absolutePath !== absolutePath) continue;
    documentInfo.delete(oldKey);
    void closePdfium(oldKey);
  }
  const loaded = { key, absolutePath, mtimeMs: info.mtimeMs, ...opened };
  return remember(documentInfo, key, loaded, MAX_DOCUMENT_INFO);
}

export async function readPdfInfo(input: RpcInput<typeof pdfInfo>, { paseo }: Context): Promise<RpcOutput<typeof pdfInfo>> {
  const { absolutePath, title, mtimeMs, aspects } = await loadDocument(paseo, input.workspaceId, input.path);
  return { absolutePath, title, mtimeMs, aspects };
}

const renderedPages = new Map<string, RpcOutput<typeof renderPage>>();
const MAX_RENDERED_PAGES = 40;

export async function renderPdfPage(
  input: RpcInput<typeof renderPage>,
  { paseo }: Context,
): Promise<RpcOutput<typeof renderPage>> {
  const document = await loadDocument(paseo, input.workspaceId, input.path);
  const cacheKey = `${document.key}|${input.page}|${input.width}`;
  const cached = renderedPages.get(cacheKey);
  if (cached) return touch(renderedPages, cacheKey, cached);
  if (input.page >= document.aspects.length) throw new Error(`Page ${input.page + 1} does not exist`);

  const { png, width, height } = await renderPdfium(
    document.key,
    () => readFile(document.absolutePath),
    input.page,
    input.width,
  );
  const result = { uri: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, width, height };
  return remember(renderedPages, cacheKey, result, MAX_RENDERED_PAGES);
}

export async function readPdfFileChunk(
  input: RpcInput<typeof readPdfChunk>,
  { paseo }: Context,
): Promise<RpcOutput<typeof readPdfChunk>> {
  const absolutePath = await resolvePdf(paseo, input.workspaceId, input.path);
  const file = await open(absolutePath, "r").catch(() => null);
  if (!file) throw new Error(`No such PDF: ${path.basename(absolutePath)}`);
  try {
    const info = await file.stat();
    if (info.size > MAX_DOWNLOAD_BYTES) throw new Error("PDF is too large to download through Paseo");
    if (input.mtimeMs !== undefined && input.mtimeMs !== info.mtimeMs) {
      throw new Error("The PDF changed during the download. Try again.");
    }
    const length = Math.max(0, Math.min(DOWNLOAD_CHUNK_BYTES, info.size - input.offset));
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, input.offset);
    return {
      name: path.basename(absolutePath),
      size: info.size,
      mtimeMs: info.mtimeMs,
      base64: buffer.subarray(0, bytesRead).toString("base64"),
    };
  } finally {
    await file.close();
  }
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

function remember<V>(cache: Map<string, V>, key: string, value: V, limit: number): V {
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value as string);
  return value;
}

export function closeAllDocuments(): void {
  documentInfo.clear();
  renderedPages.clear();
  shutdownPdfium();
}
