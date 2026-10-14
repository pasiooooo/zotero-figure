import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import {
  FIGURE_GALLERY_IMAGE_SCALE_DEFAULT,
  FIGURE_GALLERY_IMAGE_SCALE_MIN,
  FIGURE_GALLERY_IMAGE_SCALE_MAX,
  normalizeImageScale,
} from "../src/services/results/figureGalleryPreferences";

const source = readFileSync(
  "src/features/gallery/figureGalleryView.ts",
  "utf8",
);
const zoomFunctions = transformSync(
  source.slice(
    source.indexOf("function handleGalleryZoomKeydown("),
    source.indexOf("function handleScaleKeydown("),
  ) +
    source.slice(
      source.indexOf("function setGalleryImageScale("),
      source.indexOf("function applyGalleryDimensionVariables("),
    ),
  { loader: "ts" },
).code;

function createView(mode = "waterfall") {
  const persisted: number[] = [];
  const anchors: unknown[] = [];
  const anchor = { id: "visible-card", offset: 40 };
  const timers = new Map<number, () => void>();
  const frames = new Map<number, () => void>();
  let timerID = 0;
  let applied = 0;
  let captures = 0;
  let reflows = 0;
  let pagination = 0;
  let fits = 0;
  const view = {
    disposed: false,
    controlsDisabled: false,
    batchBusy: false,
    imageScale: 100,
    imageScalePersistencePending: false,
    imageScalePersistenceTimer: undefined,
    galleryZoomFrame: undefined,
    galleryZoomTimer: undefined,
    galleryZoomAnchor: undefined,
    galleryWheelScale: undefined,
    galleryResizeTimer: undefined,
    viewMode: mode,
    galleryRenderedCards: [{}],
    galleryColumnCount: 4,
    galleryColumns: [{ getBoundingClientRect: () => ({ height: 400 }) }],
    galleryColumnCardCounts: [2],
    galleryColumnHeights: [] as number[],
    GALLERY_COLUMN_GAP: 14,
    GALLERY_SCALE_SETTLE_MS: 140,
    GALLERY_SCALE_PERSIST_DEBOUNCE_MS: 160,
    FIGURE_GALLERY_IMAGE_SCALE_DEFAULT,
    FIGURE_GALLERY_IMAGE_SCALE_MIN,
    FIGURE_GALLERY_IMAGE_SCALE_MAX,
    normalizeImageScale,
    elements: { scaleRange: { value: "100" }, scaleValue: { value: "100" } },
    galleryApi: { setImageScale: (value: number) => persisted.push(value) },
    window: {
      innerHeight: 800,
      clearTimeout: (id: number) => timers.delete(id),
      setTimeout: (callback: () => void) => {
        timers.set(++timerID, callback);
        return timerID;
      },
      requestAnimationFrame: (callback: () => void) => {
        frames.set(++timerID, callback);
        return timerID;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    },
    sentinelObserver: { disconnect() {} },
    removePaginationSentinel() {},
    installPaginationSentinel: () => pagination++,
    captureGalleryScrollAnchor: () => {
      captures++;
      return anchor;
    },
    restoreGalleryScrollAnchor: (value: unknown) => anchors.push(value),
    reflowGalleryColumns: (_count: number, value: unknown) => {
      reflows++;
      anchors.push(value);
    },
    calculateGalleryColumnCount: () => 4,
    applyGalleryDimensionVariables: () => applied++,
    scheduleComparisonThumbnailFormulaFit: () => fits++,
  };
  const api = runInNewContext(
    zoomFunctions +
      "\n({ handleGalleryZoomKeydown, handleGalleryZoomWheel, setGalleryImageScale, finishGalleryZoom, cancelGalleryZoom, flushGalleryImageScalePersistence });",
    view,
  ) as {
    handleGalleryZoomKeydown(event: unknown): void;
    handleGalleryZoomWheel(event: unknown): void;
    setGalleryImageScale(value: number, persist: boolean): void;
    finishGalleryZoom(): void;
    cancelGalleryZoom(): void;
    flushGalleryImageScalePersistence(): void;
  };
  return {
    view,
    api,
    persisted,
    anchors,
    anchor,
    timers,
    frames,
    stats: () => ({ applied, captures, reflows, pagination, fits }),
    frame: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    key: "",
    code: "",
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...overrides,
  };
}

test("wheel bursts update at most once per frame, capture one anchor and reflow only after settling", () => {
  const h = createView();
  h.view.calculateGalleryColumnCount = () => 3;
  for (let i = 0; i < 100; i++)
    h.api.handleGalleryZoomWheel(input({ deltaY: -1, ctrlKey: true }));
  assert.equal(h.view.imageScale, 122);
  assert.equal(h.frames.size, 1);
  assert.equal(h.stats().applied, 0);
  assert.equal(h.stats().captures, 1);
  assert.equal(h.stats().reflows, 0);
  h.frame();
  assert.equal(h.stats().applied, 1);
  assert.equal(h.stats().reflows, 0);
  h.api.finishGalleryZoom();
  assert.equal(h.stats().reflows, 1);
  assert.ok(h.anchors.every((value) => value === h.anchor));
  h.api.flushGalleryImageScalePersistence();
  assert.deepEqual(h.persisted, [122]);
  assert.equal(h.timers.size, 0);
});

test("unchanged column count preserves nodes and refreshes heights for pagination; comparison fitting waits for idle", () => {
  for (const mode of ["waterfall", "document-columns"]) {
    const h = createView(mode);
    h.api.setGalleryImageScale(137, true);
    h.api.setGalleryImageScale(138, true);
    assert.equal(h.stats().fits, 0);
    h.api.finishGalleryZoom();
    assert.equal(h.stats().applied, 1);
    assert.equal(h.stats().reflows, 0);
    assert.equal(h.stats().pagination, 1);
    assert.equal(h.stats().fits, mode === "document-columns" ? 1 : 0);
    if (mode === "waterfall") assert.equal(h.view.galleryColumnHeights[0], 414);
    assert.equal(h.frames.size, 0);
  }
});

test("wheel respects magnitude and pixel/line/page units, including sub-percent trackpad input", () => {
  for (const [deltaY, deltaMode] of [
    [-16, 0],
    [-1, 1],
    [-0.02, 2],
  ]) {
    const h = createView();
    h.api.handleGalleryZoomWheel(input({ deltaY, deltaMode, ctrlKey: true }));
    assert.equal(h.view.imageScale, 103);
  }
  const h = createView();
  for (let i = 0; i < 100; i++)
    h.api.handleGalleryZoomWheel(input({ deltaY: -0.1, metaKey: true }));
  assert.equal(h.view.imageScale, 102);
  const unchanged = h.view.imageScale;
  for (const event of [
    input({ deltaY: 100 }),
    input({ deltaY: 0, ctrlKey: true }),
    input({ deltaY: 10, ctrlKey: true, altKey: true }),
  ]) {
    h.api.handleGalleryZoomWheel(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.view.imageScale, unchanged);
  }
});

test("keyboard zoom is proportional, supports reset, broad limits and shared exact percentage input", () => {
  const h = createView();
  h.api.setGalleryImageScale(300, true);
  const event = input({ key: "+", ctrlKey: true });
  h.api.handleGalleryZoomKeydown(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(h.view.imageScale, 330);
  h.api.handleGalleryZoomKeydown(
    input({ code: "NumpadSubtract", metaKey: true }),
  );
  assert.equal(h.view.imageScale, 300);
  h.api.handleGalleryZoomKeydown(input({ key: "0", metaKey: true }));
  assert.equal(h.view.imageScale, 100);
  for (const [value, expected] of [
    [137, 137],
    [9999, 1000],
    [-1, 10],
    [NaN, 100],
  ]) {
    h.api.setGalleryImageScale(value, true);
    assert.equal(h.view.imageScale, expected);
    assert.equal(h.view.elements.scaleValue.value, String(expected));
    assert.equal(h.view.elements.scaleRange.value, String(expected));
  }
});

test("filter/mode changes and unload cancel pending layout work without losing the latest saved scale", () => {
  const h = createView();
  h.api.setGalleryImageScale(173, true);
  h.api.cancelGalleryZoom();
  h.api.flushGalleryImageScalePersistence();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.stats().reflows, 0);
  assert.deepEqual(h.persisted, [173]);
  assert.match(source, /function renderResults\([\s\S]*?cancelGalleryZoom\(\)/);
  assert.match(
    source,
    /function dispose\(\): void \{\s*disposed = true;\s*cancelGalleryZoom\(\)/,
  );
});

test("busy controls suppress native zoom; typing, IME and handled events do not zoom", () => {
  const h = createView();
  for (const flag of ["controlsDisabled", "batchBusy"] as const) {
    h.view[flag] = true;
    const event = input({ key: "+", deltaY: -100, ctrlKey: true });
    h.api.handleGalleryZoomKeydown(event);
    assert.equal(event.defaultPrevented, true);
    h.api.handleGalleryZoomWheel(input({ deltaY: -100, metaKey: true }));
    assert.equal(h.view.imageScale, 100);
    h.view[flag] = false;
  }
  for (const event of [
    input({ key: "+" }),
    input({ key: "a", ctrlKey: true }),
    input({ key: "+", metaKey: true, isComposing: true }),
    input({ key: "+", ctrlKey: true, defaultPrevented: true }),
  ]) {
    h.api.handleGalleryZoomKeydown(event);
    assert.equal(event.stopped, false);
  }
  h.view.disposed = true;
  h.api.handleGalleryZoomWheel(input({ deltaY: -100, ctrlKey: true }));
  assert.equal(h.view.imageScale, 100);
  assert.equal(h.frames.size, 0);
});
