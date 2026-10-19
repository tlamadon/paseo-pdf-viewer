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
