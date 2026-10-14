import { config } from "../package.json";
import {
  registerPrefs,
  registerPrefsScripts,
} from "./features/preferences/preferenceScript";
import { FigureGalleryController } from "./features/gallery/figureGalleryController";
import { FigureBatchController } from "./features/library/figureBatchController";
import { AutoAnalysisController } from "./features/library/autoAnalysisController";
import { FigureReaderController } from "./features/reader/figureReaderController";
import { registerApplicationShutdownTask } from "./platform/zotero/applicationShutdown";
import { LayoutAnalyzer } from "./services/layout/layoutAnalyzer";
import { FormulaLatexCoordinator } from "./services/formula/formulaLatexCoordinator";
import { FigureGalleryIndex } from "./services/results/figureGalleryIndex";
import {
  flushComparisonLayouts,
  loadComparisonLayouts,
} from "./services/results/figureGalleryComparisonStore";
import {
  getFigureGalleryComparisonLayout,
  getFigureGalleryImageScale,
  getFigureGalleryViewMode,
  setFigureGalleryComparisonLayout,
  setFigureGalleryImageScale,
  setFigureGalleryViewMode,
} from "./services/results/figureGalleryPreferences";
import { FigureResultStore } from "./services/results/figureResultStore";
import { migrateForkData } from "./services/results/migrateForkData";
import { initLocale } from "./utils/locale";

const controllers = new Map<Window, FigureReaderController>();
const galleryControllers = new Map<Window, FigureGalleryController>();
let services: HookServices | undefined;
let unregisterShutdownFlush: (() => void) | undefined;

async function onStartup(): Promise<void> {
  await waitForZotero();
  await migrateForkData();
  initLocale();
  await registerPrefs();
  await loadComparisonLayouts();
  unregisterShutdownFlush = registerApplicationShutdownTask(
    flushComparisonLayouts,
  );
  const {
    autoAnalysisController,
    batchController,
    formulaLatex,
    galleryIndex,
  } = ensureServices();
  addon.api.gallery = {
    getBootstrap: () => galleryIndex.getBootstrap(),
    getComparisonLayout: (libraryID: number) =>
      getFigureGalleryComparisonLayout(libraryID),
    getImageScale: () => getFigureGalleryImageScale(),
    getViewMode: () => getFigureGalleryViewMode(),
    loadLibrary: (libraryID: number) => galleryIndex.loadLibrary(libraryID),
    openSource: (entryID: string) => galleryIndex.openSource(entryID),
    readImage: (entryID: string) => galleryIndex.readImage(entryID),
    runBatch: async (entryIDs: string[], action: "delete" | "export") => {
      const outcome = await galleryIndex.runBatch(entryIDs, action);
      if (action === "delete" && outcome?.completedIDs.length) {
        for (const controller of controllers.values())
          controller.reloadResults();
      }
      return outcome;
    },
    setComparisonLayout: setFigureGalleryComparisonLayout,
    setImageScale: setFigureGalleryImageScale,
    setViewMode: setFigureGalleryViewMode,
    subscribeFormulaLatex: (
      listener: (entryID: string, latex: string) => void,
    ) =>
      formulaLatex.subscribe((update) =>
        listener(
          `${update.libraryID}:${update.attachmentKey}:${update.result.id}`,
          update.result.latex ?? "",
        ),
      ),
  };
  batchController.start();
  autoAnalysisController.start();
  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  if (controllers.has(win)) return;
  const { formulaLatex, layoutAnalyzer, resultStore, galleryIndex } =
    ensureServices();
  const galleryController = new FigureGalleryController(win);
  galleryControllers.set(win, galleryController);
  galleryController.start();
  const controller = new FigureReaderController(win, {
    formulaLatex,
    layoutAnalyzer,
    resultStore,
    galleryIndex,
    openGallery: (attachment) => galleryController.openAttachment(attachment),
  });
  controllers.set(win, controller);
  controller.start();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const controller = controllers.get(win);
  if (controller) {
    controllers.delete(win);
    controller.dispose();
  }
  const galleryController = galleryControllers.get(win);
  if (galleryController) {
    galleryControllers.delete(win);
    galleryController.dispose();
  }
}

async function onShutdown(): Promise<void> {
  const initialized = services;
  initialized?.autoAnalysisController.dispose();
  initialized?.batchController.dispose();
  for (const controller of [...controllers.values()].reverse()) {
    controller.dispose();
  }
  controllers.clear();
  for (const controller of [...galleryControllers.values()].reverse()) {
    controller.dispose();
  }
  galleryControllers.clear();
  delete addon.api.gallery;
  try {
    await flushComparisonLayouts();
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
  unregisterShutdownFlush?.();
  unregisterShutdownFlush = undefined;
  initialized?.formulaLatex.dispose();
  initialized?.layoutAnalyzer.dispose();
  services = undefined;
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  delete (Zotero as typeof Zotero & Record<string, unknown>)[
    config.addonInstance
  ];
}

async function onPrefsEvent(
  type: string,
  data: { window: Window },
): Promise<void> {
  if (type === "load") {
    const { formulaLatex } = ensureServices();
    registerPrefsScripts(data.window, {
      openGallery: openFigureGallery,
      recognizeExistingFormulae: (onProgress, signal) =>
        formulaLatex.recognizeStoredFormulae(onProgress, signal),
    });
  }
}

function openFigureGallery(): void {
  const mainWindow = Zotero.getMainWindow();
  if (!mainWindow) return;
  const controller = galleryControllers.get(mainWindow);
  if (!controller) return;
  controller.open();
}

interface HookServices {
  autoAnalysisController: AutoAnalysisController;
  batchController: FigureBatchController;
  formulaLatex: FormulaLatexCoordinator;
  galleryIndex: FigureGalleryIndex;
  layoutAnalyzer: LayoutAnalyzer;
  resultStore: FigureResultStore;
}

function ensureServices(): HookServices {
  if (services) return services;
  const resultStore = new FigureResultStore();
  const galleryIndex = new FigureGalleryIndex(resultStore);
  const layoutAnalyzer = new LayoutAnalyzer(resultStore);
  const formulaLatex = new FormulaLatexCoordinator(resultStore);
  const autoAnalysisController = new AutoAnalysisController(
    layoutAnalyzer,
    async (attachment, signal) => {
      for (const controller of controllers.values())
        controller.reloadResults(attachment.id);
      await formulaLatex.recognizeAttachment(attachment, signal);
    },
  );
  const batchController = new FigureBatchController(
    layoutAnalyzer,
    resultStore,
    formulaLatex,
  );
  services = {
    autoAnalysisController,
    batchController,
    formulaLatex,
    galleryIndex,
    layoutAnalyzer,
    resultStore,
  };
  return services;
}

async function waitForZotero(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
