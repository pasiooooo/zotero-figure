import type { FigureGalleryBootstrap } from "../../domain/figureGallery";

export function getGalleryInitialFilter(
  search: string,
  bootstrap: FigureGalleryBootstrap,
): { documentID: number; libraryID: number } | undefined {
  const params = new URLSearchParams(search);
  const documentID = Number(params.get("documentID"));
  const libraryID = Number(params.get("libraryID"));
  if (
    !Number.isSafeInteger(documentID) ||
    documentID <= 0 ||
    !bootstrap.libraries.some(({ id }) => id === libraryID)
  )
    return undefined;
  return { documentID, libraryID };
}
