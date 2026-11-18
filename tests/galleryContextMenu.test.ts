import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync(
  "src/features/gallery/figureGalleryView.ts",
  "utf8",
);
const menuFunctions = transformSync(
  source.slice(
    source.indexOf("async function openGalleryContextMenu("),
    source.indexOf("function moveComparisonEntryToGroup("),
  ) +
    source.slice(
      source.indexOf("function closeGalleryContextMenu("),
      source.indexOf("function logGalleryError("),
    ),
  { loader: "ts" },
).code;

class MenuElement extends EventTarget {
  id = "";
  children: MenuElement[] = [];
  parent?: MenuElement;
  attributes = new Map<string, string>();

  constructor(
    readonly ownerDocument: MenuDocument,
    readonly tag: string,
  ) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(...children: MenuElement[]) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
  }
  openPopupAtScreen(screenX: number, screenY: number, context: boolean) {
    assert.ok(this.ownerDocument.active, "popup belongs to an inactive window");
    assert.equal(this.parent, this.ownerDocument.documentElement);
    this.ownerDocument.opened.push([screenX, screenY, context]);
  }
}

class MenuDocument {
  documentElement = new MenuElement(this, "window");
  browser = new MenuElement(this, "browser");
  opened: Array<[number, number, boolean]> = [];

  constructor(readonly active: boolean) {}
  createXULElement(tag: string) {
    return new MenuElement(this, tag);
  }
  querySelector(selector: string) {
    return selector === "#browser" ? this.browser : null;
  }
}

function createView(standalone = true) {
  const mainDocument = new MenuDocument(!standalone);
  const galleryDocument = standalone ? new MenuDocument(true) : mainDocument;
  const commands: string[] = [];
  const view = {
    window: {
      docShell: {
        chromeEventHandler: galleryDocument.browser,
      },
    },
    Zotero: { getMainWindow: () => ({ document: mainDocument }) },
    GALLERY_CONTEXT_MENU_ID: "pasiofigure-gallery-context-menu",
    comparisonLayout: undefined,
    selectedEntryIDs: new Set(["one", "two"]),
    filteredEntries: [{ id: "one" }, { id: "two" }],
    disposed: false,
    galleryContextMenuRequestID: 1,
    galleryContextMenu: undefined as MenuElement | undefined,
    renderVersion: 1,
    localize: async (id: string) => id,
    setFigureMenuIcon: () => {},
    runSelectedBatch: (action: string) => commands.push(action),
    selectAllGalleryEntries: () => commands.push("select-all"),
    clearGallerySelection: () => commands.push("clear-selection"),
    logGalleryError: (error: unknown) => assert.fail(String(error)),
  };
  const api = runInNewContext(
    menuFunctions + "\n({ openGalleryContextMenu, closeGalleryContextMenu });",
    view,
  ) as {
    openGalleryContextMenu(
      target: { entryID?: string },
      screenX: number,
      screenY: number,
      version: number,
      requestID: number,
    ): Promise<void>;
    closeGalleryContextMenu(): void;
  };
  return { api, view, galleryDocument, mainDocument, commands };
}

test("standalone Library mounts its native menu in the active viewer, not the main window or browser", async () => {
  const { api, view, galleryDocument, mainDocument, commands } = createView();
  await api.openGalleryContextMenu({ entryID: "one" }, 300, 400, 1, 1);
  const popup = view.galleryContextMenu!;
  assert.equal(popup.ownerDocument, galleryDocument);
  assert.deepEqual(galleryDocument.opened, [[300, 400, true]]);
  assert.equal(mainDocument.documentElement.children.length, 0);
  assert.equal(galleryDocument.browser.children.length, 0);
  for (const item of popup.children) {
    if (item.attributes.get("disabled") !== "true")
      item.dispatchEvent(new Event("command"));
  }
  assert.deepEqual(commands, [
    "annotations",
    "export",
    "select-all",
    "clear-selection",
    "delete",
  ]);
  popup.dispatchEvent(new Event("popuphidden"));
  assert.equal(view.galleryContextMenu, undefined);
  assert.equal(galleryDocument.documentElement.children.length, 0);
});

test("Library menus retain the main-window fallback when no chrome host is exposed", async () => {
  const { api, view, galleryDocument } = createView(false);
  Object.assign(view.window, { docShell: undefined });
  await api.openGalleryContextMenu({}, 10, 20, 1, 1);
  assert.deepEqual(galleryDocument.opened, [[10, 20, true]]);
  api.closeGalleryContextMenu();
  assert.equal(galleryDocument.documentElement.children.length, 0);
});

test("closing Library while menu labels load cancels the native popup", async () => {
  const { api, view, galleryDocument } = createView();
  const opening = api.openGalleryContextMenu({}, 10, 20, 1, 1);
  view.disposed = true;
  api.closeGalleryContextMenu();
  await opening;
  assert.deepEqual(galleryDocument.opened, []);
  assert.equal(galleryDocument.documentElement.children.length, 0);
});
