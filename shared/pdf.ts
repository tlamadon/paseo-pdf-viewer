import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The daemon resolves `path` inside the workspace's directory, relative or absolute, and refuses
// anything outside it. Clients never name a directory.
const fileRef = z.object({ workspaceId: z.string(), path: z.string() });

export const listPdfs = defineRpc({
  name: "pdf.list",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({
    files: z.array(z.object({ path: z.string(), size: z.number(), mtimeMs: z.number() })),
    truncated: z.boolean(),
  }),
});

export const pdfInfo = defineRpc({
  name: "pdf.info",
  input: fileRef,
  output: z.object({
    absolutePath: z.string(),
    title: z.string().nullable(),
    mtimeMs: z.number(),
    // Width / height of each page, so the viewer can lay out pages before they render.
    aspects: z.array(z.number()),
  }),
});

export const renderPage = defineRpc({
  name: "pdf.page",
  input: fileRef.extend({
    page: z.number().int().min(0),
    width: z.number().int().min(100).max(4000),
    // Part of the cache key: a rebuilt PDF renders fresh pages.
    mtimeMs: z.number(),
  }),
  output: z.object({ uri: z.string(), width: z.number(), height: z.number() }),
});

// Base64 pieces concatenate cleanly only when every piece but the last is a multiple of 3 bytes.
export const DOWNLOAD_CHUNK_BYTES = 3 * 350_000;
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export const readPdfChunk = defineRpc({
  name: "pdf.chunk",
  input: fileRef.extend({
    offset: z.number().int().min(0),
    // Every piece of one download must come from the same version of the file.
    mtimeMs: z.number().optional(),
  }),
  output: z.object({ name: z.string(), size: z.number(), mtimeMs: z.number(), base64: z.string() }),
});
