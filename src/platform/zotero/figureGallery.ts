import type {
  FigureGalleryCollection,
  FigureGalleryLibrary,
} from "../../domain/figureGallery";
import type { Rect } from "../../domain/layout";
import type { FigureResultRecord } from "../../domain/figureResults";
import { getString } from "../../utils/locale";
import { removeGeneratedAnnotationForCandidate } from "./annotations";

export interface FigureGalleryPlatform {
  chooseExportDirectory(): Promise<string | false>;
  exportImage(path: string, directory: string, filename: string): Promise<void>;
  getAttachment(libraryID: number, key: string): Promise<Zotero.Item | false>;
  getCollectionName(collectionID: number): string | undefined;
  getDefaultLibraryID(): number;
  listLibraries(): FigureGalleryLibrary[];
  listCollections(libraryID: number): FigureGalleryCollection[];
  logError(error: Error): void;
  openPdf(attachmentID: number, pageIndex: number, rect: Rect): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  removeAnnotation(
    item: Zotero.Item,
    result: FigureResultRecord,
  ): Promise<void>;
}

interface ZoteroPaneLibrarySelection {
  getSelectedLibraryID?(): number;
  getSelectedLibraryIDs?(): number[];
}

function getSelectedLibraryID(): number | undefined {
  const pane = Zotero.getActiveZoteroPane() as
    | ZoteroPaneLibrarySelection
    | undefined;
  const selectedLibraryIDs = pane?.getSelectedLibraryIDs?.();
  const selected =
    selectedLibraryIDs?.find((libraryID) => Number.isInteger(libraryID)) ??
    pane?.getSelectedLibraryID?.();
  return Number.isInteger(selected) ? selected : undefined;
}

export function createZoteroFigureGalleryPlatform(): FigureGalleryPlatform {
  return {
    chooseExportDirectory: () =>
      new ztoolkit.FilePicker(
        getString("gallery-export-selected"),
        "folder",
      ).open(),
    exportImage: (path, directory, filename) =>
      IOUtils.copy(path, PathUtils.join(directory, filename), {
        noOverwrite: true,
      }),
    getAttachment: (libraryID, key) =>
      Zotero.Items.getByLibraryAndKeyAsync(libraryID, key),
    getCollectionName: (collectionID) =>
      Zotero.Collections.get(collectionID)?.name,
    getDefaultLibraryID: () =>
      getSelectedLibraryID() ?? Zotero.Libraries.userLibraryID,
    listLibraries: () =>
      Zotero.Libraries.getAll()
        .filter(({ libraryType }) => libraryType !== "feed")
        .map(({ libraryID, name }) => ({ id: libraryID, name })),
    listCollections: (libraryID) =>
      Zotero.Collections.getByLibrary(libraryID, true).map(
        ({ id, name, parentID }) => ({
          id,
          name,
          parentID: parentID || null,
        }),
      ),
    logError: (error) => Zotero.logError(error),
    openPdf: async (attachmentID, pageIndex, rect) => {
      await Zotero.Reader.open(
        attachmentID,
        { position: { pageIndex, rects: [rect] } },
        { openInBackground: false },
      );
    },
    readFile: (path) => IOUtils.read(path),
    removeAnnotation: async (item, result) => {
      await removeGeneratedAnnotationForCandidate(item, result);
    },
  };
}
