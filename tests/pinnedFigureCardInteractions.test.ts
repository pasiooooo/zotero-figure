import * as assert from "node:assert/strict";
import test from "node:test";
import {
  bindPinnedFigureCard,
  type PinnedFigureCard,
} from "../src/features/reader/pinnedFigureCardView";

const testGlobals = globalThis as typeof globalThis & { addon: typeof addon };

class EventTargetStub {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, properties: Record<string, unknown> = {}) {
    const event = {
      type,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class ElementStub extends EventTargetStub {
  children: ElementStub[] = [];
  parent?: ElementStub;
  attributes = new Map<string, string>();
  classes = new Set<string>();
  className = "";
  classList = {
    add: (...names: string[]) =>
      names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) =>
      names.forEach((name) => this.classes.delete(name)),
    toggle: (name: string, value: boolean) =>
      value ? this.classes.add(name) : this.classes.delete(name),
  };
  style = {
    width: "200px",
    transform: "",
    getPropertyValue: () => "",
    setProperty() {},
    removeProperty() {},
  };
  offsetWidth = 200;
  offsetHeight = 150;
  removed = false;
  constructor(
    readonly tag = "div",
    readonly ownerDocument?: DocumentStub,
  ) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(child: ElementStub) {
    child.parent = this;
    this.children.push(child);
  }
  prepend(child: ElementStub) {
    child.parent = this;
    this.children.unshift(child);
  }
  contains(target: ElementStub | null): boolean {
    return (
      target === this || this.children.some((child) => child.contains(target))
    );
  }
  closest(selector: string): ElementStub | null {
    if (selector.split(", ").includes(this.tag)) return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelector(selector: string): ElementStub | null {
    return (
      this.children.find((child) => child.className === selector.slice(1)) ??
      null
    );
  }
  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 150,
      width: 200,
      height: 150,
    };
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  remove() {
    this.removed = true;
  }
  setPointerCapture() {}
  hasPointerCapture() {
    return true;
  }
  releasePointerCapture() {}
}

class DocumentStub extends EventTargetStub {
  documentElement = { clientWidth: 1000, clientHeight: 800 };
  defaultView = new EventTargetStub();
  activeElement?: ElementStub;
  frames: Array<EventTargetStub & { contentDocument: DocumentStub }> = [];
  createElement(tag: string) {
    return new ElementStub(tag, this);
  }
  createElementNS(_namespace: string, tag: string) {
    return this.createElement(tag);
  }
  querySelectorAll() {
    return this.frames;
  }
}

function floatingCard(document = new DocumentStub()) {
  const previousAddon = testGlobals.addon;
  testGlobals.addon = { data: {} } as typeof addon;
  const ownerDocument = new DocumentStub();
  const pdfDocument = new DocumentStub();
  const frame = Object.assign(new EventTargetStub(), {
    contentDocument: pdfDocument,
  });
  document.frames.push(frame);
  const element = document.createElement("article");
  const media = document.createElement("div");
  media.className = "zoterofigure-card-image";
  const menu = document.createElement("div");
  menu.className = "zoterofigure-card-end";
  element.append(media);
  element.append(menu);
  const timers = new Map<number, () => void>();
  let timerID = 0;
  let releases = 0;
  let closes = 0;
  let card: PinnedFigureCard;
  try {
    card = bindPinnedFigureCard({
      element: element as unknown as HTMLElement,
      ownerWindow: {
        document: ownerDocument,
        setTimeout: (callback: () => void) => {
          timers.set(++timerID, callback);
          return timerID;
        },
        clearTimeout: (id: number) => timers.delete(id),
      } as unknown as Window,
      onActivate() {},
      onClose: () => {
        closes++;
        card.dispose();
      },
      releaseImageURL: () => {
        releases++;
      },
      sourceGeometry: {
        right: 200,
        top: 20,
        width: 200,
        fontFamily: "",
        fontSize: "",
        lineHeight: "",
      },
      stagger: 0,
    });
  } finally {
    testGlobals.addon = previousAddon;
  }
  return {
    card,
    document,
    ownerDocument,
    pdfDocument,
    frame,
    element,
    media,
    pin: menu.children[0],
    get closes() {
      return closes;
    },
    get releases() {
      return releases;
    },
    flushTimers() {
      for (const [id, callback] of timers) {
        timers.delete(id);
        callback();
      }
    },
    togglePin() {
      testGlobals.addon = { data: {} } as typeof addon;
      try {
        menu.children[0].emit("click");
      } finally {
        testGlobals.addon = previousAddon;
      }
    },
  };
}

test("floating cards persist through all clicks and close with Escape from any reader document", () => {
  for (const surface of ["document", "ownerDocument", "pdfDocument"] as const) {
    const view = floatingCard();
    view.document.emit("click", { target: view.media });
    assert.equal(view.closes, 0);
    view.flushTimers();
    view[surface].emit("click", { target: new ElementStub() });
    assert.equal(view.closes, 0);
    view[surface].emit("keydown", { key: "Escape", target: new ElementStub() });
    assert.equal(view.closes, 1);
    assert.equal(view.releases, 1);
    for (const doc of [view.document, view.ownerDocument, view.pdfDocument]) {
      assert.equal(doc.listeners.get("click")?.size ?? 0, 0);
      assert.equal(doc.listeners.get("keydown")?.size, 0);
    }
    assert.equal(view.frame.listeners.get("load")?.size, 0);
  }
  const view = floatingCard();
  view.flushTimers();
  view.document.emit("click", { target: view.media });
  assert.equal(view.closes, 0);
  view.card.dispose();
});

test("Escape dismisses an unfocused temporary card including after a PDF frame reload", () => {
  const view = floatingCard();
  const reloaded = new DocumentStub();
  view.frame.contentDocument = reloaded;
  view.frame.emit("load");
  reloaded.emit("keydown", { key: "Escape", target: new ElementStub() });
  assert.equal(view.closes, 1);
  assert.equal(reloaded.listeners.get("keydown")?.size, 0);
});

test("pinning does not arm Escape, even when the Reader leaves focus in the card", () => {
  const view = floatingCard();
  view.flushTimers();
  view.document.emit("click", { target: view.pin });
  assert.equal(view.closes, 0);
  view.togglePin();
  assert.equal(view.pin.attributes.get("aria-pressed"), "true");
  assert.equal(view.element.classes.has("is-pinned"), true);
  for (const doc of [view.document, view.ownerDocument, view.pdfDocument]) {
    doc.emit("click", { target: new ElementStub() });
    doc.emit("keydown", { key: "Escape", target: new ElementStub() });
  }
  view.element.emit("dblclick");
  assert.equal(view.closes, 0);
  view.document.emit("keydown", { key: "Escape", target: view.element });
  assert.equal(view.closes, 0);
  view.document.emit("pointerdown", { button: 0, target: view.media });
  assert.equal(view.element.classes.has("is-selected"), true);
  view.document.emit("keydown", { key: "Escape", target: view.element });
  assert.equal(view.closes, 1);
  view.card.dispose();
  assert.equal(view.releases, 1);
});

test("clicking elsewhere clears a pinned card selection despite stale Reader focus", () => {
  const view = floatingCard();
  view.togglePin();
  for (const doc of [view.document, view.ownerDocument, view.pdfDocument]) {
    view.document.emit("pointerdown", { button: 0, target: view.media });
    doc.emit("pointerdown", { button: 0, target: new ElementStub() });
    view.document.emit("keydown", { key: "Escape", target: view.element });
    assert.equal(view.closes, 0);
    assert.equal(view.element.classes.has("is-selected"), false);
  }
  view.document.emit("pointerdown", { button: 0, target: view.media });
  view.document.defaultView.emit("blur");
  view.document.emit("keydown", { key: "Escape", target: view.element });
  assert.equal(view.closes, 0);
  view.document.emit("keydown", { key: " ", target: view.element });
  view.document.emit("keydown", { key: "Escape", target: view.element });
  assert.equal(view.closes, 1);
});

test("unpinning restores Escape dismissal and dragging or clicking does not close the card", () => {
  const view = floatingCard();
  view.flushTimers();
  view.togglePin();
  view.togglePin();
  assert.equal(view.pin.attributes.get("aria-pressed"), "false");
  const pointer = {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 50,
    clientY: 50,
    target: view.media,
  };
  view.element.emit("pointerdown", pointer);
  view.element.emit("pointermove", { ...pointer, clientX: 100 });
  view.element.emit("pointerup", { ...pointer, clientX: 100 });
  view.document.emit("click", { target: view.media });
  view.element.emit("click", { target: view.media });
  assert.equal(view.closes, 0);
  view.flushTimers();
  view.document.emit("click", { target: view.media });
  assert.equal(view.closes, 0);
  view.document.emit("keydown", { key: "Escape", target: new ElementStub() });
  assert.equal(view.closes, 1);
});

test("successive floating cards remain open together and Escape closes all unpinned cards", () => {
  const document = new DocumentStub();
  const first = floatingCard(document);
  const second = floatingCard(document);
  const fixed = floatingCard(document);
  fixed.togglePin();
  document.emit("click", { target: new ElementStub() });
  assert.equal(first.closes + second.closes + fixed.closes, 0);
  document.emit("keydown", { key: "Escape", target: new ElementStub() });
  assert.equal(first.closes, 1);
  assert.equal(second.closes, 1);
  assert.equal(fixed.closes, 0);
  fixed.card.dispose();
});

test("fitting a floating card scales its entire content into the allocated cell and preserves its pin", () => {
  const view = floatingCard();
  view.togglePin();
  view.card.fitTo({ x: 400, y: 300, width: 80, height: 60 });
  assert.equal(
    view.element.style.transform,
    "translate3d(400px, 300px, 0) scale(0.4)",
  );
  assert.equal(view.pin.attributes.get("aria-pressed"), "true");
  view.card.fitTo({ x: 250, y: 200, width: 200, height: 150 });
  assert.equal(
    view.element.style.transform,
    "translate3d(250px, 200px, 0) scale(1)",
  );
  view.card.dispose();
});
