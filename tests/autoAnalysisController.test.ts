import * as assert from "node:assert/strict";
import test from "node:test";
import { AutoAnalysisController } from "../src/features/library/autoAnalysisController";
import type {
  AnalysisOptions,
  LayoutAnalyzer,
} from "../src/services/layout/layoutAnalyzer";
import { OperationCancelledError } from "../src/utils/cancellation";

function harness() {
  const previousZotero = globalThis.Zotero;
  const globals = globalThis as typeof globalThis & {
    ztoolkit: typeof ztoolkit;
  };
  const previousToolkit = globals.ztoolkit;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  const items = new Map<number, Zotero.Item>();
  const calls: number[] = [];
  const completed: number[] = [];
  const logs: unknown[] = [];
  let enabled = false;
  let registrations = 0;
  let unregisters = 0;
  let reads = 0;
  let timerID = 0;
  let notify!: (event: string, type: string, ids: number[]) => void;
  let preferenceChanged!: () => void;
  let analyze: (
    id: number,
    options: AnalysisOptions,
  ) => Promise<{ totalPages: number }> = async () => ({ totalPages: 1 });
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++timerID;
    if (delay === 0) queueMicrotask(callback);
    else timers.set(id, callback);
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) =>
    timers.delete(id)) as unknown as typeof clearTimeout;
  globalThis.Zotero = {
    Prefs: {
      get: (key: string) =>
        key.endsWith("autoAnalyzeNewPdfs") ? enabled : false,
      registerObserver: (_key: string, callback: () => void) => {
        preferenceChanged = callback;
        return Symbol();
      },
      unregisterObserver: () => unregisters++,
    },
    Items: {
      get: (id: number) => items.get(id) ?? false,
      getAsync: async (id: number) => {
        reads++;
        return items.get(id) ?? false;
      },
    },
    Notifier: {
      registerObserver: (observer: { notify: typeof notify }) => {
        notify = observer.notify;
        registrations++;
        return "auto";
      },
      unregisterObserver: () => unregisters++,
    },
    logError: (error: unknown) => logs.push(error),
  } as unknown as typeof Zotero;
  globals.ztoolkit = {
    log: (...args: unknown[]) => logs.push(args),
  } as unknown as typeof ztoolkit;
  const analyzer = {
    analyzeAttachment: async (
      item: Zotero.Item,
      _progress: unknown,
      options: AnalysisOptions,
    ) => {
      calls.push(item.id);
      assert.equal(options.skipIfAnalyzed, true);
      assert.equal(options.duplicateMode, "skip-existing");
      return analyze(item.id, options);
    },
  } as unknown as LayoutAnalyzer;
  const controller = new AutoAnalysisController(analyzer, async (item) => {
    completed.push(item.id);
  });
  controller.start();
  return {
    controller,
    timers,
    items,
    calls,
    completed,
    logs,
    reads: () => reads,
    registrations: () => registrations,
    unregisters: () => unregisters,
    setAnalyzer: (callback: typeof analyze) => {
      analyze = callback;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
      preferenceChanged();
    },
    notify: (event: string, ids: number[]) => notify(event, "item", ids),
    add(id: number, path: string | false = "file.pdf") {
      const item = {
        id,
        deleted: false,
        isPDFAttachment: () => true,
        getFilePathAsync: async () => path,
      } as unknown as Zotero.Item;
      items.set(id, item);
      return item;
    },
    async tick() {
      const timer = timers.entries().next().value as
        | [number, () => void]
        | undefined;
      assert.ok(timer, "a batch or retry timer should be scheduled");
      timers.delete(timer[0]);
      timer[1]();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    restore() {
      controller.dispose();
      globalThis.Zotero = previousZotero;
      globals.ztoolkit = previousToolkit;
      globalThis.setTimeout = previousSetTimeout;
      globalThis.clearTimeout = previousClearTimeout;
    },
  };
}

test("off by default, ignores existing library and non-PDF notifications", async () => {
  const h = harness();
  try {
    h.add(1);
    h.notify("add", [1]);
    assert.equal(h.timers.size, 0);
    h.setEnabled(true);
    h.controller.start();
    assert.equal(h.registrations(), 1);
    assert.equal(h.timers.size, 0);
    h.notify("modify", [1]);
    const other = h.add(2);
    other.isPDFAttachment = () => false;
    h.notify("add", [2]);
    assert.equal(h.timers.size, 0);
    h.notify("add", [1]);
    await h.tick();
    assert.deepEqual(h.completed, [1]);
  } finally {
    h.restore();
  }
});

test("1000 imported PDFs share one timer and await one analysis at a time", async () => {
  const h = harness();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    h.setEnabled(true);
    h.setAnalyzer(async (id) => {
      if (id === 1) await blocked;
      return { totalPages: 1 };
    });
    const ids = Array.from({ length: 1000 }, (_, index) => h.add(index + 1).id);
    h.notify("add", ids);
    h.notify("add", ids);
    assert.equal(h.timers.size, 1);
    assert.equal(h.reads(), 0);
    await h.tick();
    h.notify("add", [1]);
    assert.deepEqual(h.calls, [1]);
    assert.equal(h.reads(), 1);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(h.calls, ids);
    assert.deepEqual(h.completed, ids);
    assert.equal(h.timers.size, 0);
  } finally {
    release();
    h.restore();
  }
});

test("missing files retry without blocking ready PDFs, and retries are finite", async () => {
  const h = harness();
  try {
    h.setEnabled(true);
    const delayed = h.add(1, false);
    h.add(2);
    h.add(3, false);
    h.notify("add", [1, 2, 3]);
    await h.tick();
    assert.deepEqual(h.calls, [2]);
    delayed.getFilePathAsync = async () => "ready.pdf";
    await h.tick();
    assert.deepEqual(h.calls, [2, 1]);
    for (let attempt = 2; attempt < 30; attempt++) await h.tick();
    assert.equal(h.timers.size, 0);
    assert.equal(h.logs.length, 1);
  } finally {
    h.restore();
  }
});

test("failed, already analyzed, deleted and trashed PDFs do not block subsequent work", async () => {
  const h = harness();
  try {
    h.setEnabled(true);
    for (let id = 1; id <= 5; id++) h.add(id);
    h.setAnalyzer(async (id) => {
      if (id === 1) throw new Error("invalid PDF");
      return { totalPages: id === 2 ? 0 : 1 };
    });
    h.notify("add", [1, 2, 3, 4, 5]);
    h.notify("trash", [3]);
    h.items.delete(4);
    await h.tick();
    assert.deepEqual(h.calls, [1, 2, 5]);
    assert.deepEqual(h.completed, [5]);
    assert.equal(h.logs.length, 1);
    assert.equal(h.timers.size, 0);
  } finally {
    h.restore();
  }
});

test("disabling cancels active work and clears pending PDFs; re-enabling only accepts new work", async () => {
  const h = harness();
  let signal: AbortSignal | undefined;
  try {
    h.setEnabled(true);
    h.add(1);
    h.add(2);
    h.add(3);
    h.setAnalyzer(async (id, options) => {
      if (id !== 1) return { totalPages: 1 };
      signal = options.signal;
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener(
          "abort",
          () => reject(new OperationCancelledError()),
          { once: true },
        ),
      );
      return { totalPages: 1 };
    });
    h.notify("add", [1, 2]);
    await h.tick();
    h.setEnabled(false);
    assert.equal(signal?.aborted, true);
    h.setEnabled(true);
    h.notify("add", [3]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await h.tick();
    assert.deepEqual(h.calls, [1, 3]);
    assert.deepEqual(h.completed, [3]);
    h.notify("add", [2]);
    h.controller.dispose();
    assert.equal(h.timers.size, 0);
    assert.equal(h.unregisters(), 2);
  } finally {
    h.restore();
  }
});
