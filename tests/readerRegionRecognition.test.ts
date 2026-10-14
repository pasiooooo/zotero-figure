import * as assert from "node:assert/strict";
import test from "node:test";
import { FigureReaderController } from "../src/features/reader/figureReaderController";
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
    await controller.runAnalysis({ _item: {} } as PdfReader, [
      { pageIndex: 0, rect: [0, 0, 100, 100] },
    ]);
    assert.deepEqual(options, [false]);
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
