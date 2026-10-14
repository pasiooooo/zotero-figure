import * as assert from "node:assert/strict";
import test from "node:test";
import {
  countFigureSidebarItems,
  filterAndSortFigureSidebarItems,
  getFigureSidebarNavigationLabel,
  pruneUnavailableFigureSidebarFilters,
  shouldShowFigureSidebarEmptyState,
  toggleFigureSidebarFilter,
  type FigureSidebarFilter,
} from "../src/domain/figureSidebar";

interface Entry {
  comment?: string;
  id: string;
  kind: "figure" | "formula" | "table";
  pageIndex: number;
  rect?: readonly [number, number, number, number];
  tag: string;
}

const metadata = (entry: Entry) => entry;

test("counts all result kinds independently of filtering", () => {
  const entries: Entry[] = [
    { id: "figure-1", kind: "figure", pageIndex: 0, tag: "Figure 1" },
    { id: "table-1", kind: "table", pageIndex: 1, tag: "Table 1" },
    { id: "figure-2", kind: "figure", pageIndex: 2, tag: "Figure 2" },
    { id: "formula-1", kind: "formula", pageIndex: 3, tag: "Formula 1" },
  ];

  assert.deepEqual(countFigureSidebarItems(entries, metadata), {
    figure: 2,
    formula: 1,
    table: 1,
  });
});

test("filters sidebar entries by kind and preserves the source array", () => {
  const entries: Entry[] = [
    { id: "table", kind: "table", pageIndex: 1, tag: "Table 1" },
    { id: "figure", kind: "figure", pageIndex: 0, tag: "Figure 1" },
  ];

  const filtered = filterAndSortFigureSidebarItems(
    entries,
    new Set(["figure" satisfies FigureSidebarFilter]),
    metadata,
  );

  assert.deepEqual(
    filtered.map(({ id }) => id),
    ["figure"],
  );
  assert.deepEqual(
    entries.map(({ id }) => id),
    ["table", "figure"],
  );
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, new Set(), metadata).map(
      ({ id }) => id,
    ),
    ["figure", "table"],
  );
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, new Set(["table"]), metadata).map(
      ({ id }) => id,
    ),
    ["table"],
  );
  assert.deepEqual(
    filterAndSortFigureSidebarItems(
      entries,
      new Set(["formula"]),
      metadata,
    ).map(({ id }) => id),
    [],
  );
});

test("combines selected kinds and restores all results when none are selected", () => {
  const entries: Entry[] = [
    { id: "figure", kind: "figure", pageIndex: 0, tag: "Figure 1" },
    { id: "table", kind: "table", pageIndex: 1, tag: "Table 1" },
    { id: "formula", kind: "formula", pageIndex: 2, tag: "Formula 1" },
  ];
  let filters = new Set<FigureSidebarFilter>();

  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, filters, metadata).map(
      ({ id }) => id,
    ),
    ["figure", "table", "formula"],
  );

  const figureFilters = toggleFigureSidebarFilter(filters, "figure");
  assert.equal(filters.size, 0);
  filters = figureFilters;
  filters = toggleFigureSidebarFilter(filters, "table");
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, filters, metadata).map(
      ({ id }) => id,
    ),
    ["figure", "table"],
  );

  filters = toggleFigureSidebarFilter(filters, "formula");
  assert.equal(
    filterAndSortFigureSidebarItems(entries, filters, metadata).length,
    entries.length,
  );

  filters = toggleFigureSidebarFilter(filters, "formula");
  filters = toggleFigureSidebarFilter(filters, "figure");
  filters = toggleFigureSidebarFilter(filters, "table");
  assert.equal(filters.size, 0);
  assert.equal(
    filterAndSortFigureSidebarItems(entries, filters, metadata).length,
    entries.length,
  );
});

test("drops selected kinds that no longer have results", () => {
  const filters = pruneUnavailableFigureSidebarFilters(
    new Set<FigureSidebarFilter>(["figure", "table", "formula"]),
    { figure: 0, formula: 0, table: 6 },
  );

  assert.deepEqual([...filters], ["table"]);
});

test("restores the empty state after analysis for an empty active filter", () => {
  assert.equal(shouldShowFigureSidebarEmptyState(0, true), false);
  assert.equal(shouldShowFigureSidebarEmptyState(0, false), true);
  assert.equal(shouldShowFigureSidebarEmptyState(1, false), false);
});

test("groups kinds and sorts complete numbers before page and visual position", () => {
  const entries: Entry[] = [
    {
      id: "second",
      kind: "figure",
      pageIndex: 1,
      tag: "Figure 2",
      comment: "Fig 2",
    },
    {
      id: "lower",
      kind: "figure",
      pageIndex: 0,
      rect: [40, 100, 240, 220],
      tag: "Figure 1-6",
      comment: "Fig 1-6",
    },
    {
      id: "upper-right",
      kind: "table",
      pageIndex: 0,
      rect: [280, 400, 500, 520],
      tag: "Table 8",
      comment: "Table 8",
    },
    {
      id: "upper-left",
      kind: "figure",
      pageIndex: 0,
      rect: [30, 400, 250, 520],
      tag: "Figure 1-5",
      comment: "Fig 1-5",
    },
  ];

  const sorted = filterAndSortFigureSidebarItems(entries, new Set(), metadata);

  assert.deepEqual(
    sorted.map(({ id }) => id),
    ["upper-left", "lower", "second", "upper-right"],
  );
});

test("sorts composite caption numbers naturally for every kind, including legacy truncated tags", () => {
  for (const [kind, prefix] of [
    ["figure", "Fig."],
    ["table", "Table"],
    ["formula", "Eq."],
  ] as const) {
    for (const separator of [".", "-"]) {
      const numbers = ["2.1", "1.10", "1.2", "1.1", "10", "2", "1"];
      const entries: Entry[] = numbers.map((number, index) => ({
        id: number,
        kind,
        pageIndex: index,
        tag: `${prefix} ${number.split(".")[0]}`,
        comment: `${prefix} ${number.replace(".", separator)}. Caption`,
      }));
      assert.deepEqual(
        filterAndSortFigureSidebarItems(entries, new Set(), metadata).map(
          ({ id }) => id,
        ),
        ["1", "1.1", "1.2", "1.10", "2", "2.1", "10"],
      );
    }
  }
});

test("puts missing and unnumbered captions before every numbered kind, even with numbered tags", () => {
  const entries: Entry[] = [
    {
      id: "none",
      kind: "figure",
      pageIndex: 0,
      tag: "Figure",
      comment: "Results from 2024",
    },
    {
      id: "later",
      kind: "figure",
      pageIndex: 2,
      tag: "Figure 2",
      comment: "Measured at 1 GHz",
    },
    {
      id: "earlier",
      kind: "figure",
      pageIndex: 1,
      tag: "Figure 2",
      comment: "Fig 2",
    },
    {
      id: "first",
      kind: "figure",
      pageIndex: 3,
      tag: "Figure 1",
      comment: "Fig 1",
    },
    {
      id: "empty-table",
      kind: "table",
      pageIndex: 1,
      tag: "Table 1",
      comment: "",
    },
    { id: "missing-formula", kind: "formula", pageIndex: 1, tag: "Formula 1" },
    {
      id: "blank-figure",
      kind: "figure",
      pageIndex: 4,
      tag: "Figure 3",
      comment: " \n ",
    },
  ];
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, new Set(), metadata).map(
      ({ id }) => id,
    ),
    [
      "none",
      "later",
      "blank-figure",
      "empty-table",
      "missing-formula",
      "first",
      "earlier",
    ],
  );
});

test("builds concise navigation labels without duplicating figure tags", () => {
  assert.equal(
    getFigureSidebarNavigationLabel({
      comment: "  Figure 12.\n A long caption  ",
      tag: "Figure 12",
    }),
    "Figure 12. A long caption",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({
      comment: "Central wavelengths of the sensor",
      tag: "Table 5",
    }),
    "Table 5 - Central wavelengths of the sensor",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({
      comment: "Figure 10. Boundary check",
      tag: "Figure 1",
    }),
    "Figure 1 - Figure 10. Boundary check",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({ comment: "(1)", tag: "Formula 1" }),
    "(1)",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({ comment: "", tag: "Formula" }),
    "Formula",
  );
});
