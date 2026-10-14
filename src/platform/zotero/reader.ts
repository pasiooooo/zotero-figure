export type PdfReader = _ZoteroTypes.ReaderInstance<"pdf">;

export function openReaderSidebar(reader: PdfReader): void {
  // Reader's proxy exposes toggleSidebar in newer Zotero versions.
  const api = reader as PdfReader & { toggleSidebar?: (open: boolean) => void };
  if (typeof api.toggleSidebar === "function") api.toggleSidebar(true);
  else if (typeof reader._internalReader?.toggleSidebar === "function")
    reader._internalReader.toggleSidebar(true);
  else if (typeof reader.setSidebarOpen === "function")
    reader.setSidebarOpen(true);
}
