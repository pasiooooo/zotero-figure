import * as assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import {
  buildGalleryFacetState,
  filterGalleryEntries,
} from "../src/features/gallery/galleryFilters";
import {
  reconcileFigureGalleryComparisonLayout,
  type FigureGalleryEntry,
  type FigureGalleryComparisonLayout,
} from "../src/domain/figureGallery";
import { GalleryLibraryLoadCoordinator } from "../src/features/gallery/galleryLibraryLoadCoordinator";
import { getGalleryInitialFilter } from "../src/features/gallery/galleryInitialFilter";
import { FigureGalleryController } from "../src/features/gallery/figureGalleryController";

test("sidebar Library preselects the document once while keeping every library entry and all filters available", async () => {
  const source = readFileSync(
    "src/features/gallery/figureGalleryView.ts",
    "utf8",
  );
  const functions = [
    ["function createLibraryLoader(", "function collectElements("],
    [
      "function persistComparisonLayout(",
      "function appendCardsToGalleryColumns(",
    ],
    ["function toggleLayoutMode(", "function updateLayoutModeControl("],
    ["function applyFilters(", "function renderResults("],
    ["function resetFilters(", "function toggleToolbar("],
  ]
    .map(([start, end]) =>
      source.slice(source.indexOf(start), source.indexOf(end)),
    )
    .join("\n");
  const entries = [
    { id: "later", attachmentID: 42, documentItemID: 10, tag: "Figure 1.10" },
    { id: "other-pdf", attachmentID: 43, documentItemID: 10, tag: "Table 1" },
    { id: "earlier", attachmentID: 42, documentItemID: 10, tag: "Formula 1.2" },
    {
      id: "other-document",
      attachmentID: 44,
      documentItemID: 11,
      tag: "Figure 1",
    },
  ].map((entry, index) => ({
    ...entry,
    libraryID: 7,
    kind: ["figure", "table", "formula", "figure"][index],
    year: "2026",
    collectionIDs: [1],
    collectionNames: ["Category"],
    comment: entry.tag,
    documentTitle: "Paper",
    pageIndex: 0,
  })) as FigureGalleryEntry[];
  const saved = reconcileFigureGalleryComparisonLayout(entries);
  const originalSaved = JSON.stringify(saved);
  for (const scoped of [true, false]) {
    let layoutWrites = 0;
    let viewWrites = 0;
    const galleryApi = {
      loadLibrary: async () => ({ collections: [], entries, libraryID: 7 }),
      getComparisonLayout: () => saved,
      setComparisonLayout: () => layoutWrites++,
      setViewMode: () => viewWrites++,
    };
    const context = {
      initialFilter: scoped ? { documentID: 10, libraryID: 7 } : undefined,
      allEntries: [] as FigureGalleryEntry[],
      allCollections: [],
      filteredEntries: [] as FigureGalleryEntry[],
      filteredEntryIDs: new Set(),
      selectionAnchorID: undefined,
      activeKeyword: "",
      entriesByID: new Map(),
      selectedEntryIDs: new Set(),
      selectedLibraryID: 7,
      committedLibraryID: undefined,
      comparisonLayout: undefined as FigureGalleryComparisonLayout | undefined,
      filterLabels: undefined,
      filterPanel: {
        values: {
          collectionID: "",
          documentID: "",
          keyword: "",
          kind: "",
          year: "",
        },
        render(state: {
          filters: {
            collectionID: string;
            documentID: string;
            keyword: string;
            kind: string;
            year: string;
          };
        }) {
          this.values = { ...state.filters };
        },
        reset() {
          this.values = {
            collectionID: "",
            documentID: "",
            keyword: "",
            kind: "",
            year: "",
          };
        },
      },
      viewMode: "waterfall",
      document: { createElement: () => ({ value: "", textContent: "" }) },
      elements: {
        keywordFilter: { value: "" },
      },
      window: { clearTimeout() {} },
      searchTimer: undefined,
      galleryApi,
      GalleryLibraryLoadCoordinator,
      buildGalleryFacetState,
      filterGalleryEntries,
      reconcileFigureGalleryComparisonLayout,
      buildGalleryFilterLabels: async () => ({
        allLabels: [
          "All documents",
          "All categories",
          "All years",
          "All types",
        ],
        kindLabels: { figure: "Figure", table: "Table", formula: "Formula" },
      }),
      updateSelectionControls() {},
      setControlsDisabled() {},
      showState() {},
      clearError() {},
      renderResults() {},
      updateLayoutModeControl() {},
      showError(error: unknown) {
        throw error;
      },
    };
    const api = runInNewContext(
      transformSync(functions, { loader: "ts" }).code +
        "\n({ createLibraryLoader, persistComparisonLayout, toggleLayoutMode, applyFilters, resetFilters })",
      context,
    ) as {
      createLibraryLoader(
        api: typeof galleryApi,
      ): GalleryLibraryLoadCoordinator<unknown>;
      persistComparisonLayout(): void;
      toggleLayoutMode(): void;
      applyFilters(): void;
      resetFilters(): void;
    };
    const loader = api.createLibraryLoader(galleryApi);
    await loader.load(7);
    assert.deepEqual(
      Array.from(context.allEntries, ({ id }) => id),
      entries.map(({ id }) => id),
    );
    assert.equal(context.filterPanel.values.documentID, scoped ? "10" : "");
    assert.equal(context.filteredEntries.length, scoped ? 3 : 4);
    assert.equal(context.initialFilter, undefined);
    api.persistComparisonLayout();
    api.toggleLayoutMode();
    assert.equal(layoutWrites, 2);
    assert.equal(viewWrites, 1);
    context.filterPanel.values.kind = "table";
    api.applyFilters();
    assert.deepEqual(
      context.filteredEntries.map(({ id }) => id),
      ["other-pdf"],
    );
    context.filterPanel.values.kind = "";
    context.filterPanel.values.documentID = "11";
    api.applyFilters();
    assert.deepEqual(
      context.filteredEntries.map(({ id }) => id),
      ["other-document"],
    );
    await loader.load(7);
    assert.equal(context.filterPanel.values.documentID, "11");
    api.resetFilters();
    assert.equal(context.filterPanel.values.documentID, "");
    assert.equal(context.filteredEntries.length, entries.length);
    await loader.load(7);
    assert.equal(context.filterPanel.values.documentID, "");
    assert.equal(JSON.stringify(saved), originalSaved);
    assert.equal(entries.length, 4);
  }
});

test("validates the initial document filter and its library", () => {
  const bootstrap = {
    defaultLibraryID: 1,
    libraries: [
      { id: 1, name: "Personal" },
      { id: 7, name: "Group" },
    ],
  };
  assert.deepEqual(
    getGalleryInitialFilter("?documentID=42&libraryID=7", bootstrap),
    { documentID: 42, libraryID: 7 },
  );
  for (const search of [
    "",
    "?documentID=42",
    "?libraryID=1",
    "?documentID=-1&libraryID=1",
    "?documentID=1.5&libraryID=1",
    "?documentID=42&libraryID=99",
    "?documentID=NaN&libraryID=1",
  ]) {
    assert.equal(getGalleryInitialFilter(search, bootstrap), undefined, search);
  }
});

test("opens maximized attachment windows, reuses an open window and closes them on disposal", () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  globals.addon = { data: {} } as typeof addon;
  try {
    const opened: Array<{
      url: string;
      uri: string;
      window: Window;
      events: Map<string, () => void>;
    }> = [];
    let maximized = 0;
    let focused = 0;
    let closed = 0;
    const scheduled: Array<() => void> = [];
    const owner = {
      document: { getElementById: () => null },
      openDialog: (
        url: string,
        _name: string,
        _features: string,
        data: { wrappedJSObject: { uri: string } },
      ) => {
        const events = new Map<string, () => void>();
        let isClosed = false;
        const window = {
          document: { getElementById: () => ({ setAttribute() {} }) },
          get closed() {
            return isClosed;
          },
          maximize: () => maximized++,
          setTimeout: (callback: () => void) => scheduled.push(callback),
          focus: () => focused++,
          close() {
            isClosed = true;
            closed++;
            events.get("unload")?.();
          },
          addEventListener: (type: string, callback: () => void) =>
            events.set(type, callback),
        } as unknown as Window;
        opened.push({ url, uri: data.wrappedJSObject.uri, window, events });
        return window;
      },
    } as unknown as Window;
    const controller = new FigureGalleryController(owner);
    const attachment = {
      id: 42,
      libraryID: 7,
      parentItemID: 10,
    } as Zotero.Item;
    controller.openAttachment(attachment);
    assert.equal(
      opened[0].url,
      "chrome://zotero/content/standalone/basicViewer.xhtml",
    );
    assert.match(opened[0].uri, /libraryID=7&documentID=10/);
    opened[0].events.get("unload")?.();
    controller.openAttachment(attachment);
    assert.equal(opened.length, 1);
    opened[0].events.get("load")!();
    assert.equal(maximized, 1);
    scheduled.shift()!();
    controller.openAttachment(attachment);
    assert.equal(opened.length, 1);
    assert.equal(maximized, 3);
    assert.equal(focused, 2);
    opened[0].window.close();
    controller.openAttachment(attachment);
    controller.openAttachment({ id: 43, libraryID: 7 } as Zotero.Item);
    assert.match(opened[2].uri, /libraryID=7&documentID=43/);
    opened[1].events.get("load")!();
    opened[2].events.get("load")!();
    assert.equal(opened.length, 3);
    controller.dispose();
    assert.equal(closed, 3);
    for (const callback of scheduled) callback();
    assert.equal(maximized, 3);
    scheduled.length = 0;
    controller.open();
    assert.equal(opened.length, 4);
    assert.match(opened[3].uri, /toolbar=collapsed/);
    assert.doesNotMatch(opened[3].uri, /documentID|libraryID/);
    opened[3].events.get("load")!();
    scheduled.shift()!();
    controller.open();
    assert.equal(opened.length, 4);
    assert.equal(maximized, 5);
    assert.equal(focused, 3);
    opened[3].window.close();
    controller.open();
    assert.equal(opened.length, 5);
    controller.dispose();
    assert.equal(closed, 5);
  } finally {
    globals.addon = previousAddon;
  }
});

test("sidebar startup retains the main Library view mode and defaults only its toolbar to collapsed", async () => {
  const source = readFileSync(
    "src/features/gallery/figureGalleryView.ts",
    "utf8",
  );
  const code = transformSync(
    source.slice(
      source.indexOf("async function initialize("),
      source.indexOf("function createLibraryLoader("),
    ) +
      source.slice(
        source.indexOf("function toggleToolbar("),
        source.indexOf("function toggleScalePopover("),
      ),
    { loader: "ts" },
  ).code;
  for (const search of [
    "?documentID=10&libraryID=7",
    "?toolbar=collapsed",
    "",
  ]) {
    const fromSidebar = search.includes("documentID");
    const collapsed = search !== "";
    const classes = new Set<string>();
    const attributes = new Map<string, string>([["aria-expanded", "true"]]);
    const loaded: number[] = [];
    let focusCalls = 0;
    const elements = {
      filterToolbar: {
        classList: {
          contains: (name: string) => classes.has(name),
          toggle: (name: string, enabled: boolean) =>
            enabled ? classes.add(name) : classes.delete(name),
        },
      },
      toolbarToggle: {
        title: "",
        setAttribute: (name: string, value: string) =>
          attributes.set(name, value),
      },
      keywordFilter: { focus: () => focusCalls++ },
    };
    const context = {
      elements,
      disposed: false,
      imageScale: 100,
      viewMode: "waterfall",
      initialFilter: undefined,
      selectedLibraryID: undefined,
      galleryApi: undefined,
      imageLoader: undefined,
      libraryLoader: undefined,
      unsubscribeFormulaLatex: undefined,
      window: {
        location: { search },
      },
      URLSearchParams,
      getGalleryInitialFilter,
      collectElements: () => elements,
      resolveGalleryApi: () => ({
        getViewMode: () => "document-columns",
        subscribeFormulaLatex: () => () => {},
        getBootstrap: async () => ({
          defaultLibraryID: 1,
          libraries: [{ id: 1 }, { id: 7 }],
        }),
      }),
      GalleryImageLoadCoordinator: class {},
      createLibraryLoader: () => ({}),
      loadLibrary: async (libraryID: number) => {
        loaded.push(libraryID);
      },
      getLocalization: () => undefined,
      filterPanel: { close() {} },
      closeScalePopover() {},
      bindControls() {},
      installGalleryResizeObserver() {},
      setGalleryImageScale() {},
      updateLayoutModeControl() {},
      applyFormulaLatexUpdate() {},
      showState() {},
      setControlsDisabled() {},
      showError(error: unknown) {
        throw error;
      },
    };
    const api = runInNewContext(
      code + "\n({ initialize, toggleToolbar })",
      context,
    ) as {
      initialize(): Promise<void>;
      toggleToolbar(): void;
    };
    await api.initialize();
    assert.equal(context.viewMode, "document-columns");
    assert.deepEqual(loaded, [fromSidebar ? 7 : 1]);
    assert.equal(classes.has("is-collapsed"), collapsed);
    assert.equal(attributes.get("aria-expanded"), String(!collapsed));
    assert.equal(focusCalls, 0);
    api.toggleToolbar();
    assert.equal(classes.has("is-collapsed"), !collapsed);
    assert.equal(attributes.get("aria-expanded"), String(collapsed));
  }
});
