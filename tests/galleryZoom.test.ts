import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import {
  FIGURE_GALLERY_IMAGE_SCALE_DEFAULT,
  FIGURE_GALLERY_IMAGE_SCALE_MIN,
  FIGURE_GALLERY_IMAGE_SCALE_MAX,
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
  let timerID = 0;
  const view = {
    disposed: false,
    controlsDisabled: false,
    batchBusy: false,
    imageScale: 100,
    imageScalePersistencePending: false,
    imageScalePersistenceTimer: undefined,
    viewMode: mode,
    galleryRenderedCards: [{}],
    galleryColumnCount: 4,
    GALLERY_SCALE_STEP: 10,
    GALLERY_SCALE_PERSIST_DEBOUNCE_MS: 160,
    FIGURE_GALLERY_IMAGE_SCALE_DEFAULT,
    FIGURE_GALLERY_IMAGE_SCALE_MIN,
    FIGURE_GALLERY_IMAGE_SCALE_MAX,
    elements: {
      scaleRange: { value: "100" },
      scaleValue: { textContent: "100%" },
    },
    galleryApi: { setImageScale: (value: number) => persisted.push(value) },
    window: {
      clearTimeout: (id: number) => timers.delete(id),
      setTimeout: (callback: () => void) => {
        timers.set(++timerID, callback);
        return timerID;
      },
    },
    captureGalleryScrollAnchor: () => anchor,
    restoreGalleryScrollAnchor: (value: unknown) => anchors.push(value),
    reflowGalleryColumns: (_count: number, value: unknown) =>
      anchors.push(value),
    calculateGalleryColumnCount: () => 4,
    applyGalleryDimensionVariables() {},
    scheduleComparisonThumbnailFormulaFit() {},
  };
  const api = runInNewContext(
    zoomFunctions +
      "\n({ handleGalleryZoomKeydown, handleGalleryZoomWheel, flushGalleryImageScalePersistence });",
    view,
  ) as {
    handleGalleryZoomKeydown(event: unknown): void;
    handleGalleryZoomWheel(event: unknown): void;
    flushGalleryImageScalePersistence(): void;
  };
  return { view, api, persisted, anchors, anchor, timers };
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

test("Ctrl and Command zoom shortcuts share slider state, preserve the visible card and persist the last scale", () => {
  for (const mode of ["waterfall", "document-columns"]) {
    const { view, api, persisted, anchors, anchor, timers } = createView(mode);
    for (const key of ["+", "="]) {
      const event = input({ key, ctrlKey: true });
      api.handleGalleryZoomKeydown(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(event.stopped, true);
    }
    api.handleGalleryZoomKeydown(input({ key: "-", metaKey: true }));
    api.handleGalleryZoomKeydown(input({ code: "NumpadAdd", metaKey: true }));
    api.handleGalleryZoomKeydown(
      input({ code: "NumpadSubtract", ctrlKey: true }),
    );
    assert.equal(view.imageScale, 110);
    assert.equal(view.elements.scaleRange.value, "110");
    assert.equal(view.elements.scaleValue.textContent, "110%");
    assert.equal(anchors.length, 5);
    assert.ok(anchors.every((value) => value === anchor));
    assert.equal(timers.size, 1);
    assert.deepEqual(persisted, []);
    api.flushGalleryImageScalePersistence();
    assert.deepEqual(persisted, [110]);
    assert.equal(timers.size, 0);
  }
});

test("modified wheel zooms up/down in pixel, line and page modes, while ordinary scrolling is untouched", () => {
  const { view, api } = createView();
  for (const deltaMode of [0, 1, 2]) {
    const up = input({ deltaY: -3, deltaMode, ctrlKey: true });
    api.handleGalleryZoomWheel(up);
    assert.equal(view.imageScale, 110);
    assert.equal(up.defaultPrevented, true);
    assert.equal(up.stopped, true);
    api.handleGalleryZoomWheel(input({ deltaY: 3, deltaMode, metaKey: true }));
    assert.equal(view.imageScale, 100);
  }
  for (const event of [
    input({ deltaY: 100 }),
    input({ deltaY: 0, ctrlKey: true }),
    input({ deltaY: 10, ctrlKey: true, altKey: true }),
  ]) {
    api.handleGalleryZoomWheel(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(view.imageScale, 100);
  }
});

test("zoom clamps to existing limits and suppresses native zoom even at a limit or while controls are busy", () => {
  const { view, api } = createView();
  for (let i = 0; i < 30; i++)
    api.handleGalleryZoomKeydown(input({ key: "+", ctrlKey: true }));
  assert.equal(view.imageScale, 200);
  for (let i = 0; i < 30; i++)
    api.handleGalleryZoomWheel(input({ deltaY: 100, metaKey: true }));
  assert.equal(view.imageScale, 50);
  const atLimit = input({ key: "-", ctrlKey: true });
  api.handleGalleryZoomKeydown(atLimit);
  assert.equal(atLimit.defaultPrevented, true);
  for (const flag of ["controlsDisabled", "batchBusy"] as const) {
    view[flag] = true;
    const event = input({ key: "+", deltaY: -100, ctrlKey: true });
    api.handleGalleryZoomKeydown(event);
    assert.equal(event.defaultPrevented, true);
    api.handleGalleryZoomWheel(input({ deltaY: -100, metaKey: true }));
    assert.equal(view.imageScale, 50);
    view[flag] = false;
  }
});

test("plain typing, unrelated shortcuts, IME composition and already-handled events do not zoom", () => {
  const { view, api, anchors } = createView();
  for (const event of [
    input({ key: "+" }),
    input({ key: "a", ctrlKey: true }),
    input({ key: "=", ctrlKey: true, altKey: true }),
    input({ key: "+", metaKey: true, isComposing: true }),
    input({ key: "+", ctrlKey: true, defaultPrevented: true }),
  ]) {
    api.handleGalleryZoomKeydown(event);
    assert.equal(event.stopped, false);
  }
  view.disposed = true;
  api.handleGalleryZoomKeydown(input({ key: "+", ctrlKey: true }));
  api.handleGalleryZoomWheel(input({ deltaY: -100, metaKey: true }));
  assert.equal(view.imageScale, 100);
  assert.equal(anchors.length, 0);
});
