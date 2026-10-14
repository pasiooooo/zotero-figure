import * as assert from "node:assert/strict";
import test from "node:test";
import type { PdfReader } from "../src/platform/zotero/reader";
import type { StoredFigureResult } from "../src/services/results/figureResultStore";
import {
  FigureSidebarPanel,
  type FigureSidebarPanelOptions,
} from "../src/features/reader/figureSidebarPanel";
import type { ResultCorrectionPreview } from "../src/features/reader/resultRegionEditor";

const testGlobals = globalThis as typeof globalThis & { addon: typeof addon };

interface PanelInternals {
  openCommentEditor(result: StoredFigureResult): Promise<void>;
  openRegionEditor(result: StoredFigureResult): Promise<void>;
  pinnedCards: Map<
    string,
    { dispose(): void; element: Pick<HTMLElement, "contains"> }
  >;
  reconcilePinnedCards(results: readonly StoredFigureResult[]): void;
  requestPinnedCardRefresh(
    entry: { dispose(): void; element: Pick<HTMLElement, "contains"> },
    result: StoredFigureResult,
  ): void;
}

test("continues panel cleanup when restoring the native sidebar throws", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as {
    active: boolean;
    detachDocument(): void;
    setInternalSidebarView(): void;
  };
  const previousZotero = globalThis.Zotero;
  let detached = 0;
  internals.active = true;
  internals.setInternalSidebarView = () => {
    throw new Error("reader already closed");
  };
  internals.detachDocument = () => detached++;
  globalThis.Zotero = {
    logError: () => {},
  } as unknown as typeof Zotero;
  try {
    panel.dispose();
  } finally {
    globalThis.Zotero = previousZotero;
  }
  assert.equal(detached, 1);
});

test("applies editor results while keeping their Panel outcomes separate", async () => {
  const panel = createPanel(async () => createPreview());
  const commentResult = createResult("comment");
  const regionResult = createResult("region");
  let applied: StoredFigureResult | undefined;
  let reloads = 0;
  const internals = panel as unknown as PanelInternals & {
    applyUpdatedResult(result: StoredFigureResult): void;
    document?: Document;
    reloadResults(): void;
    resultEditors: {
      correctRegion(): Promise<StoredFigureResult | undefined>;
      dispose(): void;
      editComment(): Promise<StoredFigureResult | undefined>;
      setContext(document: Document | undefined): void;
    };
  };
  internals.document = {} as Document;
  internals.resultEditors = {
    correctRegion: async () => regionResult,
    dispose: () => {},
    editComment: async () => commentResult,
    setContext: () => {},
  };
  internals.applyUpdatedResult = (result) => {
    applied = result;
  };
  internals.reloadResults = () => reloads++;

  await internals.openCommentEditor(createResult("source"));
  await internals.openRegionEditor(createResult("source"));

  assert.equal(applied, commentResult);
  assert.equal(reloads, 1);
  internals.document = undefined;
  panel.dispose();
});

test("double-clicking populated, translated or empty captions edits the current original result", async () => {
  const previousAddon = testGlobals.addon;
  testGlobals.addon = { data: {} } as typeof addon;
  try {
    const panel = createPanel(async () => createPreview());
    const state = panel as unknown as {
      results: StoredFigureResult[];
      createComment(
        document: Document,
        result: StoredFigureResult,
        display: string,
      ): HTMLElement;
      openCommentEditor(result: StoredFigureResult): Promise<void>;
      setCommentExpansion(): void;
    };
    const original = createResult("original");
    const current = { ...original, comment: "Figure 1.2. Current original" };
    state.results = [current];
    const edited: StoredFigureResult[] = [];
    let expansions = 0;
    state.openCommentEditor = async (result) => {
      edited.push(result);
    };
    state.setCommentExpansion = () => expansions++;
    for (const text of [original.comment, "Translated caption", ""]) {
      const handlers = new Map<string, (event: unknown) => void>();
      const document = {
        createElement: () => ({
          append() {},
          setAttribute() {},
          classList: { add() {}, toggle() {}, contains: () => false },
          addEventListener: (
            name: string,
            listener: (event: unknown) => void,
          ) => handlers.set(name, listener),
        }),
      } as unknown as Document;
      state.createComment(document, original, text);
      let stopped = 0;
      const event = {
        detail: 1,
        preventDefault() {},
        stopPropagation() {
          stopped++;
        },
      };
      handlers.get("click")!(event);
      handlers.get("click")!({ ...event, detail: 2 });
      assert.equal(edited.length, text === original.comment ? 0 : text ? 1 : 2);
      handlers.get("dblclick")!(event);
      await Promise.resolve();
      assert.equal(edited.at(-1), current);
      assert.equal(stopped, 3);
    }
    assert.equal(expansions, 2);
    assert.equal(edited.length, 3);
    panel.dispose();
  } finally {
    testGlobals.addon = previousAddon;
  }
});

test("caption edits reorder existing cards and selection order without replacing their nodes", () => {
  let opened = 0;
  const panel = createPanel(async () => createPreview(), {
    reader: {
      toggleSidebar: (open: boolean) => {
        assert.equal(open, true);
        opened++;
      },
    } as unknown as PdfReader,
  });
  const state = panel as unknown as {
    results: StoredFigureResult[];
    resultCards: Map<string, HTMLElement>;
    panel: HTMLElement;
    imageLoads: { updateResult(): void };
    refreshControls(): void;
    openPanel(): void;
    scheduleResultScroll(id: string): void;
    selectedResultIDs: Set<string>;
    applyUpdatedResult(result: StoredFigureResult): void;
  };
  const first = { ...createResult("first"), comment: "Fig 1.1" };
  const second = { ...createResult("second"), comment: "Fig 1.2" };
  state.results = [first, second];
  const card = () =>
    ({
      querySelector: () => null,
      classList: { toggle() {} },
      setAttribute() {},
      ownerDocument: {},
    }) as unknown as HTMLElement;
  const firstCard = card();
  const secondCard = card();
  state.resultCards = new Map([
    [first.id, firstCard],
    [second.id, secondCard],
  ]);
  const appended: HTMLElement[] = [];
  state.panel = {
    querySelector: () => ({
      append: (node: HTMLElement) => appended.push(node),
    }),
  } as unknown as HTMLElement;
  state.imageLoads = { updateResult() {} };
  state.refreshControls = () => {};
  state.openPanel = () => {};
  let focused: string | undefined;
  state.scheduleResultScroll = (id) => {
    focused = id;
  };
  panel.updateResult({ ...first, comment: "Fig 2.1" }, true);
  assert.equal(opened, 1);
  assert.equal(focused, first.id);
  assert.deepEqual([...state.selectedResultIDs], [first.id]);
  assert.deepEqual([...state.resultCards.keys()], ["second", "first"]);
  assert.deepEqual(appended, [secondCard, firstCard]);
  state.applyUpdatedResult({ ...first, comment: "" });
  assert.deepEqual([...state.resultCards.keys()], ["first", "second"]);
});

test("disposes only pinned cards whose results no longer exist", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as PanelInternals;
  let staleDisposals = 0;
  let retainedDisposals = 0;
  internals.pinnedCards.set("stale", {
    dispose: () => staleDisposals++,
    element: { contains: () => false },
  });
  internals.pinnedCards.set("retained", {
    dispose: () => retainedDisposals++,
    element: { contains: () => false },
  });
  internals.requestPinnedCardRefresh = () => {};

  internals.reconcilePinnedCards([createResult("retained")]);

  assert.equal(staleDisposals, 1);
  assert.equal(retainedDisposals, 0);
  assert.deepEqual([...internals.pinnedCards.keys()], ["retained"]);
  panel.dispose();
  assert.equal(retainedDisposals, 1);
});

test("refreshes a retained pinned card when the same result ID is overwritten", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as PanelInternals;
  const entry = {
    dispose: () => assert.fail("same-ID cards must be retained"),
    element: { contains: () => false },
  };
  const updated = { ...createResult("retained"), comment: "new snapshot" };
  let refreshedResult: StoredFigureResult | undefined;
  internals.pinnedCards.set(updated.id, entry);
  internals.requestPinnedCardRefresh = (refreshedEntry, result) => {
    assert.equal(refreshedEntry, entry);
    refreshedResult = result;
  };

  internals.reconcilePinnedCards([updated]);

  assert.equal(refreshedResult, updated);
  assert.equal(internals.pinnedCards.get(updated.id), entry);
  internals.pinnedCards.clear();
  panel.dispose();
});

test("cancels a pending pinned refresh when the current result becomes latest again", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as {
    requestPinnedCardRefresh(entry: unknown, result: StoredFigureResult): void;
  };
  const current = createResult("retained");
  const pending = { ...current, comment: "superseded" };
  let cancellations = 0;
  const entry = {
    cancelPendingSnapshotRefresh: () => cancellations++,
    dispose: () => {},
    element: {},
    pendingSnapshot: {
      displayComment: pending.comment,
      result: pending,
    },
    refreshSnapshot: async () => {
      assert.fail("the already displayed result does not need reloading");
    },
    snapshot: {
      displayComment: current.comment,
      result: current,
    },
  };

  internals.requestPinnedCardRefresh(entry, current);

  assert.equal(cancellations, 1);
  assert.equal(entry.pendingSnapshot, undefined);
  panel.dispose();
});

test("copies during recognition and still applies concurrent external LaTeX", async () => {
  const recognition = createDeferred<StoredFigureResult>();
  const source = { ...createResult("formula"), kind: "formula" as const };
  const recognized = { ...source, latex: "cloud" };
  const manual = { ...source, latex: "manual" };
  let copyCalls = 0;
  const ownerWindow = {
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
  } as unknown as Window;
  const panel = createPanel(async () => createPreview(), {
    onCopyLatex: async () => {
      copyCalls++;
      return await recognition.promise;
    },
    onRerecognizeLatex: async () => await recognition.promise,
    ownerWindow,
  });
  const document = {} as Document;
  const anchor = { ownerDocument: document } as HTMLButtonElement;
  const applied: StoredFigureResult[] = [];
  const internals = panel as unknown as {
    applyUpdatedResult(result: StoredFigureResult): void;
    closeMenu(): void;
    copyFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    document?: Document;
    rerecognizeFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    results?: readonly StoredFigureResult[];
    setMenuButtonState(): void;
  };
  internals.document = document;
  internals.results = [source];
  internals.closeMenu = () => undefined;
  internals.setMenuButtonState = () => undefined;
  internals.applyUpdatedResult = (result) => applied.push(result);

  const rerecognize = internals.rerecognizeFormulaLatex(anchor, source);
  const copy = internals.copyFormulaLatex(anchor, source);
  panel.updateResult(manual);

  assert.equal(copyCalls, 1);
  assert.equal(applied[0], manual);
  recognition.resolve(recognized);
  await Promise.all([rerecognize, copy]);
  assert.equal(applied.filter((result) => result === recognized).length, 2);

  internals.document = undefined;
  panel.dispose();
});

test("reloads after a formula update races the initial result snapshot", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as {
    loadingResults: boolean;
    reloadAfterLoad: boolean;
    results?: readonly StoredFigureResult[];
  };
  internals.loadingResults = true;
  internals.reloadAfterLoad = false;
  internals.results = undefined;

  panel.updateResult({
    ...createResult("formula"),
    kind: "formula",
    latex: "x",
  });

  assert.equal(internals.reloadAfterLoad, true);
  internals.loadingResults = false;
  panel.dispose();
});

test("does not apply a stale copy result after a newer formula update", async () => {
  const timers: Array<() => void> = [];
  const ownerWindow = {
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
  } as unknown as Window;
  const source = { ...createResult("formula"), kind: "formula" as const };
  const copied = { ...source, latex: "copied" };
  const manual = { ...source, latex: "manual" };
  const panel = createPanel(async () => createPreview(), {
    onCopyLatex: async () => copied,
    ownerWindow,
  });
  const document = {} as Document;
  const anchor = { ownerDocument: document } as HTMLButtonElement;
  const internals = panel as unknown as {
    closeMenu(): void;
    copyFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    document?: Document;
    results?: readonly StoredFigureResult[];
    setMenuButtonState(): void;
  };
  internals.document = document;
  internals.results = [source];
  internals.closeMenu = () => undefined;
  internals.setMenuButtonState = () => undefined;

  const request = internals.copyFormulaLatex(anchor, source);
  await waitFor(() => timers.length === 1);
  panel.updateResult(manual);
  timers[0]();
  await request;

  assert.equal(internals.results?.[0], manual);
  internals.document = undefined;
  panel.dispose();
});

test("applies recognition feedback to the current card menu button", () => {
  const panel = createPanel(async () => createPreview());
  const staleButton = {} as HTMLButtonElement;
  const currentButton = {} as HTMLButtonElement;
  const card = {
    isConnected: true,
    querySelector: () => currentButton,
  } as unknown as HTMLElement;
  const calls: Array<{
    action: "copy" | "rerecognize";
    button: HTMLButtonElement;
    state: "check" | "loading" | "menu";
  }> = [];
  const internals = panel as unknown as {
    setFormulaLatexRequestButtonState(
      anchor: HTMLButtonElement,
      sourceCard: HTMLElement,
      resultID: string,
      state: "check",
      action: "rerecognize",
    ): void;
    setMenuButtonState(
      button: HTMLButtonElement,
      state: "check" | "loading" | "menu",
      action: "copy" | "rerecognize",
    ): void;
  };
  internals.setMenuButtonState = (button, state, action) =>
    calls.push({ action, button, state });

  internals.setFormulaLatexRequestButtonState(
    staleButton,
    card,
    "formula",
    "check",
    "rerecognize",
  );

  assert.deepEqual(calls, [
    { action: "rerecognize", button: currentButton, state: "check" },
  ]);
  panel.dispose();
});

test("clears recognition loading state after the Reader document changes", async () => {
  const recognition = createDeferred<StoredFigureResult>();
  const source = { ...createResult("formula"), kind: "formula" as const };
  const panel = createPanel(async () => createPreview(), {
    onRerecognizeLatex: async () => await recognition.promise,
  });
  const oldDocument = {} as Document;
  const newDocument = {} as Document;
  const anchor = { ownerDocument: oldDocument } as HTMLButtonElement;
  let resets = 0;
  const internals = panel as unknown as {
    closeMenu(): void;
    document?: Document;
    rerecognizeFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    resetFormulaLatexMenuButtons(resultID: string): void;
    results?: readonly StoredFigureResult[];
    setMenuButtonState(): void;
  };
  internals.document = oldDocument;
  internals.results = [source];
  internals.closeMenu = () => undefined;
  internals.setMenuButtonState = () => undefined;
  internals.resetFormulaLatexMenuButtons = () => resets++;

  const request = internals.rerecognizeFormulaLatex(anchor, source);
  internals.document = newDocument;
  recognition.resolve({ ...source, latex: "cloud" });
  await request;

  assert.equal(resets, 1);
  internals.document = undefined;
  panel.dispose();
});

test("passes displayed translations to single and bulk note exports", async () => {
  const first = createResult("first");
  const second = createResult("second");
  let bulkResults: readonly StoredFigureResult[] = [];
  let singleResult: StoredFigureResult | undefined;
  const panel = createPanel(async () => createPreview(), {
    onAddAllToNote: async (results) => {
      bulkResults = results;
    },
    onAddToNote: async (result) => {
      singleResult = result;
    },
  });
  const internals = panel as unknown as {
    addAllToNote(results: readonly StoredFigureResult[]): Promise<void>;
    addResultToNote(result: StoredFigureResult): Promise<void>;
    translatedComments: Map<string, string>;
    translationEnabled: boolean;
  };
  internals.translationEnabled = true;
  internals.translatedComments = new Map([[first.id, "translated first"]]);

  await internals.addAllToNote([first, second]);
  await internals.addResultToNote(first);

  assert.equal(bulkResults[0].comment, "translated first");
  assert.equal(bulkResults[1], second);
  assert.equal(singleResult?.comment, "translated first");
  assert.equal(first.comment, "first");
  panel.dispose();
});

interface SelectionInternals {
  active: boolean;
  batchBusy: boolean;
  batchStatus?: string;
  document?: Document;
  panel?: HTMLElement;
  panelContent?: HTMLDivElement;
  results: StoredFigureResult[];
  resultCards: Map<string, HTMLElement>;
  selectedResultIDs: Set<string>;
  selectResult(
    id: string,
    modifiers: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
  ): void;
  handleSelectionKeyDown(event: KeyboardEvent): void;
  runSelectedBatch(action: "delete" | "export"): Promise<void>;
  render(): void;
  renderContent(): void;
  loadingResults: boolean;
  requestResults(content: HTMLDivElement, force?: boolean): void;
}

function selectionPanel(overrides: Partial<FigureSidebarPanelOptions> = {}) {
  const panel = createPanel(async () => createPreview(), overrides);
  const state = panel as unknown as SelectionInternals;
  state.active = true;
  state.document = {} as Document;
  state.panel = {
    contains: (target: unknown) => Boolean(target),
  } as HTMLElement;
  state.panelContent = { inert: false } as HTMLDivElement;
  state.results = ["figure", "formula", "table"].map((kind) => ({
    ...createResult(kind),
    kind: kind as StoredFigureResult["kind"],
  }));
  for (const { id } of state.results)
    state.resultCards.set(id, {
      classList: { toggle: () => {} },
      setAttribute: () => {},
    } as unknown as HTMLElement);
  state.render = () => {};
  return state;
}

function selectionKey(
  key: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    target: { closest: () => null },
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    ...options,
  } as unknown as KeyboardEvent;
}

test("sidebar selection supports click, Ctrl toggle, Shift ranges, and scoped keyboard shortcuts", () => {
  const state = selectionPanel();
  const plain = { ctrlKey: false, metaKey: false, shiftKey: false };
  state.selectResult("figure", plain);
  state.selectResult("table", { ...plain, shiftKey: true });
  assert.deepEqual(
    [...state.selectedResultIDs],
    ["figure", "formula", "table"],
  );
  state.selectResult("formula", { ...plain, ctrlKey: true });
  assert.deepEqual([...state.selectedResultIDs], ["figure", "table"]);
  state.selectResult("table", plain);
  assert.deepEqual([...state.selectedResultIDs], ["table"]);
  state.handleSelectionKeyDown(selectionKey("a", { ctrlKey: true }));
  assert.equal(state.selectedResultIDs.size, 3);
  state.handleSelectionKeyDown(selectionKey("Escape"));
  assert.equal(state.selectedResultIDs.size, 0);
  const editor = { closest: () => ({}) } as unknown as EventTarget;
  state.handleSelectionKeyDown(
    selectionKey("a", { ctrlKey: true, target: editor }),
  );
  state.handleSelectionKeyDown(
    selectionKey("a", { ctrlKey: true, target: null }),
  );
  assert.equal(state.selectedResultIDs.size, 0);
  state.selectResult("figure", plain);
  let deletions = 0;
  state.runSelectedBatch = async () => {
    deletions++;
  };
  state.handleSelectionKeyDown(selectionKey("Delete", { repeat: true }));
  state.handleSelectionKeyDown(selectionKey("Delete", { target: editor }));
  assert.equal(deletions, 0);
  state.handleSelectionKeyDown(selectionKey("Delete"));
  assert.equal(deletions, 1);
});

test("sidebar deletion confirms kind counts, handles cancellation and retains failed selections", async () => {
  const previousAddon = testGlobals.addon;
  const prompts: unknown[] = [];
  testGlobals.addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: (
            messages: Array<{ id: string; args: unknown }>,
          ) => {
            if (messages[0].id.endsWith("gallery-confirm-delete"))
              prompts.push(messages[0].args);
            return [{ value: messages[0].id }];
          },
        },
      },
    },
  } as unknown as typeof addon;
  try {
    let allow = false;
    let calls = 0;
    const state = selectionPanel({
      ownerWindow: { confirm: () => allow } as unknown as Window,
      onRunBatch: async (ids, action) => {
        calls++;
        assert.equal(state.panelContent!.inert, true);
        assert.equal(action, "delete");
        assert.deepEqual(ids, ["figure", "formula", "table"]);
        return {
          completedIDs: ["figure", "table"],
          errors: ["formula: read-only"],
        };
      },
    });
    state.selectedResultIDs = new Set(["figure", "formula", "table"]);
    const body = {} as HTMLElement;
    const document = { body, activeElement: {} as Element };
    state.document = document as Document;
    state.render = () => {
      document.activeElement = body;
    };
    let focusRestored = 0;
    state.resultCards.get("formula")!.focus = () => {
      focusRestored++;
    };
    await state.runSelectedBatch("delete");
    assert.equal(calls, 0);
    assert.equal(state.batchBusy, false);
    allow = true;
    await state.runSelectedBatch("delete");
    assert.equal(calls, 1);
    assert.deepEqual(
      prompts,
      Array(2).fill({ count: 3, figures: 1, formulae: 1, tables: 1 }),
    );
    assert.deepEqual(
      state.results.map(({ id }) => id),
      ["formula"],
    );
    assert.deepEqual([...state.selectedResultIDs], ["formula"]);
    assert.match(state.batchStatus!, /formula: read-only/);
    assert.equal(state.panelContent!.inert, false);
    assert.equal(state.batchBusy, false);
    assert.equal(focusRestored, 1);
  } finally {
    testGlobals.addon = previousAddon;
  }
});

test("sidebar batches ignore stale refreshes and reload once after completion", async () => {
  const previousAddon = testGlobals.addon;
  testGlobals.addon = { data: {} } as typeof addon;
  try {
    const stale = createDeferred<StoredFigureResult[]>();
    const batch = createDeferred<{
      completedIDs: string[];
      errors: string[];
    }>();
    let loads = 0;
    const state = selectionPanel({
      getResults: () => (++loads === 1 ? stale.promise : Promise.resolve([])),
      ownerWindow: { confirm: () => true } as unknown as Window,
      onRunBatch: () => batch.promise,
    });
    state.renderContent = () => {};
    state.selectedResultIDs.add("figure");
    state.requestResults(state.panelContent!);
    const pending = state.runSelectedBatch("delete");
    state.requestResults(state.panelContent!, true);
    stale.resolve([createResult("stale")]);
    await Promise.resolve();
    assert.equal(
      state.results.some(({ id }) => id === "stale"),
      false,
    );
    assert.equal(loads, 1);
    batch.resolve({ completedIDs: ["figure"], errors: [] });
    await pending;
    assert.equal(loads, 2);
  } finally {
    testGlobals.addon = previousAddon;
  }
});

test("sidebar media navigates on double click and floats only when dragged outside the panel", () => {
  const panel = createPanel(async () => createPreview());
  const state = panel as unknown as {
    panel: HTMLElement;
    bindCardMediaInteractions(
      media: HTMLElement,
      result: StoredFigureResult,
      card: HTMLElement,
    ): void;
    goToPage(): Promise<void>;
    pinSelectedCards(
      result: StoredFigureResult,
      card: HTMLElement,
      position: { x: number; y: number },
    ): Promise<void>;
  };
  let navigations = 0;
  const drops: Array<{ x: number; y: number }> = [];
  state.goToPage = async () => {
    navigations++;
  };
  state.pinSelectedCards = async (_result, _card, position) => {
    drops.push(position);
  };
  state.panel = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 600 }),
  } as HTMLElement;
  const handlers = new Map<string, (event: unknown) => void>();
  const media = {
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      handlers.set(name, handler),
    setPointerCapture() {},
    hasPointerCapture: () => true,
    releasePointerCapture() {},
    classList: { add() {}, remove() {} },
  } as unknown as HTMLElement;
  state.bindCardMediaInteractions(
    media,
    createResult("figure"),
    {} as HTMLElement,
  );
  const emit = (type: string, x = 100, y = 100) =>
    handlers.get(type)?.({
      type,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
      preventDefault() {},
      stopPropagation() {},
    });
  emit("click");
  assert.equal(navigations, 0);
  emit("dblclick");
  assert.equal(navigations, 1);
  emit("pointerdown");
  emit("pointermove", 150);
  emit("pointerup", 150);
  assert.equal(drops.length, 0);
  emit("pointerdown");
  emit("pointermove", 300);
  emit("pointercancel", 300);
  assert.equal(drops.length, 0);
  emit("pointerdown");
  emit("pointermove", 300, 200);
  emit("pointerup", 300, 200);
  assert.deepEqual(drops, [{ x: 268, y: 180 }]);
  emit("lostpointercapture", 300, 200);
  assert.equal(drops.length, 1);
});

test("dragging a selected result floats the selection in list order, continues on failure, and isolates an unselected drag", async () => {
  const previousZotero = globalThis.Zotero;
  globalThis.Zotero = { logError() {} } as unknown as typeof Zotero;
  try {
    const state = selectionPanel() as SelectionInternals & {
      pinGeneration: number;
      pinSelectedCards(
        result: StoredFigureResult,
        card: HTMLElement,
        position?: { x: number; y: number },
      ): Promise<void>;
      pinCard(
        result: StoredFigureResult,
        card: HTMLElement,
        position?: { x: number; y: number },
      ): Promise<void>;
    };
    state.selectedResultIDs = new Set(["table", "figure", "formula"]);
    const calls: string[] = [];
    state.pinCard = async (result, card, position) => {
      calls.push(result.id);
      assert.equal(card, state.resultCards.get(result.id));
      assert.deepEqual(position, { x: 400, y: 200 });
      if (result.id === "formula") throw new Error("image unavailable");
    };
    await state.pinSelectedCards(
      state.results[1],
      state.resultCards.get("formula")!,
      { x: 400, y: 200 },
    );
    assert.deepEqual(calls, ["figure", "formula", "table"]);
    assert.equal(state.selectedResultIDs.size, 3);
    assert.match(state.batchStatus!, /image unavailable/);
    state.selectedResultIDs = new Set(["figure"]);
    calls.length = 0;
    await state.pinSelectedCards(
      state.results[2],
      state.resultCards.get("table")!,
      { x: 400, y: 200 },
    );
    assert.deepEqual(calls, ["table"]);
    state.selectedResultIDs = new Set(["figure", "formula", "table"]);
    calls.length = 0;
    state.pinCard = async (result) => {
      calls.push(result.id);
      state.pinGeneration++;
    };
    await state.pinSelectedCards(
      state.results[0],
      state.resultCards.get("figure")!,
    );
    assert.deepEqual(calls, ["figure"]);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});

test("batch floating arranges only new cards; later single drags and existing selections never rearrange them", async () => {
  const state = selectionPanel() as SelectionInternals & {
    pinnedCards: Map<
      string,
      {
        element: { offsetWidth: number; offsetHeight: number };
        fitTo(cell: {
          x: number;
          y: number;
          width: number;
          height: number;
        }): void;
      }
    >;
    pinSelectedCards(
      result: StoredFigureResult,
      card: HTMLElement,
      position?: { x: number; y: number },
    ): Promise<void>;
    pinCard(
      result: StoredFigureResult,
      card: HTMLElement,
      position?: { x: number; y: number },
    ): Promise<unknown>;
  };
  state.document = {
    documentElement: { clientWidth: 1200, clientHeight: 800 },
  } as Document;
  state.panel = {
    getBoundingClientRect: () => ({ right: 300 }),
  } as HTMLElement;
  const positions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  state.pinnedCards.set("figure", {
    element: { offsetWidth: 300, offsetHeight: 250 },
    fitTo: () => assert.fail("an existing card must never be moved or resized"),
  });
  state.pinCard = async (result) => {
    if (state.pinnedCards.has(result.id)) return;
    state.pinnedCards.set(result.id, {
      element: { offsetWidth: 300, offsetHeight: 250 },
      fitTo: (cell) => positions.push(cell),
    });
    return state.pinnedCards.get(result.id);
  };
  state.selectedResultIDs = new Set(["figure", "formula", "table"]);
  await state.pinSelectedCards(
    state.results[0],
    state.resultCards.get("figure")!,
    { x: 1100, y: 750 },
  );
  assert.equal(positions.length, 2);
  assert.ok(positions.every(({ x }) => x >= 312));
  assert.equal(new Set(positions.map(({ x, y }) => `${x}:${y}`)).size, 2);
  await state.pinSelectedCards(
    state.results[0],
    state.resultCards.get("figure")!,
    { x: 500, y: 300 },
  );
  assert.equal(positions.length, 2);
  state.pinnedCards.delete("table");
  state.selectedResultIDs = new Set(["table"]);
  await state.pinSelectedCards(
    state.results[2],
    state.resultCards.get("table")!,
    { x: 800, y: 200 },
  );
  assert.equal(positions.length, 2);
});

test("sidebar right click preserves multi-selection and also opens from list whitespace", () => {
  const state = selectionPanel() as SelectionInternals & {
    handlePanelContextMenu(event: MouseEvent): void;
    openMenu(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
      event?: MouseEvent,
    ): void;
  };
  const opened: string[] = [];
  let prevented = 0;
  let stopped = 0;
  const anchors = new Map<string, HTMLButtonElement>();
  for (const [id, card] of state.resultCards) {
    anchors.set(id, {} as HTMLButtonElement);
    Object.assign(card, {
      dataset: { resultId: id },
      focus() {},
      querySelector: () => anchors.get(id),
    });
  }
  state.openMenu = (anchor, result) => {
    assert.equal(anchor, anchors.get(result.id));
    opened.push(result.id);
  };
  state.selectedResultIDs = new Set(["figure", "formula"]);
  const rightClick = (id?: string, editable = false) =>
    state.handlePanelContextMenu({
      target: {
        closest: (selector: string) =>
          selector === ".pasiofigure-sidebar-card"
            ? state.resultCards.get(id ?? "")
            : editable
              ? {}
              : null,
      },
      preventDefault: () => {
        prevented++;
      },
      stopPropagation: () => {
        stopped++;
      },
    } as unknown as MouseEvent);
  rightClick("formula");
  assert.deepEqual([...state.selectedResultIDs], ["figure", "formula"]);
  rightClick();
  rightClick("formula", true);
  assert.deepEqual(opened, ["formula", "figure"]);
  rightClick("table");
  assert.deepEqual([...state.selectedResultIDs], ["table"]);
  assert.deepEqual(opened, ["formula", "figure", "table"]);
  assert.equal(prevented, 3);
  assert.equal(stopped, 3);
});

test("native sidebar batch menu opens after the context event and cancels stale opens", () => {
  const previousAddon = testGlobals.addon;
  testGlobals.addon = { data: {} } as typeof addon;
  try {
    const scheduled: Array<() => void> = [];
    const labels: string[] = [];
    const commands = new Map<string, () => void>();
    const opened: number[][] = [];
    const mounted: unknown[] = [];
    const popupset = { append: (menu: unknown) => mounted.push(menu) };
    const ownerWindow = {
      document: {
        createXULElement: () => ({
          append() {},
          remove() {},
          setAttribute() {},
          addEventListener() {},
          openPopupAtScreen: (x: number, y: number) => opened.push([x, y]),
        }),
      },
      setTimeout: (callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      },
    } as unknown as Window;
    const state = selectionPanel({
      ownerWindow,
      reader: { _popupset: popupset } as unknown as PdfReader,
    }) as SelectionInternals & {
      openMenu(
        anchor: HTMLButtonElement,
        result: StoredFigureResult,
        event?: MouseEvent,
      ): void;
      closeMenu(): void;
      appendMenuItem(menu: unknown, key: string, command: () => void): void;
      pinSelectedCards(): Promise<void>;
    };
    const actions: string[] = [];
    state.runSelectedBatch = async (action) => {
      actions.push(action);
    };
    state.pinSelectedCards = async () => {
      actions.push("float");
    };
    state.appendMenuItem = (_menu, key, command) => {
      labels.push(key);
      commands.set(key, command);
    };
    state.selectedResultIDs = new Set(["figure", "formula"]);
    const anchor = {
      closest: () => state.resultCards.get("figure"),
    } as unknown as HTMLButtonElement;
    const event = { screenX: 800, screenY: 400 } as MouseEvent;
    state.openMenu(anchor, state.results[0], event);
    assert.equal(mounted.length, 1);
    assert.equal(opened.length, 0);
    assert.ok(labels.includes("gallery-export-selected"));
    assert.ok(labels.includes("gallery-delete-selected"));
    assert.ok(labels.includes("sidebar-pin-image"));
    scheduled.shift()!();
    assert.deepEqual(opened, [[800, 400]]);
    commands.get("gallery-export-selected")!();
    commands.get("gallery-delete-selected")!();
    commands.get("sidebar-pin-image")!();
    assert.deepEqual(actions, ["export", "delete", "float"]);
    state.openMenu(anchor, state.results[0], event);
    state.closeMenu();
    scheduled.shift()!();
    assert.equal(opened.length, 1);
  } finally {
    testGlobals.addon = previousAddon;
  }
});

test("region results are selected in sidebar order and hidden types are made visible", () => {
  const panel = createPanel(async () => createPreview());
  const state = panel as unknown as {
    pendingRevealRegions?: Array<{
      pageIndex: number;
      rect: [number, number, number, number];
    }>;
    filters: Set<StoredFigureResult["kind"]>;
    selectedResultIDs: Set<string>;
    selectionAnchorID?: string;
    prepareResultReveal(results: StoredFigureResult[]): string | undefined;
  };
  const later = { ...createResult("later"), comment: "Fig 2" };
  const first = {
    ...createResult("first"),
    comment: "Fig 1",
    rect: [-1, -1, 2, 2],
    detectedRect: [0.1, 0.1, 0.9, 0.9],
  } as StoredFigureResult;
  const formula = { ...createResult("formula"), kind: "formula" as const };
  const elsewhere = { ...createResult("elsewhere"), pageIndex: 1 };
  const outside = {
    ...createResult("outside"),
    rect: [2, 2, 3, 3],
  } as StoredFigureResult;
  state.filters = new Set(["table"]);
  state.selectedResultIDs.add("elsewhere");
  state.pendingRevealRegions = [{ pageIndex: 0, rect: [0, 0, 1, 1] }];
  assert.equal(
    state.prepareResultReveal([later, formula, elsewhere, first, outside]),
    "formula",
  );
  assert.deepEqual([...state.selectedResultIDs], ["formula", "first", "later"]);
  assert.deepEqual([...state.filters], ["table", "formula", "figure"]);
  assert.equal(state.selectionAnchorID, "formula");
  assert.equal(state.pendingRevealRegions, undefined);
  state.pendingRevealRegions = [{ pageIndex: 9, rect: [0, 0, 1, 1] }];
  assert.equal(state.prepareResultReveal([first]), undefined);
  assert.deepEqual([...state.selectedResultIDs], ["formula", "first", "later"]);
  assert.equal(state.prepareResultReveal([later]), undefined);
});

test("manual recognition waits for a fresh reload before opening, scrolling and focusing the result", async () => {
  const stale = createDeferred<StoredFigureResult[]>();
  const fresh = createDeferred<StoredFigureResult[]>();
  const result = createResult("recognized");
  let loads = 0;
  let opened = 0;
  let focused = 0;
  const scrolls: unknown[] = [];
  const scheduled: Array<() => void> = [];
  const panel = createPanel(async () => createPreview(), {
    getResults: () =>
      ++loads === 1
        ? stale.promise
        : loads === 2
          ? fresh.promise
          : Promise.resolve([result]),
    reader: {
      setSidebarOpen: (open: boolean) => {
        assert.equal(open, true);
        opened++;
      },
    } as PdfReader,
    ownerWindow: {
      setTimeout: (callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    } as unknown as Window,
  });
  const state = panel as unknown as {
    panelContent: HTMLDivElement;
    results: StoredFigureResult[];
    resultCards: Map<string, HTMLElement>;
    selectedResultIDs: Set<string>;
    scrollContainer: HTMLElement;
    loadingResults: boolean;
    renderContent(): void;
    openPanel(): void;
  };
  state.panelContent = {
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 30 }) }),
  } as unknown as HTMLDivElement;
  state.scrollContainer = {
    isConnected: true,
    scrollTop: 200,
    getBoundingClientRect: () => ({ top: 50 }),
    scrollTo: (options: unknown) => scrolls.push(options),
  } as unknown as HTMLElement;
  state.renderContent = () => {
    state.resultCards.clear();
    for (const { id } of state.results)
      state.resultCards.set(id, {
        isConnected: true,
        getBoundingClientRect: () => ({ top: 500 }),
        focus: () => focused++,
      } as unknown as HTMLElement);
  };
  let activated = 0;
  state.openPanel = () => activated++;
  panel.reloadResults();
  panel.reloadResults([{ pageIndex: 0, rect: [0, 0, 1, 1] }]);
  stale.resolve([createResult("stale")]);
  await waitFor(() => loads === 2);
  assert.equal(opened, 0);
  assert.equal(scheduled.length, 0);
  fresh.resolve([result]);
  await waitFor(() => !state.loadingResults);
  assert.equal(opened, 1);
  assert.equal(activated, 1);
  assert.deepEqual([...state.selectedResultIDs], ["recognized"]);
  scheduled.shift()!();
  assert.deepEqual(scrolls, [{ behavior: "smooth", top: 614 }]);
  assert.equal(focused, 1);
  panel.reloadResults();
  await waitFor(() => !state.loadingResults);
  assert.equal(opened, 1);
  assert.equal(scheduled.length, 0);
});

function createPanel(
  onPrepareCorrection: FigureSidebarPanelOptions["onPrepareCorrection"],
  overrides: Partial<FigureSidebarPanelOptions> = {},
): FigureSidebarPanel {
  const options: FigureSidebarPanelOptions = {
    getCachedTranslations: async () => new Map(),
    getResults: async () => [],
    isAnalyzing: () => false,
    onAddAllToNote: async () => {},
    onAddToNote: async () => {},
    onAnalyze: () => {},
    onOpenGallery: () => {},
    onSelectRegion: () => {},
    onCorrectCaption: () => {},
    onRecognizeRegion: async () => {},
    onCacheTranslations: async () => new Map(),
    onCancelAnalysis: () => {},
    onClear: async () => {},
    onCopyImage: async () => {},
    onCopyLatex: async (result) => result,
    onCorrectRegion: async () => undefined,
    onEditComment: async () => undefined,
    onEditLatex: async () => undefined,
    onGoToPage: async () => {},
    onPrepareCorrection,
    onPrepareLatexEdit: async (result) =>
      result.latex
        ? {
            imageIdentity: `identity:${result.imagePath}`,
            latex: result.latex,
            result,
          }
        : undefined,
    onRemove: async () => {},
    onRunBatch: async () => ({ completedIDs: [], errors: [] }),
    onRerecognizeLatex: async (result) => result,
    onResultsDisplayed: () => {},
    onSaveImage: async () => {},
    onSyncAnnotations: async () => {},
    ownerWindow: globalThis as unknown as Window,
    reader: {} as PdfReader,
    ...overrides,
  };
  return new FigureSidebarPanel(options);
}

function createResult(id: string): StoredFigureResult {
  return {
    comment: id,
    id,
    imageFile: `${id}.png`,
    imagePath: `/tmp/${id}.png`,
    kind: "figure",
    pageIndex: 0,
    pageLabel: "1",
    rect: [0.1, 0.1, 0.9, 0.9],
    tag: "Figure 1",
  };
}

function createPreview(): ResultCorrectionPreview {
  return {
    detectedRect: [0.1, 0.1, 0.9, 0.9],
    imageURL: "data:image/jpeg;base64,",
    pageAspectRatio: 0.75,
    rect: [0.1, 0.1, 0.9, 0.9],
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for sidebar formula state");
}
