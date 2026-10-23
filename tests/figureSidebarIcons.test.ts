import * as assert from "node:assert/strict";
import test from "node:test";
import {
  getFigureSidebarIconParts,
  setFigureMenuIcon,
} from "../src/features/reader/figureSidebarIcons";

test("uses the requested sigma path for formula results", () => {
  assert.deepEqual(getFigureSidebarIconParts("formula"), [
    [
      "path",
      {
        d: "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
      },
    ],
  ]);
});

test("defines drawable parts for every sidebar icon", () => {
  for (const kind of [
    "all",
    "annotation",
    "check",
    "clear",
    "copy",
    "edit",
    "expand",
    "export",
    "figure",
    "folder",
    "formula",
    "group",
    "languages",
    "loading",
    "menu",
    "note",
    "pin",
    "refresh",
    "region",
    "search",
    "select",
    "table",
    "trash",
  ] as const) {
    assert.ok(getFigureSidebarIconParts(kind).length > 0, kind);
  }
});

test("native menus use cached SVG images and inherit the menu text color", () => {
  for (const localName of ["menu", "menuitem"]) {
    const attributes = new Map<string, string>();
    const classes: string[] = [];
    const item = {
      localName,
      classList: { add: (value: string) => classes.push(value) },
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
    } as unknown as Element;
    setFigureMenuIcon(item, "annotation");
    const image = attributes.get("image")!;
    assert.ok(image.startsWith("data:image/svg+xml,"));
    const svg = decodeURIComponent(image.slice(image.indexOf(",") + 1));
    assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 16 16"/);
    assert.match(svg, /fill="context-fill"/);
    assert.match(attributes.get("style")!, /-moz-context-properties: fill/);
    assert.deepEqual(classes, [
      localName === "menu" ? "menu-iconic" : "menuitem-iconic",
    ]);
    setFigureMenuIcon(item, "annotation");
    assert.equal(attributes.get("image"), image);
  }
});
