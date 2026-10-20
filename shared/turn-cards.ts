import { z } from "zod";

// A card the daemon appends to an agent's conversation when a turn changed PDFs in its workspace.
export const TURN_CARD_KIND = "pdf-turn-files";
export const TURN_CARD_VERSION = 1;
export const MAX_TURN_CARD_FILES = 8;

export const turnCardSchema = z.object({
  workspaceId: z.string(),
  files: z.array(z.object({ path: z.string(), size: z.number() })).max(MAX_TURN_CARD_FILES),
  // Changed PDFs beyond the ones listed.
  more: z.number().int().min(0),
});

export type TurnCardData = z.infer<typeof turnCardSchema>;
