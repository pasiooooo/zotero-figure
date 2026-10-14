import * as assert from "node:assert/strict";
import test from "node:test";
import { OperationCancelledError } from "../src/utils/cancellation";
import { FigureReaderController } from "../src/features/reader/figureReaderController";
import type { StoredFigureResult } from "../src/services/results/figureResultStore";
import type { Rect } from "../src/domain/layout";
import type { PdfReader } from "../src/platform/zotero/reader";

type Region = { pageIndex: number; rect: Rect };
interface MenuEntry {
  label: string;
  disabled?: boolean;
  onCommand(): void;
}
interface ControllerInternals {
  started: boolean;
  annotationContextMenuHandler(event: {
    append(entry: MenuEntry): void;
    params: { ids: string[] };
    reader: PdfReader;
  }): void;
  runAnalysis(reader: PdfReader, regions?: readonly Region[]): Promise<void>;
  startRegionSelection(reader: PdfReader): void;
  createProgress(text: string): { startCloseTimer(delay: number): void };
}

test("region menu snapshots only selected image annotations and defers recognition", () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  globals.addon = { data: {} } as typeof addon;
  try {
    const queued: Array<() => void> = [];
    const controller = makeController({
      setTimeout: (callback: () => void) => {
        queued.push(callback);
        return 1;
      },
    });
    controller.started = true;
    const annotation = {
      id: "selected",
      type: "image",
      tags: [],
      position: { pageIndex: 2, rects: [[10, 20, 50, 60]] },
    };
    const reader = {
      type: "pdf",
      _item: { id: 1, libraryID: 1 },
      _internalReader: {
        _annotationManager: {
          _annotations: [
            annotation,
            { ...annotation, id: "not-selected" },
            { ...annotation, id: "text", type: "highlight" },
          ],
        },
      },
    } as unknown as PdfReader;
    const commands: MenuEntry[] = [];
    const calls: Array<readonly Region[] | undefined> = [];
    controller.runAnalysis = async (_reader, regions) => {
      calls.push(regions);
    };
    controller.annotationContextMenuHandler({
      reader,
      params: { ids: ["selected", "text"] },
      append: (entry) => commands.push(entry),
    });
    const command = commands.find(({ label }) =>
      label.endsWith("reader-menu-recognize-region"),
    )!;
    assert.ok(command);
    annotation.position.rects[0][0] = 999;
    command.onCommand();
    assert.equal(calls.length, 0);
    queued.shift()!();
    assert.deepEqual(calls, [[{ pageIndex: 2, rect: [10, 20, 50, 60] }]]);
    command.onCommand();
    controller.started = false;
    queued.shift()!();
    assert.equal(calls.length, 1);
  } finally {
    globals.addon = previousAddon;
  }
});

test("region selection reports an unavailable PDF view instead of silently switching tools", () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  const previousZotero = globalThis.Zotero;
  globals.addon = { data: {} } as typeof addon;
  globalThis.Zotero = { logError() {} } as unknown as typeof Zotero;
  try {
    const alerts: string[] = [];
    const tools: unknown[] = [];
    const controller = makeController({
      alert: (message: string) => alerts.push(message),
    });
    const internal = {
      _state: { readOnly: false },
      setTool: (tool: unknown) => tools.push(tool),
    };
    const reader = { _internalReader: internal } as unknown as PdfReader;
    controller.startRegionSelection(reader);
    assert.deepEqual(tools, []);
    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].endsWith("region-selection-unavailable"));
  } finally {
    globals.addon = previousAddon;
    globalThis.Zotero = previousZotero;
  }
});

test("manual region recognition never enables annotation mirroring", async () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  const previousZotero = globalThis.Zotero;
  globals.addon = { data: {} } as typeof addon;
  globalThis.Zotero = {
    Prefs: { get: () => true },
    logError: (error: Error) => {
      throw error;
    },
  } as unknown as typeof Zotero;
  try {
    const options: unknown[] = [];
    const controller = new FigureReaderController(
      { AbortController } as unknown as Window,
      {
        formulaLatex: { subscribe: () => () => {}, recognizeAttachment() {} },
        galleryIndex: {},
        resultStore: {},
        layoutAnalyzer: {
          analyzeRegion: async (
            _item: unknown,
            _page: number,
            _rect: Rect,
            option: { syncAnnotations: boolean },
          ) => {
            options.push(option.syncAnnotations);
            return {
              annotations: { created: 0 },
              results: { created: 1, removed: 0, skipped: 0 },
            };
          },
        },
      } as unknown as ConstructorParameters<typeof FigureReaderController>[1],
    ) as unknown as ControllerInternals;
    const reader = { _item: {} } as PdfReader;
    const regions: Region[] = [{ pageIndex: 0, rect: [0, 0, 100, 100] }];
    const revealed: unknown[] = [];
    (
      controller as unknown as { sidebarPanels: Map<PdfReader, unknown> }
    ).sidebarPanels.set(reader, {
      refreshControls() {},
      updateAnalysisProgress() {},
      reloadResults: (regions: unknown) => revealed.push(regions),
    });
    await controller.runAnalysis(reader, regions);
    assert.deepEqual(revealed, [regions]);
    assert.deepEqual(options, [false]);
  } finally {
    globals.addon = previousAddon;
    globalThis.Zotero = previousZotero;
  }
});

test("empty, failed and cancelled recognition do not request focus; reused results do", async () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  const previousZotero = globalThis.Zotero;
  globals.addon = { data: {} } as typeof addon;
  globalThis.Zotero = { logError() {} } as unknown as typeof Zotero;
  try {
    const regions: Region[] = [0, 1].map((pageIndex) => ({
      pageIndex,
      rect: [0, 0, 100, 100],
    }));
    const cases: Array<{
      outcomes: Array<number | Error>;
      expected: Region[];
    }> = [
      { outcomes: [0], expected: [] },
      { outcomes: [1], expected: regions.slice(0, 1) },
      { outcomes: [new Error("failed")], expected: [] },
      { outcomes: [new OperationCancelledError()], expected: [] },
      { outcomes: [1, new Error("second region failed")], expected: [] },
    ];
    for (const scenario of cases) {
      const outcomes = [...scenario.outcomes];
      const reader = { _item: {} } as PdfReader;
      const reloads: unknown[] = [];
      const controller = new FigureReaderController(
        { AbortController } as unknown as Window,
        {
          formulaLatex: { subscribe: () => () => {}, recognizeAttachment() {} },
          galleryIndex: {},
          resultStore: {},
          layoutAnalyzer: {
            analyzeRegion: async () => {
              const outcome = outcomes.shift()!;
              if (outcome instanceof Error) throw outcome;
              return {
                annotations: { created: 0 },
                results: { created: 0, removed: 0, skipped: outcome },
              };
            },
          },
        } as unknown as ConstructorParameters<typeof FigureReaderController>[1],
      ) as unknown as ControllerInternals & {
        sidebarPanels: Map<PdfReader, unknown>;
      };
      controller.sidebarPanels.set(reader, {
        refreshControls() {},
        updateAnalysisProgress() {},
        reloadResults: (regions: unknown) => reloads.push(regions),
      });
      await controller.runAnalysis(
        reader,
        regions.slice(0, scenario.outcomes.length),
      );
      assert.deepEqual(reloads, [scenario.expected]);
    }
  } finally {
    globals.addon = previousAddon;
    globalThis.Zotero = previousZotero;
  }
});

test("caption correction saves only the chosen result, preserves empty/error/cancelled captions and never starts paid formula recognition", async () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  const previousZotero = globalThis.Zotero;
  globals.addon = { data: {} } as typeof addon;
  globalThis.Zotero = { logError() {} } as unknown as typeof Zotero;
  const original = {
    id: "target",
    comment: "Old caption",
    kind: "figure",
    pageIndex: 0,
    rect: [0, 0, 50, 50],
  } as StoredFigureResult;
  try {
    for (const mode of [
      "success",
      "empty",
      "error",
      "cancelled",
      "missing",
    ] as const) {
      const saved: unknown[] = [];
      const displayed: unknown[] = [];
      const progress: string[] = [];
      const reader = { _item: {} } as PdfReader;
      const controller = new FigureReaderController(
        { AbortController } as unknown as Window,
        {
          galleryIndex: {},
          resultStore: {},
          formulaLatex: {
            subscribe: () => () => {},
            recognizeAttachment: () =>
              assert.fail("No formula API should run for a caption"),
          },
          layoutAnalyzer: {
            extractRegionText: async (
              _item: unknown,
              pageIndex: number,
              rect: Rect,
            ) => {
              assert.equal(pageIndex, 2);
              assert.deepEqual(rect, [10, 20, 100, 80]);
              if (mode === "error") throw new Error("read failed");
              if (mode === "cancelled")
                controller.activeAnalyses.get(reader)!.abort();
              return mode === "empty" ? "   " : "Figure 8. Correct text";
            },
          },
        } as unknown as ConstructorParameters<typeof FigureReaderController>[1],
      ) as unknown as {
        activeAnalyses: Map<PdfReader, AbortController>;
        sidebarPanels: Map<PdfReader, unknown>;
        correctResultCaption(
          reader: PdfReader,
          result: StoredFigureResult,
          region: Region,
        ): Promise<void>;
        editResultComment(
          reader: PdfReader,
          result: StoredFigureResult,
          comment: string,
        ): Promise<StoredFigureResult | undefined>;
      };
      controller.editResultComment = async (_reader, result, comment) => {
        saved.push({ id: result.id, comment });
        return mode === "missing" ? undefined : { ...result, comment };
      };
      controller.sidebarPanels.set(reader, {
        refreshControls() {},
        updateAnalysisProgress: (
          _text: string,
          _value: number,
          state: string,
        ) => progress.push(state),
        updateResult: (result: StoredFigureResult, reveal: boolean) =>
          displayed.push({ id: result.id, comment: result.comment, reveal }),
      });
      await controller.correctResultCaption(reader, original, {
        pageIndex: 2,
        rect: [10, 20, 100, 80],
      });
      assert.equal(original.comment, "Old caption");
      assert.equal(
        saved.length,
        mode === "success" || mode === "missing" ? 1 : 0,
      );
      assert.deepEqual(
        displayed,
        mode === "success"
          ? [{ id: "target", comment: "Figure 8. Correct text", reveal: true }]
          : [],
      );
      assert.equal(
        progress.at(-1),
        mode === "success"
          ? "success"
          : mode === "cancelled"
            ? "cancelled"
            : "error",
      );
      assert.equal(controller.activeAnalyses.size, 0);
    }
  } finally {
    globals.addon = previousAddon;
    globalThis.Zotero = previousZotero;
  }
});

function makeController(win: object): ControllerInternals {
  return new FigureReaderController(
    win as Window,
    {
      formulaLatex: { subscribe: () => () => {} },
      galleryIndex: {},
      layoutAnalyzer: {},
      resultStore: {},
    } as unknown as ConstructorParameters<typeof FigureReaderController>[1],
  ) as unknown as ControllerInternals;
}
