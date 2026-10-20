import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listRememberedDocuments, openPdfDocument } from "./server/documents";
import { closeAllDocuments, listPdfFiles, readPdfFileChunk, readPdfInfo, renderPdfPage } from "./server/pdf";
import { forgetAgent, turnEnded, turnStarted } from "./server/turn-cards";
import { listDocuments, openDocument } from "./shared/documents";
import { listPdfs, pdfInfo, readPdfChunk, renderPage } from "./shared/pdf";

export default function contribute(server: PluginServerContext) {
  server.handle(listPdfs, listPdfFiles);
  server.handle(pdfInfo, readPdfInfo);
  server.handle(renderPage, renderPdfPage);
  server.handle(readPdfChunk, readPdfFileChunk);
  server.handle(openDocument, openPdfDocument);
  server.handle(listDocuments, listRememberedDocuments);
  const unsubscribe = [
    server.on("agent.turn_started", turnStarted),
    server.on("agent.turn_ended", (event, context) =>
      turnEnded(event, context).catch((error: unknown) => console.error("[pdf-viewer] turn card failed:", error)),
    ),
    server.on("agent.closed", ({ agent }) => forgetAgent(agent.id)),
    server.on("agent.archived", ({ agent }) => forgetAgent(agent.id)),
  ];
  return () => {
    for (const stop of unsubscribe) stop();
    closeAllDocuments();
  };
}
