import * as assert from "node:assert/strict";
import test from "node:test";
import {
  startReaderRegionSelection,
  type ReaderRegionSelection,
} from "../src/features/reader/readerRegionSelection";
import type { PdfReader } from "../src/platform/zotero/reader";

class Target {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, properties: object = {}) {
    const event = {
      target: this,
      button: 0,
      pointerId: 1,
      preventDefault() {},
      stopImmediatePropagation() {},
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

class Element extends Target {
  children: Element[] = [];
  style: Record<string, string> = {};
  removed = false;
  focused = false;
  append(...children: Element[]) {
    this.children.push(...children);
  }
  setAttribute() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  remove() {
    this.removed = true;
  }
  focus() {
    this.focused = true;
  }
}

function harness(rotated = false, frameScale = 1) {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  globals.addon = { data: {} } as typeof addon;
  const win = new Target();
  const body = new Element();
  const document = {
    body,
    defaultView: win,
    createElement: () => new Element(),
  };
  const bounds = (
    left: number,
    top: number,
    width: number,
    height: number,
  ) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const pageElement = {
    dataset: { pageNumber: "2" },
    closest: () => pageElement,
    querySelector: () => ({
      getBoundingClientRect: () => bounds(20, 40, 200, 300),
    }),
  };
  const pdfDocument = Object.assign(new Target(), {
    elementsFromPoint: () => [pageElement],
  });
  const pdfWindow = Object.assign(new Target(), {
    document: pdfDocument,
    innerWidth: 400,
    innerHeight: 500,
    PDFViewerApplication: {
      pdfViewer: {
        getPageView: (index: number) => {
          assert.equal(index, 1);
          return {
            div: pageElement,
            viewport: {
              width: 400,
              height: 600,
              convertToPdfPoint: (x: number, y: number) =>
                rotated ? [y / 2, x / 2] : [x / 2, 300 - y / 2],
            },
          };
        },
      },
    },
  });
  const reader = {
    _internalReader: {
      _lastView: {
        _iframeWindow: pdfWindow,
        _iframe: {
          ownerDocument: document,
          getBoundingClientRect: () =>
            bounds(250, 50, 400 * frameScale, 500 * frameScale),
        },
      },
    },
  } as unknown as PdfReader;
  const results: ReaderRegionSelection[] = [];
  let closed = 0;
  const dispose = startReaderRegionSelection(
    reader,
    (region) => results.push(region),
    () => closed++,
  );
  const overlay = body.children[0];
  const pointer = (type: string, x: number, y: number) =>
    overlay.emit(type, {
      clientX: 250 + x * frameScale,
      clientY: 50 + y * frameScale,
    });
  return {
    results,
    overlay,
    win,
    pdfWindow,
    pdfDocument,
    dispose,
    pointer,
    closed: () => closed,
    restore: () => {
      dispose();
      globals.addon = previousAddon;
    },
  };
}

for (const rotated of [false, true]) {
  test(`screenshot drag maps the active page with iframe scaling and rotation=${rotated}`, () => {
    const h = harness(rotated, 2);
    try {
      assert.equal(h.overlay.focused, true);
      assert.equal(h.overlay.removed, false);
      h.pointer("pointerdown", 140, 220);
      h.pointer("pointermove", 60, 100);
      assert.equal(h.overlay.children[0].style.width, "160px");
      h.pointer("pointerup", 60, 100);
      assert.deepEqual(h.results, [
        {
          pageIndex: 1,
          rect: rotated ? [60, 40, 180, 120] : [40, 120, 120, 240],
        },
      ]);
      assert.equal(h.overlay.removed, true);
      assert.equal(h.closed(), 1);
      assert.equal(
        h.win.listenerCount() +
          h.pdfWindow.listenerCount() +
          h.pdfDocument.listenerCount(),
        0,
      );
    } finally {
      h.restore();
    }
  });
}

test("tiny clicks can be retried and dragging across pages clamps to the starting page", () => {
  const h = harness();
  try {
    h.pointer("pointerdown", 60, 100);
    h.pointer("pointerup", 62, 102);
    assert.deepEqual(h.results, []);
    assert.equal(h.overlay.removed, false);
    h.pointer("pointerdown", 60, 100);
    h.pointer("pointerup", 999, 999);
    assert.deepEqual(h.results, [{ pageIndex: 1, rect: [40, 0, 200, 240] }]);
  } finally {
    h.restore();
  }
});

for (const action of [
  "escape",
  "right-click",
  "cancel-button",
  "pointercancel",
  "resize",
  "scroll",
  "pagehide",
  "dispose",
] as const) {
  test(`selection cancels without recognition on ${action}`, () => {
    const h = harness();
    try {
      h.pointer("pointerdown", 60, 100);
      if (action === "escape") h.win.emit("keydown", { key: "Escape" });
      else if (action === "right-click") h.overlay.emit("contextmenu");
      else if (action === "cancel-button")
        h.overlay.children[1].children[1].emit("click");
      else if (action === "pointercancel") h.overlay.emit("pointercancel");
      else if (action === "scroll") h.pdfDocument.emit("scroll");
      else if (action === "dispose") h.dispose();
      else h.pdfWindow.emit(action);
      assert.equal(h.overlay.removed, true);
      assert.equal(h.closed(), 1);
      assert.deepEqual(h.results, []);
      assert.equal(
        h.win.listenerCount() +
          h.pdfWindow.listenerCount() +
          h.pdfDocument.listenerCount(),
        0,
      );
    } finally {
      h.restore();
    }
  });
}
