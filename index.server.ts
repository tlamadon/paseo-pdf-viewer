import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listRememberedDocuments, openPdfDocument } from "./server/documents";
import { closeAllDocuments, listPdfFiles, readPdfInfo, renderPdfPage } from "./server/pdf";
import { listDocuments, openDocument } from "./shared/documents";
import { listPdfs, pdfInfo, renderPage } from "./shared/pdf";

export default function contribute(server: PluginServerContext) {
  server.handle(listPdfs, listPdfFiles);
  server.handle(pdfInfo, readPdfInfo);
  server.handle(renderPage, renderPdfPage);
  server.handle(openDocument, openPdfDocument);
  server.handle(listDocuments, listRememberedDocuments);
  return closeAllDocuments;
}
