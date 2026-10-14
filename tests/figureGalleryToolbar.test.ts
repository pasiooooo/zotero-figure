import * as assert from "node:assert/strict";
import test from "node:test";
import { config } from "../package.json";
import { FigureGalleryController } from "../src/features/gallery/figureGalleryController";

test("main toolbar opens the gallery once per command and cleans up on window unload", () => {
  const globals = globalThis as typeof globalThis & { addon: typeof addon };
  const previousAddon = globals.addon;
  globals.addon = { data: {} } as typeof addon;
  try {
    let available = false;
    let opened = 0;
    const children: EventTarget[] = [];
    const spacer = {};
    const attributes = new Map<string, string>();
    const toolbar = {
      querySelector: (selector: string) => {
        assert.equal(selector, "spacer");
        return spacer;
      },
      insertBefore: (button: EventTarget, before: unknown) => {
        assert.equal(before, spacer);
        children.push(button);
      },
    };
    const owner = {
      document: {
        getElementById: (id: string) =>
          id === "zotero-items-toolbar"
            ? available && toolbar
            : id === `${config.addonRef}-open-gallery`
              ? children[0]
              : null,
        createXULElement: (tag: string) => {
          assert.equal(tag, "toolbarbutton");
          return Object.assign(new EventTarget(), {
            setAttribute: (name: string, value: string) =>
              attributes.set(name, value),
            remove: () => children.splice(0, 1),
          });
        },
      },
    } as unknown as Window;
    const controller = new FigureGalleryController(owner);
    controller.open = () => opened++;
    controller.start();
    assert.equal(children.length, 0);
    available = true;
    controller.start();
    controller.start();
    assert.equal(children.length, 1);
    assert.ok(attributes.get("aria-label"));
    assert.equal(attributes.get("tooltiptext"), attributes.get("aria-label"));
    assert.equal(attributes.get("tabindex"), "0");
    children[0].dispatchEvent(new Event("command"));
    assert.equal(opened, 1);
    controller.dispose();
    assert.equal(children.length, 0);
    controller.start();
    assert.equal(children.length, 1);
    children[0].dispatchEvent(new Event("command"));
    assert.equal(opened, 2);
    controller.dispose();
    assert.equal(children.length, 0);
  } finally {
    globals.addon = previousAddon;
  }
});
