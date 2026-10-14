import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGalleryEntry } from "../src/domain/figureGallery";
import {
  buildGalleryFacetState,
  buildGalleryCollectionTree,
  buildGalleryYearHistogram,
  parseGalleryYearRange,
  buildGalleryFilterOptions,
  filterGalleryEntries,
  formatGalleryOptionLabel,
  matchesGalleryKeyword,
} from "../src/features/gallery/galleryFilters";

const entries: FigureGalleryEntry[] = [
  galleryEntry({
    collectionIDs: [10, 10, 11],
    collectionNames: ["Alpha", "Ignored duplicate", "Beta"],
    comment: "Figure 1. Results",
    documentItemID: 1,
    documentTitle: "Zebra study",
    id: "figure",
    kind: "figure",
    tag: "Figure 1",
    year: "2024",
  }),
  galleryEntry({
    collectionIDs: [10],
    collectionNames: ["Alpha"],
    documentItemID: 1,
    documentTitle: "Zebra study",
    id: "table",
    kind: "table",
    tag: "Table 2",
    year: "2023",
  }),
  galleryEntry({
    collectionIDs: [11],
    collectionNames: ["Beta"],
    documentItemID: 2,
    documentTitle: "Alpha methods",
    id: "formula",
    kind: "formula",
    tag: "Formula 3",
    year: "2024",
  }),
];

test("builds stable counted options without double-counting one entry", () => {
  const options = buildGalleryFilterOptions(entries, {
    figure: "Figure",
    formula: "Formula",
    table: "Table",
  });

  assert.deepEqual(options.documents, [
    ["2", "Alpha methods", 1],
    ["1", "Zebra study", 2],
  ]);
  assert.deepEqual(options.collections, [
    ["10", "Alpha", 2],
    ["11", "Beta", 2],
  ]);
  assert.deepEqual(options.years, [
    ["2024", "2024", 2],
    ["2023", "2023", 1],
  ]);
  assert.deepEqual(options.kinds, [
    ["figure", "Figure", 1],
    ["formula", "Formula", 1],
    ["table", "Table", 1],
  ]);
  assert.equal(formatGalleryOptionLabel("All figures", 3), "All figures (3)");
});

test("combines gallery filters and matches keywords case-insensitively", () => {
  const sourceSnapshot = structuredClone(entries);
  const filtered = filterGalleryEntries(entries, {
    collectionID: "11",
    documentID: "1",
    keyword: " RESULTS ",
    kind: "figure",
    year: "2024",
  });

  assert.deepEqual(
    filtered.map(({ id }) => id),
    ["figure"],
  );
  assert.equal(matchesGalleryKeyword(entries[1], "TABLE 2"), true);
  assert.equal(matchesGalleryKeyword(entries[2], "alpha METHODS"), true);
  assert.equal(matchesGalleryKeyword(entries[2], "missing"), false);
  assert.deepEqual(entries, sourceSnapshot);
});

test("recomputes each facet from the other active filters", () => {
  const labels = {
    figure: "Figure",
    formula: "Formula",
    table: "Table",
  };
  const state = buildGalleryFacetState(
    entries,
    {
      collectionID: "11",
      documentID: "",
      keyword: "",
      kind: "",
      year: "",
    },
    labels,
  );

  assert.equal(state.filters.collectionID, "11");
  assert.deepEqual(state.documents, [
    ["2", "Alpha methods", 1],
    ["1", "Zebra study", 1],
  ]);
  assert.deepEqual(state.years, [["2024", "2024", 2]]);
  assert.deepEqual(state.kinds, [
    ["figure", "Figure", 1],
    ["formula", "Formula", 1],
  ]);
  assert.deepEqual(state.totals, {
    collections: 3,
    documents: 2,
    kinds: 2,
    years: 2,
  });

  const incompatible = buildGalleryFacetState(
    entries,
    { ...state.filters, year: "2023" },
    labels,
  );
  assert.equal(incompatible.filters.collectionID, "11");
  assert.equal(incompatible.filters.year, "2023");
  assert.equal(filterGalleryEntries(entries, incompatible.filters).length, 0);
});

test("year ranges include both boundaries, exclude unknown years and reject invalid input", () => {
  const filters = {
    collectionID: "",
    documentID: "",
    kind: "",
    keyword: "",
    year: "2023–2024",
  };
  const source = [
    ...entries,
    galleryEntry({
      documentItemID: 3,
      documentTitle: "Undated",
      id: "unknown",
      kind: "figure",
    }),
  ];
  assert.equal(filterGalleryEntries(source, filters).length, 3);
  assert.equal(
    filterGalleryEntries(source, { ...filters, year: "2024" }).length,
    2,
  );
  assert.equal(
    filterGalleryEntries(source, { ...filters, year: "" }).length,
    4,
  );
  for (const value of [
    "2024-2020",
    "24",
    "2020-",
    "oops",
    "0000",
    "2020-2024-2025",
  ]) {
    assert.equal(parseGalleryYearRange(value), undefined, value);
    assert.equal(
      filterGalleryEntries(source, { ...filters, year: value }).length,
      0,
    );
  }
  for (const value of ["2020–2024", "2020-2024", "2020 — 2024", " 2020至2024 "])
    assert.deepEqual(parseGalleryYearRange(value), [2020, 2024]);
});

test("histogram limits itself to the requested years and fills empty years with zero", () => {
  const options = [
    ["2024", "2024", 3],
    ["2021", "2021", 5],
  ] as const;
  assert.deepEqual(buildGalleryYearHistogram(options, "2022–2024"), [
    { year: 2022, count: 0 },
    { year: 2023, count: 0 },
    { year: 2024, count: 3 },
  ]);
  assert.deepEqual(buildGalleryYearHistogram(options, "2021"), [
    { year: 2021, count: 5 },
  ]);
  assert.deepEqual(buildGalleryYearHistogram(options, "2025–2026"), [
    { year: 2025, count: 0 },
    { year: 2026, count: 0 },
  ]);
  assert.deepEqual(buildGalleryYearHistogram([], "2024"), [
    { year: 2024, count: 0 },
  ]);
  assert.deepEqual(buildGalleryYearHistogram([], ""), []);
  assert.deepEqual(buildGalleryYearHistogram(options, "2024–2020"), []);
  assert.deepEqual(
    buildGalleryYearHistogram(options, "").map(({ year }) => year),
    [2021, 2022, 2023, 2024],
  );
});

test("collection hierarchy includes descendants, deduplicates counts, preserves empty collections and sorts siblings", () => {
  const collections = [
    { id: 1, name: "Research", parentID: null },
    { id: 11, name: "Beta", parentID: 1 },
    { id: 10, name: "Alpha", parentID: 1 },
    { id: 12, name: "Nested", parentID: 10 },
    { id: 20, name: "Empty", parentID: null },
  ];
  const filters = {
    collectionID: "1",
    documentID: "",
    kind: "",
    keyword: "",
    year: "",
  };
  const labels = { figure: "Figure", table: "Table", formula: "Formula" };
  const source = [
    ...entries,
    galleryEntry({
      id: "nested",
      documentItemID: 3,
      documentTitle: "Nested",
      kind: "figure",
      collectionIDs: [12],
      collectionNames: ["Nested"],
    }),
  ];
  const state = buildGalleryFacetState(source, filters, labels, collections);
  assert.equal(
    filterGalleryEntries(source, state.filters, collections).length,
    4,
  );
  assert.deepEqual(
    state.collections.find(([id]) => id === "1"),
    ["1", "Research", 4],
  );
  assert.deepEqual(
    buildGalleryCollectionTree(collections).map(({ id, depth }) => [id, depth]),
    [
      [20, 0],
      [1, 0],
      [10, 1],
      [12, 2],
      [11, 1],
    ],
  );
  const empty = buildGalleryFacetState(
    source,
    { ...filters, collectionID: "20" },
    labels,
    collections,
  );
  assert.equal(empty.filters.collectionID, "20");
  assert.equal(
    filterGalleryEntries(source, empty.filters, collections).length,
    0,
  );
  // A current document does not hide the other branches in the browser.
  const selected = buildGalleryFacetState(
    source,
    { ...filters, documentID: "3" },
    labels,
    collections,
  );
  assert.deepEqual(selected.collections, state.collections);
  assert.equal(selected.documents.length, 3);
});

test("collection tree tolerates missing parents and cycles without hiding collections", () => {
  const tree = buildGalleryCollectionTree([
    { id: 1, name: "A", parentID: 2 },
    { id: 2, name: "B", parentID: 1 },
    { id: 3, name: "C", parentID: 99 },
  ]);
  assert.equal(tree.length, 3);
  assert.equal(new Set(tree.map(({ id }) => id)).size, 3);
});

function galleryEntry(
  overrides: Partial<FigureGalleryEntry> &
    Pick<
      FigureGalleryEntry,
      "documentItemID" | "documentTitle" | "id" | "kind"
    >,
): FigureGalleryEntry {
  return {
    attachmentID: 100,
    collectionIDs: [],
    collectionNames: [],
    comment: "",
    libraryID: 1,
    pageIndex: 0,
    pageLabel: "1",
    rect: [1, 2, 3, 4],
    tag: "",
    year: "",
    ...overrides,
  };
}
