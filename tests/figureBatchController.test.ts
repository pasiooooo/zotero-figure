import * as assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FigureBatchController,
  resolvePdfAttachments,
} from "../src/features/library/figureBatchController";
import type { FormulaLatexCoordinator } from "../src/services/formula/formulaLatexCoordinator";
import type {
  AnalysisOptions,
  LayoutAnalyzer,
} from "../src/services/layout/layoutAnalyzer";
import type { FigureResultStore } from "../src/services/results/figureResultStore";
import { OperationCancelledError } from "../src/utils/cancellation";

const controllerSource = readFileSync(
  "src/features/library/figureBatchController.ts",
  "utf8",
);

test("keeps the PDF Figure menu enabled while a batch is running", () => {
  assert.doesNotMatch(controllerSource, /isDisabled/);
  assert.match(controllerSource, /batch-progress-already-running/);
});

test("resolves selected literature to unique PDFs in selection order", async () => {
  const firstPdf = makePdf(101);
  const secondPdf = makePdf(202);
  const selected = [
    makeRegularItem(1, firstPdf),
    firstPdf,
    makeRegularItem(2, false),
    makeRegularItem(3, secondPdf),
  ];

  assert.deepEqual(await resolvePdfAttachments(selected), [
    firstPdf,
    secondPdf,
  ]);
});

test("dispose aborts the active attachment analysis", async () => {
  const previousAddon = (globalThis as any).addon;
  const previousZotero = globalThis.Zotero;
  const previousZtoolkit = (globalThis as any).ztoolkit;
  const pdf = makePdf(101) as Zotero.Item & {
    getDisplayTitle(): string;
  };
  pdf.getDisplayTitle = () => "PDF";
  let observedSignal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const analyzer = {
    analyzeAttachment: async (
      _attachment: Zotero.Item,
      _progress: unknown,
      options: { signal?: AbortSignal },
    ) => {
      observedSignal = options.signal;
      markStarted();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new OperationCancelledError());
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as LayoutAnalyzer;
  const resultStore = {
    hasAnalysis: async () => false,
    list: async () => assert.fail("cancelled analysis must not load results"),
  } as unknown as FigureResultStore;
  const formulaLatex = {
    recognizeAttachment: () =>
      assert.fail("cancelled analysis must not continue"),
  } as unknown as FormulaLatexCoordinator;

  class ProgressWindow {
    public changeLine(): this {
      return this;
    }
    public createLine(): this {
      return this;
    }
    public show(): this {
      return this;
    }
    public startCloseTimer(): this {
      return this;
    }
  }

  (globalThis as any).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: Array<{ id: string }>) => [
            { value: id },
          ],
        },
      },
    },
  };
  (globalThis as any).ztoolkit = {
    Menu: { register: () => undefined, unregister: () => undefined },
    ProgressWindow,
  };
  globalThis.Zotero = {
    getActiveZoteroPane: () => ({ getSelectedItems: () => [pdf] }),
    getMainWindow: () => ({}),
    logError: (error: Error) => assert.fail(error.message),
  } as unknown as typeof Zotero;
  const controller = new FigureBatchController(
    analyzer,
    resultStore,
    formulaLatex,
  );

  try {
    controller.start();
    const running = (
      controller as unknown as {
        run(action: "analyze"): Promise<void>;
      }
    ).run("analyze");
    await started;
    controller.dispose();
    await running;

    assert.equal(observedSignal?.aborted, true);
  } finally {
    controller.dispose();
    (globalThis as any).addon = previousAddon;
    globalThis.Zotero = previousZotero;
    (globalThis as any).ztoolkit = previousZtoolkit;
  }
});

for (const action of ["analyze", "annotations", "note"] as const) {
  for (const scenario of [
    {
      name: "new PDFs",
      existing: [],
      choice: 0,
      expected: [101, 202],
      skipped: 0,
    },
    {
      name: "overwrite",
      existing: [101],
      choice: 0,
      expected: [101, 202],
      skipped: 0,
    },
    { name: "skip", existing: [101], choice: 2, expected: [202], skipped: 1 },
    {
      name: "skip all",
      existing: [101, 202],
      choice: 2,
      expected: [],
      skipped: 2,
    },
    { name: "cancel", existing: [101], choice: 1, expected: [], skipped: 0 },
    {
      name: "cancel during preflight",
      existing: [101],
      choice: 0,
      expected: [],
      skipped: 0,
      abort: true,
    },
    {
      name: "unreadable record",
      existing: [101],
      choice: 0,
      expected: [],
      skipped: 0,
      error: true,
    },
  ]) {
    test(`${action} batch handles ${scenario.name} before analyzing`, async () => {
      const previousAddon = (globalThis as any).addon;
      const previousZotero = globalThis.Zotero;
      const previousZtoolkit = (globalThis as any).ztoolkit;
      const calls: Array<{ id: number; options: AnalysisOptions }> = [];
      const loaded: number[] = [];
      const recognized: number[] = [];
      const prompts: string[] = [];
      const errors: Error[] = [];
      const messages: Array<{ id: string; args?: Record<string, unknown> }> =
        [];
      class ProgressWindow {
        changeLine() {
          return this;
        }
        createLine() {
          return this;
        }
        show() {
          return this;
        }
        startCloseTimer() {
          return this;
        }
      }
      (globalThis as any).addon = {
        data: {
          locale: {
            current: {
              formatMessagesSync: (entries: typeof messages) => {
                messages.push(...entries);
                return entries.map(({ id, args }) => ({
                  value: `${id} ${JSON.stringify(args)}`,
                }));
              },
            },
          },
        },
      };
      (globalThis as any).ztoolkit = {
        Menu: { register() {}, unregister() {} },
        ProgressWindow,
        getGlobal: () => ({
          prompt: {
            BUTTON_POS_0: 1,
            BUTTON_POS_1: 256,
            BUTTON_POS_2: 65536,
            BUTTON_TITLE_IS_STRING: 127,
            BUTTON_TITLE_CANCEL: 2,
            BUTTON_POS_2_DEFAULT: 33554432,
            confirmEx: (_window: unknown, _title: string, text: string) => {
              prompts.push(text);
              return scenario.choice;
            },
          },
        }),
      };
      const firstPdf = makePdf(101);
      Object.assign(firstPdf, {
        topLevelItem: { getDisplayTitle: () => "Paper A" },
      });
      globalThis.Zotero = {
        getActiveZoteroPane: () => ({
          getSelectedItems: () => [firstPdf, makePdf(202)],
        }),
        getMainWindow: () => ({}),
        logError: (error: Error) => errors.push(error),
      } as unknown as typeof Zotero;
      const controller = new FigureBatchController(
        {
          analyzeAttachment: async (
            item: Zotero.Item,
            _progress: unknown,
            options: AnalysisOptions,
          ) => {
            calls.push({ id: item.id, options });
            return { annotationsCreated: 0 };
          },
        } as unknown as LayoutAnalyzer,
        {
          hasAnalysis: async (item: Zotero.Item) => {
            if (scenario.abort) controller.dispose();
            if (scenario.error) throw new Error("Cannot read saved analysis");
            return scenario.existing.includes(item.id);
          },
          list: async (item: Zotero.Item) => {
            loaded.push(item.id);
            return [];
          },
        } as unknown as FigureResultStore,
        {
          recognizeAttachment: (item: Zotero.Item) => recognized.push(item.id),
        } as unknown as FormulaLatexCoordinator,
      );
      try {
        controller.start();
        await (
          controller as unknown as { run(action: string): Promise<void> }
        ).run(action);
        assert.deepEqual(
          calls.map(({ id }) => id),
          scenario.expected,
        );
        assert.deepEqual(loaded, scenario.expected);
        assert.deepEqual(recognized, scenario.expected);
        for (const { id, options } of calls) {
          assert.equal(
            options.duplicateMode,
            scenario.existing.includes(id) ? "replace-page" : undefined,
          );
          assert.equal(options.syncAnnotations, action === "annotations");
        }
        assert.equal(
          prompts.length,
          scenario.existing.length && !scenario.abort && !scenario.error
            ? 1
            : 0,
        );
        if (prompts.length) {
          assert.match(prompts[0], /Paper A/);
          assert.match(prompts[0], /PDF 101/);
          for (const id of scenario.existing)
            assert.ok(prompts[0].includes(`[PDF${id}]`));
          if (!scenario.existing.includes(202))
            assert.doesNotMatch(prompts[0], /PDF202/);
        }
        const done = messages.find(({ id }) =>
          id.endsWith("batch-progress-done"),
        );
        if (scenario.choice === 1 || scenario.abort || scenario.error) {
          assert.equal(done, undefined);
        } else {
          assert.equal(done?.args?.skipped, scenario.skipped);
          assert.equal(done?.args?.succeeded, scenario.expected.length);
        }
        assert.equal(errors.length, scenario.error ? 1 : 0);
      } finally {
        controller.dispose();
        (globalThis as any).addon = previousAddon;
        globalThis.Zotero = previousZotero;
        (globalThis as any).ztoolkit = previousZtoolkit;
      }
    });
  }
}

function makePdf(id: number): Zotero.Item {
  return {
    getDisplayTitle: () => `PDF ${id}`,
    id,
    key: `PDF${id}`,
    isPDFAttachment: () => true,
    isRegularItem: () => false,
  } as unknown as Zotero.Item;
}

function makeRegularItem(
  id: number,
  attachment: Zotero.Item | false,
): Zotero.Item {
  return {
    getBestAttachment: async () => attachment,
    id,
    isPDFAttachment: () => false,
    isRegularItem: () => true,
  } as unknown as Zotero.Item;
}
