import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { Platform, Share } from "react-native";
import { DOWNLOAD_CHUNK_BYTES, type readPdfChunk } from "../shared/pdf";
import { saveFileOnWeb } from "./web";

type ReadChunk = (input: RpcInput<typeof readPdfChunk>) => Promise<RpcOutput<typeof readPdfChunk>>;

export const canDownload = Platform.OS === "web" || Platform.OS === "ios";

// Copies the PDF from the daemon to this device: a browser download on desktop and web, the share
// sheet (Save to Files, Mail, ...) on iOS. React Native's Android share sheet only takes text.
export async function downloadPdf(readChunk: ReadChunk, workspaceId: string, path: string): Promise<void> {
  if (!canDownload) throw new Error("Saving PDFs is not supported on this device");
  const parts: string[] = [];
  let name = "document.pdf";
  let size = Number.POSITIVE_INFINITY;
  let mtimeMs: number | undefined;
  for (let offset = 0; offset < size; offset += DOWNLOAD_CHUNK_BYTES) {
    const chunk = await readChunk({ workspaceId, path, offset, mtimeMs });
    ({ name, size, mtimeMs } = chunk);
    parts.push(chunk.base64);
  }
  const base64 = parts.join("");
  if (Platform.OS === "web") saveFileOnWeb(name, "application/pdf", base64);
  else await Share.share({ url: `data:application/pdf;base64,${base64}`, title: name });
}
