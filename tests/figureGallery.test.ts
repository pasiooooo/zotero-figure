import * as assert from "node:assert/strict";
import test from "node:test";
import {
  dissolveFigureGalleryComparisonRow,
  filterFigureGalleryComparisonLayout,
  findShortestFigureGalleryColumn,
  getFigureGalleryColumnCount,
  getFigureGalleryImageAspectRatio,
  insertFigureGalleryComparisonEntryAtRowEdge,
  insertFigureGalleryComparisonRow,
  moveFigureGalleryComparisonEntry,
  parseFigureGalleryComparisonLayout,
  reconcileFigureGalleryComparisonLayout,
  reorderFigureGalleryDocuments,
  setFigureGalleryComparisonPrimaryEntry,
  setFigureGalleryComparisonRowLabel,
  type FigureGalleryComparisonCell,
  type FigureGalleryComparisonLayout,
  type FigureGalleryEntry,
} from "../src/domain/figureGallery";
import type { FigureGalleryPlatform } from "../src/platform/zotero/figureGallery";
import { FigureGalleryIndex } from "../src/services/results/figureGalleryIndex";
import type { StoredFigureResult } from "../src/services/results/figureResultStore";

test("type filtering repacks each document without changing the saved comparison layout", () => {
  const entries = [
    { ...comparisonEntry("a-table", 1, 0), kind: "table" as const },
    comparisonEntry("a-1", 1, 1),
    { ...comparisonEntry("a-equation", 1, 2), kind: "formula" as const },
    comparisonEntry("a-2", 1, 3),
    comparisonEntry("b-1", 2, 0),
    { ...comparisonEntry("b-table", 2, 1), kind: "table" as const },
    comparisonEntry("b-2", 2, 2),
  ];
  const layout = reconcileFigureGalleryComparisonLayout(entries);
  const original = JSON.stringify(layout);
  const visible = entries.filter(({ kind }) => kind === "figure");
  const projected = filterFigureGalleryComparisonLayout(layout, visible);
  assert.deepEqual(
    projected.rows.map((row) =>
      Object.values(row.entries).map((cell) => cell.entryIDs[0]),
    ),
    [
      ["a-1", "b-1"],
      ["a-2", "b-2"],
    ],
  );
  assert.equal(JSON.stringify(layout), original);
  const named = setFigureGalleryComparisonRowLabel(
    layout,
    projected.rows[0].id,
    "Visible group",
    projected.rows[0],
  );
  const group = named.rows.find((row) => row.label === "Visible group")!;
  assert.deepEqual(group.entries, projected.rows[0].entries);
  const retained = named.rows.flatMap((row) =>
    Object.values(row.entries).flatMap((cell) => cell.entryIDs),
  );
  assert.deepEqual([...retained].sort(), entries.map(({ id }) => id).sort());
  assert.equal(new Set(retained).size, entries.length);
  assert.equal(JSON.stringify(layout), original);
});

test("filtered groups retain visible members and empty groups do not leave layout gaps", () => {
  const entries = [
    comparisonEntry("a", 1, 0),
    comparisonEntry("b", 2, 0),
    comparisonEntry("hidden", 1, 1),
  ];
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [2, 1],
    version: 3,
    rows: [
      {
        id: "a-row",
        label: "",
        isGroup: false,
        entries: { "1": comparisonCell("a") },
      },
      {
        id: "hidden-group",
        label: "Invisible",
        isGroup: true,
        entries: { "1": comparisonCell("hidden") },
      },
      {
        id: "b-row",
        label: "",
        isGroup: false,
        entries: { "2": comparisonCell("b") },
      },
    ],
  };
  const packed = filterFigureGalleryComparisonLayout(
    layout,
    entries.slice(0, 2),
  );
  assert.deepEqual(packed.documentOrder, [2, 1]);
  assert.equal(packed.rows.length, 1);
  assert.deepEqual(packed.rows[0].entries, {
    "1": comparisonCell("a"),
    "2": comparisonCell("b"),
  });
  layout.rows[0].isGroup = true;
  layout.rows[0].label = "Keep alignment";
  const grouped = filterFigureGalleryComparisonLayout(
    layout,
    entries.slice(0, 2),
  );
  assert.equal(grouped.rows[0].id, "a-row");
  assert.equal(grouped.rows[0].label, "Keep alignment");
  assert.equal(grouped.rows.length, 2);
});

test("large sparse libraries generate unique rows without losing document order or entries", () => {
  const entries = Array.from({ length: 12000 }, (_, index) =>
    comparisonEntry(`entry-${index}`, index % 100 === 0 ? 2 : 1, index),
  );
  const layout = reconcileFigureGalleryComparisonLayout(entries);
  assert.equal(layout.rows.length, 11880);
  assert.equal(
    new Set(layout.rows.map(({ id }) => id)).size,
    layout.rows.length,
  );
  const assigned = layout.rows.flatMap((row) =>
    Object.values(row.entries).flatMap((cell) => cell.entryIDs),
  );
  assert.equal(new Set(assigned).size, entries.length);
});

test("derives a stable preview ratio from the stored crop", () => {
  assert.equal(getFigureGalleryImageAspectRatio([10, 20, 110, 70]), 2);
  assert.equal(getFigureGalleryImageAspectRatio([10, 20, 10, 70]), undefined);
  assert.equal(
    getFigureGalleryImageAspectRatio([10, 20, Number.NaN, 70]),
    undefined,
  );
});

test("sizes and balances explicit waterfall columns", () => {
  assert.equal(getFigureGalleryColumnCount(1_000, 230, 14), 4);
  assert.equal(getFigureGalleryColumnCount(200, 230, 14), 1);
  assert.equal(getFigureGalleryColumnCount(0, 230, 14), 1);
  assert.equal(findShortestFigureGalleryColumn([120, 40, 40, 90]), 1);
});

test("builds aligned document rows and reconciles persisted results", () => {
  const entries = [
    comparisonEntry("a-1", 1, 0),
    comparisonEntry("a-2", 1, 2),
    comparisonEntry("b-1", 2, 1),
  ];
  const initial = reconcileFigureGalleryComparisonLayout(entries);

  assert.deepEqual(initial.documentOrder, [1, 2]);
  assert.equal(initial.version, 3);
  assert.deepEqual(initial.rows, [
    {
      entries: {
        "1": comparisonCell("a-1"),
        "2": comparisonCell("b-1"),
      },
      id: "comparison-row-1",
      isGroup: false,
      label: "",
    },
    {
      entries: { "1": comparisonCell("a-2") },
      id: "comparison-row-2",
      isGroup: false,
      label: "",
    },
  ]);

  const persisted = setFigureGalleryComparisonRowLabel(
    { ...initial, documentOrder: [2, 1] },
    "comparison-row-1",
    "Main result",
  );
  const reconciled = reconcileFigureGalleryComparisonLayout(
    [comparisonEntry("a-2", 1, 2), comparisonEntry("b-2", 2, 4)],
    persisted,
  );

  assert.deepEqual(reconciled.documentOrder, [2, 1]);
  assert.equal(reconciled.rows[0].label, "Main result");
  assert.equal(reconciled.rows[0].entries["1"], undefined);
  assert.equal(reconciled.rows[0].entries["2"], undefined);
  assert.deepEqual(reconciled.rows[1].entries["1"], comparisonCell("a-2"));
  assert.deepEqual(reconciled.rows[1].entries["2"], comparisonCell("b-2"));
});

test("compacts sparse ordinary rows while preserving each document order", () => {
  const layout = reconcileFigureGalleryComparisonLayout(
    [
      comparisonEntry("a-1", 1, 0),
      comparisonEntry("a-2", 1, 1),
      comparisonEntry("b-1", 2, 0),
      comparisonEntry("b-2", 2, 1),
    ],
    {
      documentOrder: [1, 2],
      rows: [
        {
          entries: { "1": comparisonCell("a-2") },
          id: "comparison-row-1",
          isGroup: false,
          label: "",
        },
        {
          entries: { "2": comparisonCell("b-1") },
          id: "comparison-row-2",
          isGroup: false,
          label: "",
        },
        {
          entries: { "1": comparisonCell("a-1") },
          id: "comparison-row-3",
          isGroup: false,
          label: "",
        },
        {
          entries: { "2": comparisonCell("b-2") },
          id: "comparison-row-4",
          isGroup: false,
          label: "",
        },
      ],
      version: 3,
    },
  );

  assert.deepEqual(
    layout.rows.map(({ id }) => id),
    ["comparison-row-1", "comparison-row-2"],
  );
  assert.deepEqual(layout.rows[0].entries, {
    "1": comparisonCell("a-2"),
    "2": comparisonCell("b-1"),
  });
  assert.deepEqual(layout.rows[1].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-2"),
  });
});

test("backfills a new document into the final ordinary row segment", () => {
  const layout = reconcileFigureGalleryComparisonLayout(
    [
      comparisonEntry("a-1", 1, 0),
      comparisonEntry("a-2", 1, 1),
      comparisonEntry("b-1", 2, 0),
      comparisonEntry("b-2", 2, 1),
    ],
    {
      documentOrder: [1],
      rows: [
        {
          entries: { "1": comparisonCell("a-1") },
          id: "comparison-row-1",
          isGroup: false,
          label: "",
        },
        {
          entries: { "1": comparisonCell("a-2") },
          id: "comparison-row-2",
          isGroup: false,
          label: "",
        },
      ],
      version: 3,
    },
  );

  assert.deepEqual(layout.documentOrder, [1, 2]);
  assert.deepEqual(layout.rows[0].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-1"),
  });
  assert.deepEqual(layout.rows[1].entries, {
    "1": comparisonCell("a-2"),
    "2": comparisonCell("b-2"),
  });
});

test("compacts ordinary rows without crossing an explicit group", () => {
  const layout = reconcileFigureGalleryComparisonLayout(
    [
      comparisonEntry("a-before", 1, 0),
      comparisonEntry("a-group-1", 1, 1),
      comparisonEntry("a-group-2", 1, 2),
      comparisonEntry("a-after", 1, 3),
      comparisonEntry("b-before", 2, 0),
      comparisonEntry("b-after", 2, 1),
    ],
    {
      documentOrder: [1, 2],
      rows: [
        {
          entries: { "1": comparisonCell("a-before") },
          id: "comparison-row-1",
          isGroup: false,
          label: "",
        },
        {
          entries: { "2": comparisonCell("b-before") },
          id: "comparison-row-2",
          isGroup: false,
          label: "",
        },
        {
          entries: {
            "1": {
              entryIDs: ["a-group-1", "a-group-removed", "a-group-2"],
              primaryEntryID: "a-group-removed",
            },
          },
          id: "comparison-row-3",
          isGroup: true,
          label: "Main result",
        },
        {
          entries: { "2": comparisonCell("b-after") },
          id: "comparison-row-4",
          isGroup: false,
          label: "",
        },
        {
          entries: { "1": comparisonCell("a-after") },
          id: "comparison-row-5",
          isGroup: false,
          label: "",
        },
      ],
      version: 3,
    },
  );

  assert.equal(layout.rows.length, 3);
  assert.deepEqual(layout.rows[0].entries, {
    "1": comparisonCell("a-before"),
    "2": comparisonCell("b-before"),
  });
  assert.deepEqual(layout.rows[1], {
    entries: {
      "1": {
        entryIDs: ["a-group-1", "a-group-2"],
        primaryEntryID: "a-group-1",
      },
    },
    id: "comparison-row-3",
    isGroup: true,
    label: "Main result",
  });
  assert.deepEqual(layout.rows[2].entries, {
    "1": comparisonCell("a-after"),
    "2": comparisonCell("b-after"),
  });
});

test("inserts comparison rows without changing existing image order", () => {
  const initial = reconcileFigureGalleryComparisonLayout([
    comparisonEntry("a-1", 1, 0),
    comparisonEntry("a-2", 1, 1),
    comparisonEntry("b-1", 2, 0),
  ]);
  const inserted = insertFigureGalleryComparisonRow(
    initial,
    "comparison-row-1",
  );
  assert.equal(inserted.rows.length, 3);
  assert.deepEqual(inserted.rows[0].entries, {});
  assert.equal(inserted.rows[0].isGroup, true);
  assert.deepEqual(inserted.rows[1].entries["1"], comparisonCell("a-1"));
  assert.deepEqual(inserted.rows[2].entries["1"], comparisonCell("a-2"));
  assert.deepEqual(initial.rows[0].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-1"),
  });
});

test("inserts one image from a grouped cell into a row gap", () => {
  const initial: FigureGalleryComparisonLayout = {
    documentOrder: [1],
    rows: [
      {
        entries: {
          "1": {
            entryIDs: ["a-1", "a-2"],
            primaryEntryID: "a-1",
          },
        },
        id: "comparison-row-1",
        isGroup: true,
        label: "",
      },
    ],
    version: 3,
  };
  const moved = insertFigureGalleryComparisonRow(initial, undefined, {
    documentID: 1,
    entryID: "a-1",
  });

  assert.deepEqual(moved.rows[0].entries["1"], comparisonCell("a-2"));
  assert.deepEqual(moved.rows[1].entries["1"], comparisonCell("a-1"));
  assert.equal(moved.rows[1].isGroup, false);
  assert.deepEqual(initial.rows[0].entries["1"], {
    entryIDs: ["a-1", "a-2"],
    primaryEntryID: "a-1",
  });
});

test("inserts a dragged image before or after the indicated comparison row", () => {
  const initial = reconcileFigureGalleryComparisonLayout([
    comparisonEntry("a-1", 1, 0),
    comparisonEntry("a-2", 1, 1),
  ]);

  const before = insertFigureGalleryComparisonEntryAtRowEdge(
    initial,
    "comparison-row-1",
    "before",
    { documentID: 1, entryID: "a-2" },
  );
  assert.deepEqual(
    before.rows.map(({ entries }) => entries["1"]?.primaryEntryID),
    ["a-2", "a-1"],
  );
  assert.deepEqual(
    before.rows.map(({ isGroup }) => isGroup),
    [false, false],
  );

  const after = insertFigureGalleryComparisonEntryAtRowEdge(
    initial,
    "comparison-row-1",
    "after",
    { documentID: 1, entryID: "a-2" },
  );
  assert.deepEqual(
    after.rows.map(({ entries }) => entries["1"]?.primaryEntryID),
    ["a-1", "a-2"],
  );
});

test("appends unassigned images without filling persisted comparison groups", () => {
  const layout = reconcileFigureGalleryComparisonLayout(
    [comparisonEntry("a-1", 1, 0), comparisonEntry("a-2", 1, 1)],
    {
      documentOrder: [1],
      rows: [
        {
          entries: {},
          id: "comparison-row-1",
          isGroup: true,
          label: "",
        },
        {
          entries: { "1": comparisonCell("a-1") },
          id: "comparison-row-2",
          isGroup: true,
          label: "",
        },
      ],
      version: 3,
    },
  );

  assert.deepEqual(layout.rows, [
    {
      entries: {},
      id: "comparison-row-1",
      isGroup: true,
      label: "",
    },
    {
      entries: { "1": comparisonCell("a-1") },
      id: "comparison-row-2",
      isGroup: true,
      label: "",
    },
    {
      entries: { "1": comparisonCell("a-2") },
      id: "comparison-row-3",
      isGroup: false,
      label: "",
    },
  ]);
});

test("prunes ordinary rows emptied by result changes but preserves groups", () => {
  const layout = reconcileFigureGalleryComparisonLayout(
    [comparisonEntry("retained", 1, 1)],
    {
      documentOrder: [1],
      rows: [
        {
          entries: { "1": comparisonCell("removed") },
          id: "comparison-row-1",
          isGroup: false,
          label: "",
        },
        {
          entries: {},
          id: "comparison-row-2",
          isGroup: true,
          label: "Main result",
        },
      ],
      version: 3,
    },
  );

  assert.deepEqual(
    layout.rows.map(({ id, isGroup }) => ({ id, isGroup })),
    [
      { id: "comparison-row-2", isGroup: true },
      { id: "comparison-row-1", isGroup: false },
    ],
  );
  assert.deepEqual(layout.rows[1].entries["1"], comparisonCell("retained"));
});

test("reorders comparison documents without changing row assignments", () => {
  const layout = reconcileFigureGalleryComparisonLayout([
    comparisonEntry("a-1", 1, 0),
    comparisonEntry("b-1", 2, 0),
    comparisonEntry("c-1", 3, 0),
  ]);
  const moved = reorderFigureGalleryDocuments(layout, 3, 1, true);

  assert.deepEqual(moved.documentOrder, [3, 1, 2]);
  assert.deepEqual(moved.rows[0].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-1"),
    "3": comparisonCell("c-1"),
  });
});

test("moves a comparison image into an empty row or an existing group", () => {
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [1],
    rows: [
      {
        entries: { "1": comparisonCell("a-1") },
        id: "comparison-row-1",
        isGroup: false,
        label: "",
      },
      {
        entries: {},
        id: "comparison-row-2",
        isGroup: true,
        label: "",
      },
    ],
    version: 3,
  };
  const moved = moveFigureGalleryComparisonEntry(
    layout,
    1,
    "a-1",
    1,
    "comparison-row-2",
  );

  assert.equal(moved.rows.length, 1);
  assert.deepEqual(moved.rows[0].entries, {
    "1": comparisonCell("a-1"),
  });
  assert.equal(moved.rows[0].isGroup, true);

  const occupiedLayout = reconcileFigureGalleryComparisonLayout([
    comparisonEntry("a-1", 1, 0),
    comparisonEntry("a-2", 1, 1),
  ]);

  const grouped = moveFigureGalleryComparisonEntry(
    occupiedLayout,
    1,
    "a-1",
    1,
    "comparison-row-2",
  );
  assert.equal(grouped.rows.length, 1);
  assert.deepEqual(grouped.rows[0].entries["1"], {
    entryIDs: ["a-2", "a-1"],
    primaryEntryID: "a-2",
  });
  assert.equal(grouped.rows[0].isGroup, true);
  assert.deepEqual(occupiedLayout.rows[0].entries["1"], comparisonCell("a-1"));
});

test("keeps an inside drop into an ordinary empty cell compactable", () => {
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [1, 2],
    rows: [
      {
        entries: {
          "1": comparisonCell("a-1"),
          "2": comparisonCell("b-1"),
        },
        id: "comparison-row-1",
        isGroup: false,
        label: "",
      },
      {
        entries: { "2": comparisonCell("b-2") },
        id: "comparison-row-2",
        isGroup: false,
        label: "",
      },
    ],
    version: 3,
  };

  const moved = moveFigureGalleryComparisonEntry(
    layout,
    1,
    "a-1",
    1,
    "comparison-row-2",
  );

  assert.equal(moved.rows[1].isGroup, false);
  assert.deepEqual(moved.rows[0].entries, {
    "2": comparisonCell("b-1"),
  });
  assert.deepEqual(moved.rows[1].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-2"),
  });

  const refreshed = reconcileFigureGalleryComparisonLayout(
    [
      comparisonEntry("a-1", 1, 0),
      comparisonEntry("b-1", 2, 0),
      comparisonEntry("b-2", 2, 1),
    ],
    moved,
  );
  assert.deepEqual(refreshed.rows[0].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-1"),
  });
  assert.deepEqual(refreshed.rows[1].entries, {
    "2": comparisonCell("b-2"),
  });
});

test("moves a primary image between grouped cells and repairs the source", () => {
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [1],
    rows: [
      {
        entries: {
          "1": { entryIDs: ["a-1", "a-2"], primaryEntryID: "a-1" },
        },
        id: "comparison-row-1",
        isGroup: true,
        label: "",
      },
      {
        entries: { "1": comparisonCell("a-3") },
        id: "comparison-row-2",
        isGroup: true,
        label: "",
      },
    ],
    version: 3,
  };

  const moved = moveFigureGalleryComparisonEntry(
    layout,
    1,
    "a-1",
    1,
    "comparison-row-2",
  );

  assert.deepEqual(moved.rows[0].entries["1"], comparisonCell("a-2"));
  assert.deepEqual(moved.rows[1].entries["1"], {
    entryIDs: ["a-3", "a-1"],
    primaryEntryID: "a-3",
  });
  assert.deepEqual(layout.rows[0].entries["1"]?.entryIDs, ["a-1", "a-2"]);
});

test("retains an emptied row when it is a named comparison group", () => {
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [1],
    rows: [
      {
        entries: { "1": comparisonCell("a-1") },
        id: "comparison-row-1",
        isGroup: true,
        label: "Main result",
      },
      {
        entries: { "1": comparisonCell("a-2") },
        id: "comparison-row-2",
        isGroup: false,
        label: "",
      },
    ],
    version: 3,
  };

  const moved = moveFigureGalleryComparisonEntry(
    layout,
    1,
    "a-1",
    1,
    "comparison-row-2",
  );

  assert.equal(moved.rows.length, 2);
  assert.deepEqual(moved.rows[0], {
    entries: {},
    id: "comparison-row-1",
    isGroup: true,
    label: "Main result",
  });
});

test("sets the primary comparison image without reordering the group", () => {
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [1],
    rows: [
      {
        entries: {
          "1": {
            entryIDs: ["a-1", "a-2", "a-3"],
            primaryEntryID: "a-1",
          },
        },
        id: "comparison-row-1",
        isGroup: true,
        label: "",
      },
    ],
    version: 3,
  };

  const updated = setFigureGalleryComparisonPrimaryEntry(
    layout,
    "comparison-row-1",
    1,
    "a-2",
  );
  assert.deepEqual(updated.rows[0].entries["1"], {
    entryIDs: ["a-1", "a-2", "a-3"],
    primaryEntryID: "a-2",
  });
  assert.equal(layout.rows[0].entries["1"]?.primaryEntryID, "a-1");

  const invalid = setFigureGalleryComparisonPrimaryEntry(
    updated,
    "comparison-row-1",
    1,
    "missing",
  );
  assert.equal(invalid.rows[0].entries["1"]?.primaryEntryID, "a-2");
});

test("dissolves a grouped row into aligned single-image rows", () => {
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [1, 2],
    rows: [
      {
        entries: { "1": comparisonCell("before") },
        id: "comparison-row-1",
        isGroup: true,
        label: "Before",
      },
      {
        entries: {
          "1": { entryIDs: ["a-1", "a-2"], primaryEntryID: "a-2" },
          "2": {
            entryIDs: ["b-1", "b-2", "b-3"],
            primaryEntryID: "b-2",
          },
        },
        id: "comparison-row-2",
        isGroup: true,
        label: "Main result",
      },
      {
        entries: { "2": comparisonCell("after") },
        id: "comparison-row-3",
        isGroup: true,
        label: "After",
      },
    ],
    version: 3,
  };

  const dissolved = dissolveFigureGalleryComparisonRow(
    layout,
    "comparison-row-2",
  );

  assert.deepEqual(
    dissolved.rows.map(({ id }) => id),
    [
      "comparison-row-1",
      "comparison-row-4",
      "comparison-row-5",
      "comparison-row-6",
      "comparison-row-3",
    ],
  );
  assert.deepEqual(dissolved.rows[1].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-1"),
  });
  assert.deepEqual(dissolved.rows[2].entries, {
    "1": comparisonCell("a-2"),
    "2": comparisonCell("b-2"),
  });
  assert.deepEqual(dissolved.rows[3].entries, {
    "2": comparisonCell("b-3"),
  });
  assert.equal(dissolved.rows[1].label, "");
  assert.equal(dissolved.rows[1].isGroup, false);
  assert.equal(layout.rows[1].label, "Main result");
});

test("migrates comparison layouts and sanitizes stored cells", () => {
  assert.equal(parseFigureGalleryComparisonLayout({ version: 4 }), undefined);
  assert.equal(parseFigureGalleryComparisonLayout("invalid"), undefined);
  assert.deepEqual(
    parseFigureGalleryComparisonLayout({
      documentOrder: [2, 2, "bad"],
      rows: [
        {
          entries: { "2": "entry", invalid: 3 },
          id: "row",
          label: "Result",
        },
      ],
      version: 1,
    }),
    {
      documentOrder: [2],
      rows: [
        {
          entries: { "2": comparisonCell("entry") },
          id: "row",
          isGroup: true,
          label: "Result",
        },
      ],
      version: 3,
    },
  );
  assert.deepEqual(
    parseFigureGalleryComparisonLayout({
      documentOrder: [2],
      rows: [
        {
          entries: {
            "2": {
              entryIDs: ["first", "first", 3, ""],
              primaryEntryID: 3,
            },
            "3": { entryIDs: [], primaryEntryID: "" },
          },
          id: "row",
          label: "Result",
        },
      ],
      version: 2,
    }),
    {
      documentOrder: [2],
      rows: [
        {
          entries: { "2": comparisonCell("first") },
          id: "row",
          isGroup: true,
          label: "Result",
        },
      ],
      version: 3,
    },
  );
});

test("cleans ambiguous version 2 groups while preserving structural groups", () => {
  assert.deepEqual(
    parseFigureGalleryComparisonLayout({
      documentOrder: [1, 2],
      rows: [
        {
          entries: {
            "1": comparisonCell("ordinary-a"),
            "2": comparisonCell("ordinary-b"),
          },
          id: "ordinary",
          isGroup: true,
          label: "",
        },
        {
          entries: {},
          id: "empty",
          isGroup: true,
          label: "",
        },
        {
          entries: { "1": comparisonCell("named") },
          id: "named",
          isGroup: true,
          label: "Main result",
        },
        {
          entries: {
            "1": {
              entryIDs: ["primary", "detail"],
              primaryEntryID: "primary",
            },
          },
          id: "multiple",
          isGroup: true,
          label: "",
        },
      ],
      version: 2,
    }),
    {
      documentOrder: [1, 2],
      rows: [
        {
          entries: {
            "1": comparisonCell("ordinary-a"),
            "2": comparisonCell("ordinary-b"),
          },
          id: "ordinary",
          isGroup: false,
          label: "",
        },
        {
          entries: {},
          id: "empty",
          isGroup: true,
          label: "",
        },
        {
          entries: { "1": comparisonCell("named") },
          id: "named",
          isGroup: true,
          label: "Main result",
        },
        {
          entries: {
            "1": {
              entryIDs: ["primary", "detail"],
              primaryEntryID: "primary",
            },
          },
          id: "multiple",
          isGroup: true,
          label: "",
        },
      ],
      version: 3,
    },
  );
});

test("compacts a legacy inside-drop anchor when the gallery refreshes", () => {
  const stored = parseFigureGalleryComparisonLayout({
    documentOrder: [1, 2],
    rows: [
      {
        entries: { "2": comparisonCell("b-1") },
        id: "comparison-row-1",
        isGroup: false,
        label: "",
      },
      {
        entries: {
          "1": comparisonCell("a-1"),
          "2": comparisonCell("b-2"),
        },
        id: "comparison-row-2",
        isGroup: true,
        label: "",
      },
    ],
    version: 2,
  });
  assert.ok(stored);

  const refreshed = reconcileFigureGalleryComparisonLayout(
    [
      comparisonEntry("a-1", 1, 0),
      comparisonEntry("b-1", 2, 0),
      comparisonEntry("b-2", 2, 1),
    ],
    stored,
  );
  assert.deepEqual(refreshed.rows[0].entries, {
    "1": comparisonCell("a-1"),
    "2": comparisonCell("b-1"),
  });
  assert.deepEqual(refreshed.rows[1].entries, {
    "2": comparisonCell("b-2"),
  });
});

test("preserves explicit single-image groups stored by version 3", () => {
  assert.deepEqual(
    parseFigureGalleryComparisonLayout({
      documentOrder: [1],
      rows: [
        {
          entries: { "1": comparisonCell("explicit") },
          id: "explicit",
          isGroup: true,
          label: "",
        },
      ],
      version: 3,
    }),
    {
      documentOrder: [1],
      rows: [
        {
          entries: { "1": comparisonCell("explicit") },
          id: "explicit",
          isGroup: true,
          label: "",
        },
      ],
      version: 3,
    },
  );
});

test("builds a library snapshot without exposing local image paths", async () => {
  const opened: unknown[][] = [];
  const errors: Error[] = [];
  const documentItem = {
    getCollections: () => [7, 8],
    getDisplayTitle: () => "A paper",
    getField: () => "Issued 2024-03",
    id: 12,
  } as unknown as Zotero.Item;
  const attachment = {
    getDisplayTitle: () => "Attachment",
    id: 21,
    isPDFAttachment: () => true,
    key: "ATTACHMENT",
    topLevelItem: documentItem,
  } as unknown as Zotero.Item;
  const storedResult: StoredFigureResult = {
    comment: "Figure 1. Results",
    id: "1-result",
    imageFile: "images/1-result.png",
    imagePath: "/private/result.png",
    kind: "figure",
    pageIndex: 2,
    pageLabel: "iii",
    rect: [1, 2, 30, 40],
    tag: "Figure 1",
  };
  const resultStore = {
    list: async () => [storedResult],
    remove: async () => undefined,
    listIndexedAttachmentKeys: async () => ["ATTACHMENT", "MISSING"],
  };
  const platform: FigureGalleryPlatform = {
    chooseExportDirectory: async () => false,
    exportImage: async () => undefined,
    removeAnnotation: async () => undefined,
    getAttachment: async (_libraryID, key) =>
      key === "ATTACHMENT" ? attachment : false,
    listCollections: () => [{ id: 7, name: "Methods", parentID: null }],
    getCollectionName: (id) => (id === 7 ? "Methods" : undefined),
    getDefaultLibraryID: () => 4,
    listLibraries: () => [
      { id: 9, name: "Group" },
      { id: 4, name: "My Library" },
    ],
    logError: (error) => errors.push(error),
    openPdf: async (...args) => {
      opened.push(args);
    },
    readFile: async () => Uint8Array.from([1, 2, 3]),
  };
  const index = new FigureGalleryIndex(resultStore, platform);

  const bootstrap = index.getBootstrap();
  const snapshot = await index.loadLibrary(4);

  assert.equal(bootstrap.defaultLibraryID, 4);
  assert.deepEqual(
    bootstrap.libraries.map(({ name }) => name),
    ["Group", "My Library"],
  );
  assert.equal(snapshot.libraryID, 4);
  assert.equal(snapshot.entries.length, 1);
  assert.deepEqual(snapshot.entries[0], {
    attachmentID: 21,
    collectionIDs: [7],
    collectionNames: ["Methods"],
    comment: "Figure 1. Results",
    documentItemID: 12,
    documentTitle: "A paper",
    id: "4:ATTACHMENT:1-result",
    kind: "figure",
    libraryID: 4,
    pageIndex: 2,
    pageLabel: "iii",
    rect: [1, 2, 30, 40],
    tag: "Figure 1",
    year: "2024",
  });
  assert.equal("imagePath" in snapshot.entries[0], false);
  assert.deepEqual(await index.readImage(snapshot.entries[0].id), {
    base64: "AQID",
    mimeType: "image/png",
  });
  await index.openSource(snapshot.entries[0].id);
  assert.deepEqual(opened, [[21, 2, [1, 2, 30, 40]]]);
  assert.deepEqual(errors, []);
});

test("rejects unavailable libraries and stale result IDs", async () => {
  const index = new FigureGalleryIndex(
    {
      list: async () => [],
      remove: async () => undefined,
      listIndexedAttachmentKeys: async () => [],
    },
    {
      chooseExportDirectory: async () => false,
      exportImage: async () => undefined,
      removeAnnotation: async () => undefined,
      getAttachment: async () => false,
      listCollections: () => [{ id: 7, name: "Methods", parentID: null }],
      getCollectionName: () => undefined,
      getDefaultLibraryID: () => 1,
      listLibraries: () => [{ id: 1, name: "Library" }],
      logError: () => undefined,
      openPdf: async () => undefined,
      readFile: async () => new Uint8Array(),
    },
  );

  await assert.rejects(index.loadLibrary(2), /library 2 is unavailable/);
  await assert.rejects(index.readImage("missing"), /no longer indexed/);
  await assert.rejects(index.openSource("missing"), /no longer indexed/);
});

test("atomically drops deleted results when a library is reloaded", async () => {
  let results: StoredFigureResult[] = [
    storedGalleryResult("old", "/images/old.png"),
  ];
  let notifyReloadStarted: (() => void) | undefined;
  let waitForReload = Promise.resolve();
  const attachment = galleryAttachment(1, "ATTACHMENT");
  const index = new FigureGalleryIndex(
    {
      list: async () => {
        notifyReloadStarted?.();
        await waitForReload;
        return results;
      },
      remove: async () => undefined,
      listIndexedAttachmentKeys: async () => ["ATTACHMENT"],
    },
    galleryPlatform([attachment]),
  );

  const first = await index.loadLibrary(1);
  const oldID = first.entries[0].id;
  assert.equal((await index.readImage(oldID)).base64, "L2ltYWdlcy9vbGQucG5n");

  results = [storedGalleryResult("new", "/images/new.png")];
  const reloadStarted = new Promise<void>((resolve) => {
    notifyReloadStarted = resolve;
  });
  let releaseReload!: () => void;
  waitForReload = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  const pendingReload = index.loadLibrary(1);
  await reloadStarted;

  assert.equal((await index.readImage(oldID)).base64, "L2ltYWdlcy9vbGQucG5n");
  releaseReload();
  const second = await pendingReload;
  const newID = second.entries[0].id;

  await assert.rejects(index.readImage(oldID), /no longer indexed/);
  assert.equal((await index.readImage(newID)).base64, "L2ltYWdlcy9uZXcucG5n");
});

test("preserves the previous snapshot when an attachment refresh fails", async () => {
  let failRefresh = false;
  const attachment = galleryAttachment(1, "ATTACHMENT");
  const index = new FigureGalleryIndex(
    {
      list: async () => {
        if (failRefresh) throw new Error("manifest could not be read");
        return [storedGalleryResult("retained", "/images/retained.png")];
      },
      remove: async () => undefined,
      listIndexedAttachmentKeys: async () => ["ATTACHMENT"],
    },
    galleryPlatform([attachment]),
  );

  const first = await index.loadLibrary(1);
  const retainedID = first.entries[0].id;
  failRefresh = true;

  await assert.rejects(index.loadLibrary(1), /manifest could not be read/);
  assert.equal(
    (await index.readImage(retainedID)).base64,
    "L2ltYWdlcy9yZXRhaW5lZC5wbmc=",
  );
  await index.openSource(retainedID);
});

test("resolves out-of-order same-library loads to the indexed snapshot", async () => {
  const first = createDeferred<StoredFigureResult[]>();
  const second = createDeferred<StoredFigureResult[]>();
  let requestCount = 0;
  const index = new FigureGalleryIndex(
    {
      list: async () =>
        requestCount++ === 0 ? await first.promise : await second.promise,
      remove: async () => undefined,
      listIndexedAttachmentKeys: async () => ["ATTACHMENT"],
    },
    galleryPlatform([galleryAttachment(1, "ATTACHMENT")]),
  );

  const olderLoad = index.loadLibrary(1);
  const newerLoad = index.loadLibrary(1);
  second.resolve([storedGalleryResult("new", "/images/new.png")]);
  const newerSnapshot = await newerLoad;
  first.resolve([storedGalleryResult("old", "/images/old.png")]);
  const olderSnapshot = await olderLoad;

  assert.deepEqual(
    olderSnapshot.entries.map(({ id }) => id),
    newerSnapshot.entries.map(({ id }) => id),
  );
  assert.equal(
    (await index.readImage(olderSnapshot.entries[0].id)).base64,
    "L2ltYWdlcy9uZXcucG5n",
  );
});

test("bounds retained sources to the latest snapshot of each loaded library", async () => {
  const resultsByLibrary = new Map<number, StoredFigureResult[]>([
    [1, [storedGalleryResult("one-0", "/images/one-0.png")]],
    [2, [storedGalleryResult("two", "/images/two.png")]],
  ]);
  const attachments = [
    galleryAttachment(1, "ONE"),
    galleryAttachment(2, "TWO"),
  ];
  const index = new FigureGalleryIndex(
    {
      list: async (attachment) => resultsByLibrary.get(attachment.libraryID)!,
      remove: async () => undefined,
      listIndexedAttachmentKeys: async (libraryID) => [
        libraryID === 1 ? "ONE" : "TWO",
      ],
    },
    galleryPlatform(attachments),
  );

  const firstLibrary = await index.loadLibrary(1);
  const secondLibrary = await index.loadLibrary(2);
  const staleIDs = [firstLibrary.entries[0].id];

  for (let version = 1; version <= 4; version++) {
    resultsByLibrary.set(1, [
      storedGalleryResult(`one-${version}`, `/images/one-${version}.png`),
    ]);
    const snapshot = await index.loadLibrary(1);
    staleIDs.push(snapshot.entries[0].id);
  }

  for (const staleID of staleIDs.slice(0, -1)) {
    await assert.rejects(index.openSource(staleID), /no longer indexed/);
  }
  await index.openSource(staleIDs.at(-1)!);
  assert.equal(
    (await index.readImage(secondLibrary.entries[0].id)).base64,
    "L2ltYWdlcy90d28ucG5n",
  );
});

test("batch deletion deduplicates IDs, continues on failure, and invalidates only removed sources", async () => {
  const removed: string[] = [];
  const mirrored: string[] = [];
  const results = ["one", "broken", "two"].map((id) =>
    storedGalleryResult(id, `/images/${id}.png`),
  );
  const platform = galleryPlatform([
    galleryAttachment(1, "ONE"),
    galleryAttachment(2, "TWO"),
  ]);
  platform.removeAnnotation = async (_item, result) => {
    mirrored.push(result.id);
  };
  const index = new FigureGalleryIndex(
    {
      list: async () => results,
      listIndexedAttachmentKeys: async (libraryID) => [
        libraryID === 1 ? "ONE" : "TWO",
      ],
      remove: async (_item, id) => {
        if (id === "broken") throw new Error("disk failure");
        removed.push(id);
        return results.find((result) => result.id === id);
      },
    },
    platform,
  );
  await index.loadLibrary(1);
  await index.loadLibrary(2);
  const outcome = await index.runBatch(
    ["1:ONE:one", "1:ONE:one", "1:ONE:broken", "stale", "2:TWO:two"],
    "delete",
  );
  assert.deepEqual(outcome?.completedIDs, ["1:ONE:one", "2:TWO:two"]);
  assert.equal(outcome?.errors.length, 2);
  assert.deepEqual(removed, ["one", "two"]);
  assert.deepEqual(mirrored, removed);
  await assert.rejects(index.readImage("1:ONE:one"), /no longer indexed/);
  await index.readImage("1:ONE:broken");
});

test("batch deletion rejects read-only attachments and reports annotation cleanup errors after a committed removal", async () => {
  const attachment = galleryAttachment(1, "ONE");
  let writable = false;
  attachment.isEditable = () => writable;
  const result = storedGalleryResult("one", "/one.png");
  let removals = 0;
  const platform = galleryPlatform([attachment]);
  platform.removeAnnotation = async () => {
    throw new Error("annotation failure");
  };
  const index = new FigureGalleryIndex(
    {
      list: async () => [result],
      listIndexedAttachmentKeys: async () => ["ONE"],
      remove: async () => {
        removals++;
        return result;
      },
    },
    platform,
  );
  await index.loadLibrary(1);
  const denied = await index.runBatch(["1:ONE:one"], "delete");
  assert.deepEqual(denied?.completedIDs, []);
  assert.match(denied!.errors[0], /read-only/);
  assert.equal(removals, 0);
  writable = true;
  const partial = await index.runBatch(["1:ONE:one"], "delete");
  assert.deepEqual(partial?.completedIDs, ["1:ONE:one"]);
  assert.match(partial!.errors[0], /annotation failure/);
  await assert.rejects(index.readImage("1:ONE:one"), /no longer indexed/);
});

test("batch export supports cancellation, safe distinct names, and partial copy failures without deleting results", async () => {
  const platform = galleryPlatform([
    galleryAttachment(1, "ONE"),
    galleryAttachment(2, "TWO"),
  ]);
  let directory: string | false = false;
  const copies: string[][] = [];
  platform.chooseExportDirectory = async () => directory;
  platform.exportImage = async (path, target, filename) => {
    copies.push([path, target, filename]);
    if (path === "/broken.png") throw new Error("file exists");
  };
  const result = {
    ...storedGalleryResult("one", "/one.png"),
    tag: 'Figure: 1 / <test> "?',
  };
  const index = new FigureGalleryIndex(
    {
      list: async () => [result, storedGalleryResult("broken", "/broken.png")],
      listIndexedAttachmentKeys: async (id) => [id === 1 ? "ONE" : "TWO"],
      remove: async () => assert.fail("export must not remove results"),
    },
    platform,
  );
  await index.loadLibrary(1);
  await index.loadLibrary(2);
  assert.equal(await index.runBatch(["1:ONE:one"], "export"), undefined);
  assert.equal(copies.length, 0);
  directory = "/output";
  const outcome = await index.runBatch(
    ["1:ONE:one", "1:ONE:one", "1:ONE:broken", "2:TWO:one"],
    "export",
  );
  assert.deepEqual(outcome?.completedIDs, ["1:ONE:one", "2:TWO:one"]);
  assert.match(outcome!.errors[0], /file exists/);
  assert.equal(copies.length, 3);
  assert.equal(new Set(copies.map(([, , filename]) => filename)).size, 3);
  for (const [, target, filename] of copies) {
    assert.equal(target, directory);
    assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
    assert.ok([...filename].every((character) => character.charCodeAt(0) > 31));
    assert.ok(filename.endsWith(".png"));
  }
  await index.readImage("1:ONE:one");
});

test("reader batches load their attachment directly and discard stale indexed results", async () => {
  const attachment = galleryAttachment(1, "ONE");
  let results = [storedGalleryResult("one", "/one.png")];
  const platform = galleryPlatform([attachment]);
  platform.chooseExportDirectory = async () => "/output";
  const copies: string[] = [];
  platform.exportImage = async (path) => {
    copies.push(path);
  };
  const index = new FigureGalleryIndex(
    {
      list: async () => results,
      listIndexedAttachmentKeys: async () =>
        assert.fail("reader must not scan the library"),
      remove: async () => assert.fail("export must not delete"),
    },
    platform,
  );
  assert.deepEqual(
    await index.runAttachmentBatch(attachment, ["one"], "export"),
    {
      completedIDs: ["one"],
      errors: [],
    },
  );
  results = [storedGalleryResult("two", "/two.png")];
  const outcome = await index.runAttachmentBatch(
    attachment,
    ["one", "two"],
    "export",
  );
  assert.deepEqual(outcome?.completedIDs, ["two"]);
  assert.match(outcome!.errors[0], /no longer indexed/);
  assert.deepEqual(copies, ["/one.png", "/two.png"]);
});

function comparisonCell(
  ...entryIDs: [string, ...string[]]
): FigureGalleryComparisonCell {
  return { entryIDs, primaryEntryID: entryIDs[0] };
}

function comparisonEntry(
  id: string,
  documentItemID: number,
  pageIndex: number,
): FigureGalleryEntry {
  return {
    attachmentID: documentItemID * 100,
    collectionIDs: [],
    collectionNames: [],
    comment: id,
    documentItemID,
    documentTitle: `Document ${documentItemID}`,
    id,
    kind: "figure",
    libraryID: 1,
    pageIndex,
    pageLabel: String(pageIndex + 1),
    rect: [0, 0, 100, 100],
    tag: `Figure ${pageIndex + 1}`,
    year: "2026",
  };
}

function storedGalleryResult(
  id: string,
  imagePath: string,
): StoredFigureResult {
  return {
    comment: id,
    id,
    imageFile: `images/${id}.png`,
    imagePath,
    kind: "figure",
    pageIndex: 0,
    pageLabel: "1",
    rect: [1, 2, 30, 40],
    tag: `Figure ${id}`,
  };
}

function galleryAttachment(libraryID: number, key: string): Zotero.Item {
  const documentItem = {
    getCollections: () => [],
    getDisplayTitle: () => `Document ${libraryID}`,
    getField: () => "2026",
    id: libraryID * 10,
  } as unknown as Zotero.Item;
  return {
    getDisplayTitle: () => key,
    id: libraryID * 100,
    isPDFAttachment: () => true,
    key,
    libraryID,
    isEditable: () => true,
    topLevelItem: documentItem,
  } as unknown as Zotero.Item;
}

function galleryPlatform(
  attachments: readonly Zotero.Item[],
): FigureGalleryPlatform {
  return {
    chooseExportDirectory: async () => false,
    exportImage: async () => undefined,
    removeAnnotation: async () => undefined,
    getAttachment: async (libraryID, key) =>
      attachments.find(
        (attachment) =>
          attachment.libraryID === libraryID && attachment.key === key,
      ) ?? false,
    listCollections: () => [{ id: 7, name: "Methods", parentID: null }],
    getCollectionName: () => undefined,
    getDefaultLibraryID: () => 1,
    listLibraries: () => [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ],
    logError: () => undefined,
    openPdf: async () => undefined,
    readFile: async (path) => new TextEncoder().encode(path),
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
