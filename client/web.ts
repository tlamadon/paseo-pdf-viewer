import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage:
  | { getItem(key: string): string | null; setItem(key: string, value: string): void }
  | undefined;

const DOCUMENTS_KEY = "paseo-pdf-viewer:documents";

// Paseo resolves a restored tab's panel once, when the tab first renders, so remembered documents
// must be registered synchronously during setup. Web and desktop clients can read this copy of the
// daemon's list synchronously; native clients have no synchronous storage and get [].
export function readCachedDocuments(): string[] {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DOCUMENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function writeCachedDocuments(absolutePaths: string[]): void {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(absolutePaths));
  } catch {
    // Storage can be full or disabled; the daemon's list still restores tabs on the next mount.
  }
}

declare const document:
  | {
      createElement(tag: "a"): { href: string; download: string; click(): void; remove(): void };
      body: { appendChild(node: unknown): void };
    }
  | undefined;

// Browser versions of these globals; the Node typings describe different shapes.
const browser = globalThis as unknown as {
  Blob: new (parts: Uint8Array[], options: { type: string }) => object;
  URL: { createObjectURL(blob: object): string; revokeObjectURL(url: string): void };
};

// Starts a browser download of base64 content. Only meaningful on web and desktop clients.
export function saveFileOnWeb(name: string, mimeType: string, base64: string): void {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    throw new Error("Downloads need the desktop or web app");
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const url = browser.URL.createObjectURL(new browser.Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => browser.URL.revokeObjectURL(url), 60_000);
}
