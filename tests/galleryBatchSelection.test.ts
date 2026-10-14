import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync(
  "src/features/gallery/figureGalleryView.ts",
  "utf8",
);
const batchFunctions = transformSync(
  source.slice(
    source.indexOf("function getSelectionOrder("),
    source.indexOf("function handleGalleryWindowDragOver("),
  ) +
    source.slice(
      source.indexOf("function handleGalleryContextMenu("),
      source.indexOf("async function openGalleryContextMenu("),
    ),
  { loader: "ts" },
).code;

class TestElement {
  constructor(
    readonly editable = false,
    readonly dataset: Record<string, string> = {},
  ) {}
  selected = false;
  attributes = new Map<string, string>();
  classList = {
    toggle: (_name: string, value: boolean) => {
      this.selected = value;
    },
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  closest(selector: string): TestElement | null {
    if (selector === ".gallery-card") return this.dataset.id ? this : null;
    return selector.includes("textarea") && this.editable ? this : null;
  }
  focus() {}
}

function createView() {
  const cards = ["one", "two"].map((id) => new TestElement(false, { id }));
  const calls: string[][] = [];
  const errors: unknown[] = [];
  const confirmations: Record<string, number | string>[] = [];
  const menuTargets: unknown[] = [];
  const entries = [
    { id: "one", kind: "figure" },
    { id: "two", kind: "formula" },
    { id: "not-rendered", kind: "table" },
  ];
  const view = {
    Element: TestElement,
    selectedEntryIDs: new Set<string>(),
    selectionAnchorID: undefined as string | undefined,
    filteredEntries: entries,
    filteredEntryIDs: new Set(entries.map(({ id }) => id)),
    allEntries: entries,
    entriesByID: new Map(entries.map((entry) => [entry.id, entry])),
    viewMode: "waterfall",
    comparisonRows: [] as Array<{
      entries: Record<string, { entryIDs: string[] }>;
    }>,
    comparisonDocumentIDs: [] as number[],
    controlsDisabled: false,
    batchBusy: false,
    disposed: false,
    searchTimer: undefined,
    comparisonLayout: undefined,
    renderVersion: 1,
    galleryContextMenuRequestID: 0,
    window: { clearTimeout: () => undefined, confirm: () => true },
    localize: async (id: string, args: Record<string, number | string>) => {
      if (id === "gallery-confirm-delete") confirmations.push(args);
      return "confirm";
    },
    closeGalleryContextMenu: () => undefined,
    openGalleryContextMenu: async (target: unknown) => {
      menuTargets.push(target);
    },
    logGalleryError: (error: unknown) => errors.push(error),
    clearError: () => undefined,
    showError: (error: unknown) => errors.push(error),
    reconcileFigureGalleryComparisonLayout: () => undefined,
    persistComparisonLayout: () => undefined,
    applyFilters: () => undefined,
    setLocalizedText: () => undefined,
    setControlsDisabled: (disabled: boolean) => {
      view.controlsDisabled = disabled;
    },
    galleryApi: {
      runBatch: async (ids: string[]) => {
        calls.push(ids);
        return { completedIDs: ["one"], errors: ["two: disk failure"] };
      },
    },
    elements: {
      batchStatus: {
        textContent: "",
        hidden: true,
        removeAttribute: () => undefined,
      },
      galleryGrid: { querySelectorAll: () => cards },
    },
  };
  const api = runInNewContext(
    batchFunctions +
      "\n({ updateSelectionControls, runSelectedBatch, selectGalleryEntry, selectAllGalleryEntries, handleGallerySelectionKeydown, handleGalleryContextMenu });",
    view,
  ) as {
    updateSelectionControls(): void;
    runSelectedBatch(action: "delete" | "export"): Promise<void>;
    selectGalleryEntry(id: string, modifiers: typeof plain): void;
    selectAllGalleryEntries(): void;
    handleGallerySelectionKeydown(event: unknown): void;
    handleGalleryContextMenu(event: unknown): void;
  };
  return { view, api, calls, errors, cards, confirmations, menuTargets };
}
const plain = { ctrlKey: false, metaKey: false, shiftKey: false };
function keyEvent(key: string, target = new TestElement(), modifiers = plain) {
  return {
    ...modifiers,
    key,
    target,
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    repeat: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
}

test("plain click replaces selection; Ctrl/Cmd toggles cards and exposes pressed state", () => {
  const { view, api, cards } = createView();
  api.selectGalleryEntry("one", plain);
  api.selectGalleryEntry("two", plain);
  assert.deepEqual([...view.selectedEntryIDs], ["two"]);
  api.selectGalleryEntry("one", { ...plain, ctrlKey: true });
  assert.equal(view.selectedEntryIDs.size, 2);
  assert.equal(cards[0].attributes.get("aria-pressed"), "true");
  api.selectGalleryEntry("two", { ...plain, metaKey: true });
  assert.deepEqual([...view.selectedEntryIDs], ["one"]);
  assert.equal(cards[1].selected, false);
});

test("Shift selects a range in both directions and Ctrl+Shift extends selection", () => {
  const { view, api } = createView();
  api.selectGalleryEntry("one", plain);
  api.selectGalleryEntry("not-rendered", { ...plain, shiftKey: true });
  assert.deepEqual([...view.selectedEntryIDs], ["one", "two", "not-rendered"]);
  api.selectGalleryEntry("two", { ...plain, shiftKey: true });
  assert.deepEqual([...view.selectedEntryIDs], ["one", "two"]);
  api.selectGalleryEntry("not-rendered", plain);
  api.selectGalleryEntry("one", { ...plain, shiftKey: true });
  assert.equal(view.selectedEntryIDs.size, 3);
  api.selectGalleryEntry("one", plain);
  api.selectGalleryEntry("not-rendered", { ...plain, ctrlKey: true });
  api.selectGalleryEntry("two", { ...plain, ctrlKey: true, shiftKey: true });
  assert.equal(view.selectedEntryIDs.size, 3);
});

test("comparison ranges follow reordered rows and columns, including grouped results", () => {
  const { view, api } = createView();
  view.viewMode = "document-columns";
  view.comparisonDocumentIDs = [2, 1];
  view.comparisonRows = [
    {
      entries: {
        "1": { entryIDs: ["two", "one"] },
        "2": { entryIDs: ["not-rendered", "filtered-out"] },
      },
    },
  ];
  api.selectGalleryEntry("not-rendered", plain);
  api.selectGalleryEntry("two", { ...plain, shiftKey: true });
  assert.deepEqual([...view.selectedEntryIDs], ["not-rendered", "two"]);
});

test("Ctrl+A selects filtered results beyond rendered cards and Escape clears them", () => {
  const { view, api } = createView();
  const selectAll = keyEvent("a", undefined, { ...plain, ctrlKey: true });
  api.handleGallerySelectionKeydown(selectAll);
  assert.equal(view.selectedEntryIDs.size, 3);
  assert.equal(selectAll.defaultPrevented, true);
  api.handleGallerySelectionKeydown(keyEvent("Escape"));
  assert.equal(view.selectedEntryIDs.size, 0);
  assert.equal(view.selectionAnchorID, undefined);
});

test("text editing, IME input, and busy state do not trigger gallery shortcuts", () => {
  const { view, api, calls } = createView();
  api.selectGalleryEntry("one", plain);
  for (const key of ["a", "Delete", "Escape"]) {
    const event = keyEvent(key, new TestElement(true), {
      ...plain,
      ctrlKey: key === "a",
    });
    api.handleGallerySelectionKeydown(event);
    assert.equal(event.defaultPrevented, false);
  }
  api.handleGallerySelectionKeydown({
    ...keyEvent("Delete"),
    isComposing: true,
  });
  view.batchBusy = true;
  api.selectGalleryEntry("two", plain);
  api.handleGallerySelectionKeydown(keyEvent("Delete"));
  assert.deepEqual([...view.selectedEntryIDs], ["one"]);
  assert.equal(calls.length, 0);
});

test("right-click preserves a selected group and selects an unselected card in either layout", () => {
  const { view, api, cards, menuTargets } = createView();
  api.selectAllGalleryEntries();
  api.handleGalleryContextMenu(keyEvent("", cards[0]));
  assert.equal(view.selectedEntryIDs.size, 3);
  api.selectGalleryEntry("one", plain);
  api.handleGalleryContextMenu(keyEvent("", cards[1]));
  assert.deepEqual([...view.selectedEntryIDs], ["two"]);
  assert.equal(menuTargets.length, 2);
});

test("Delete asks for confirmation with figure, formula, and table counts; cancel and repeated keys never delete", async () => {
  const { view, api, calls, confirmations } = createView();
  api.selectAllGalleryEntries();
  view.window.confirm = () => false;
  api.handleGallerySelectionKeydown(keyEvent("Delete"));
  api.handleGallerySelectionKeydown({ ...keyEvent("Delete"), repeat: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    { ...confirmations[0] },
    { count: 3, figures: 1, formulae: 1, tables: 1 },
  );
  assert.equal(calls.length, 0);
  assert.equal(view.controlsDisabled, false);
  assert.equal(view.batchBusy, false);
  assert.equal(view.selectedEntryIDs.size, 3);
});

test("partial deletion removes successful cards and retains failed selections for retry", async () => {
  const { view, api, calls, errors } = createView();
  api.selectGalleryEntry("one", plain);
  api.selectGalleryEntry("two", { ...plain, ctrlKey: true });
  await api.runSelectedBatch("delete");
  assert.deepEqual(Array.from(calls[0]), ["one", "two"]);
  assert.deepEqual(
    view.allEntries.map(({ id }) => id),
    ["two", "not-rendered"],
  );
  assert.deepEqual([...view.selectedEntryIDs], ["two"]);
  assert.equal(view.entriesByID.has("one"), false);
  assert.deepEqual(errors, ["two: disk failure"]);
  assert.equal(view.controlsDisabled, false);
});

test("export preserves cards and selection", async () => {
  const { view, api } = createView();
  api.selectGalleryEntry("one", plain);
  await api.runSelectedBatch("export");
  assert.equal(view.allEntries.length, 3);
  assert.ok(view.selectedEntryIDs.has("one"));
});

test("batch actions live in the native context menu without checkbox or top toolbar markup", () => {
  const markup = readFileSync(
    "addon/chrome/content/gallery/index.html",
    "utf8",
  );
  assert.doesNotMatch(
    markup,
    /batch-toolbar|type="checkbox"|id="delete-selected"|id="export-selected"/,
  );
  assert.doesNotMatch(source, /checkbox|gallery-select-entry/);
  const menu = source.slice(
    source.indexOf("async function openGalleryContextMenu("),
    source.indexOf("function createGalleryMenuItem("),
  );
  assert.match(menu, /runSelectedBatch\("export"\)/);
  assert.match(menu, /runSelectedBatch\("delete"\)/);
  assert.match(menu, /selectAllGalleryEntries/);
  assert.match(menu, /clearGallerySelection/);
});
