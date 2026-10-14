import * as assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync(
  "src/features/gallery/figureGalleryView.ts",
  "utf8",
);
const code = transformSync(
  source.slice(
    source.indexOf("function scheduleComparisonRendering("),
    source.indexOf("function getVisibleComparisonCellEntries("),
  ),
  { loader: "ts" },
).code;

test("comparison card creation is bounded per frame and cancels stale viewport work", () => {
  const frames = new Map<number, () => void>();
  let id = 0;
  let time = 0;
  let disconnected = 0;
  let created = 0;
  const cells = Array.from({ length: 100 }, () => ({
    isConnected: true,
    dataset: { viewRowId: "row", documentId: "1" },
  }));
  const context = {
    disposed: false,
    renderVersion: 1,
    comparisonRenderFrame: undefined,
    pendingComparisonCells: new Set(cells),
    comparisonCellObserver: {
      unobserve() {},
      disconnect: () => disconnected++,
    },
    comparisonRowsByID: new Map([["row", {}]]),
    comparisonSourceRowIDs: new Map([["entry", "row"]]),
    performance: { now: () => time },
    window: {
      requestAnimationFrame: (callback: () => void) => {
        frames.set(++id, callback);
        return id;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    },
    populateComparisonCell: () => {
      created++;
    },
  };
  const api = runInNewContext(
    code + "\n({scheduleComparisonRendering, cancelComparisonRendering})",
    context,
  ) as {
    scheduleComparisonRendering(version: number): void;
    cancelComparisonRendering(): void;
  };
  const frame = () => {
    const [key, callback] = frames.entries().next().value!;
    frames.delete(key);
    callback();
  };
  api.scheduleComparisonRendering(1);
  api.scheduleComparisonRendering(1);
  assert.equal(created, 0);
  assert.equal(frames.size, 1);
  frame();
  assert.equal(created, 12);
  context.populateComparisonCell = () => {
    created++;
    time += 3;
  };
  frame();
  assert.equal(created, 15);
  context.renderVersion = 2;
  frame();
  assert.equal(created, 15);
  api.scheduleComparisonRendering(2);
  api.cancelComparisonRendering();
  assert.equal(frames.size, 0);
  assert.equal(context.pendingComparisonCells.size, 0);
  assert.equal(context.comparisonRowsByID.size, 0);
  assert.equal(disconnected, 1);
});

test("comparison formula updates patch only the matching card", () => {
  const code = transformSync(
    source.slice(
      source.indexOf("function applyFormulaLatexUpdate("),
      source.indexOf("function updateFormulaLatexEntry("),
    ),
    { loader: "ts" },
  ).code;
  const media = { querySelector: () => null };
  const entry = { id: "formula", kind: "formula" };
  let renders = 0;
  const context = {
    disposed: false,
    libraryLoader: undefined,
    entriesByID: new Map([[entry.id, entry]]),
    galleryRenderedCards: [
      { dataset: { id: entry.id }, querySelector: () => media },
    ],
    viewMode: "document-columns",
    renderGalleryFormula: () => renders++,
    renderResults: () => assert.fail("must not rebuild the comparison board"),
  };
  const update = runInNewContext(
    code + "\napplyFormulaLatexUpdate",
    context,
  ) as (id: string, latex: string) => void;
  update("formula", "x^2");
  assert.equal(renders, 1);
  update("offscreen", "y");
  assert.equal(renders, 1);
});
