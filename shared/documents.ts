import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Each opened PDF gets its own workspace panel, so the app gives it its own tab. The daemon
// remembers them so tabs restored after an app reload find their panel again. Registered panels
// also appear in the New tab menu, so the list doubles as recent PDFs and stays short.
export const MAX_REMEMBERED_DOCUMENTS = 10;

export const openDocument = defineRpc({
  name: "pdf.documents.open",
  input: z.object({ directory: z.string(), path: z.string() }),
  output: z.object({
    absolutePath: z.string(),
    // The remembered list after this open, most recent first.
    remembered: z.array(z.string()),
  }),
});

export const listDocuments = defineRpc({
  name: "pdf.documents.list",
  input: z.object({}),
  output: z.object({ absolutePaths: z.array(z.string()) }),
});

// Panel ids must match /^[a-z][a-z0-9-]*$/; a 32-bit FNV-1a hash of the path keeps them stable.
export function documentPanelId(absolutePath: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < absolutePath.length; index++) {
    hash ^= absolutePath.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `doc-${hash.toString(16).padStart(8, "0")}`;
}
