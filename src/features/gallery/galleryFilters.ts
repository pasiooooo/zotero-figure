import type {
  FigureGalleryCollection,
  FigureGalleryEntry,
} from "../../domain/figureGallery";
import type { FigureResultKind } from "../../domain/figureResults";

export type CountedGalleryFilterOption = readonly [
  value: string,
  label: string,
  count: number,
];

export interface GalleryFilterOptions {
  collections: CountedGalleryFilterOption[];
  documents: CountedGalleryFilterOption[];
  kinds: CountedGalleryFilterOption[];
  years: CountedGalleryFilterOption[];
}

export interface GalleryFilterTotals {
  collections: number;
  documents: number;
  kinds: number;
  years: number;
}

export interface GalleryFilterValues {
  collectionID: string;
  documentID: string;
  keyword: string;
  kind: string;
  year: string;
}

export interface GalleryFacetState extends GalleryFilterOptions {
  filters: GalleryFilterValues;
  totals: GalleryFilterTotals;
}

type RawFilterOption = readonly [value: string, label: string | undefined];

export function buildGalleryFilterOptions(
  entries: readonly FigureGalleryEntry[],
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): GalleryFilterOptions {
  return {
    collections: buildCollectionOptions(entries),
    documents: buildDocumentOptions(entries),
    kinds: buildKindOptions(entries, kindLabels),
    years: buildYearOptions(entries),
  };
}

export function buildGalleryFacetState(
  entries: readonly FigureGalleryEntry[],
  requestedFilters: Readonly<GalleryFilterValues>,
  kindLabels: Readonly<Record<FigureResultKind, string>>,
  collections: readonly FigureGalleryCollection[] = [],
): GalleryFacetState {
  // Only discard deleted values, never broaden a valid zero-result search.
  const available = buildGalleryFilterOptions(entries, kindLabels);
  const filters = {
    ...requestedFilters,
    collectionID: retainAvailableValue(requestedFilters.collectionID, [
      ...available.collections,
      ...collections.map(
        ({ id, name }): CountedGalleryFilterOption => [String(id), name, 0],
      ),
    ]),
    documentID: retainAvailableValue(
      requestedFilters.documentID,
      available.documents,
    ),
    kind: ["", "figure", "table", "formula"].includes(requestedFilters.kind)
      ? requestedFilters.kind
      : "",
  };
  return {
    ...buildFacetOptions(entries, filters, kindLabels, collections),
    filters,
  };
}

export function filterGalleryEntries(
  entries: readonly FigureGalleryEntry[],
  filters: Readonly<GalleryFilterValues>,
  collections: readonly FigureGalleryCollection[] = [],
): FigureGalleryEntry[] {
  const collectionIDs = getGalleryCollectionScope(
    filters.collectionID,
    collections,
  );
  const years = parseGalleryYearRange(filters.year);
  return entries.filter((entry) => {
    if (
      filters.documentID &&
      String(entry.documentItemID) !== filters.documentID
    ) {
      return false;
    }
    if (
      filters.year &&
      (!years ||
        !entry.year ||
        Number(entry.year) < years[0] ||
        Number(entry.year) > years[1])
    )
      return false;
    if (
      filters.collectionID &&
      !entry.collectionIDs.some((id) => collectionIDs.has(String(id)))
    ) {
      return false;
    }
    if (filters.kind && entry.kind !== filters.kind) return false;
    return matchesGalleryKeyword(entry, filters.keyword);
  });
}

export function matchesGalleryKeyword(
  entry: FigureGalleryEntry,
  keyword: string,
): boolean {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  if (!normalizedKeyword) return true;
  return [entry.comment, entry.tag, entry.documentTitle]
    .join("\n")
    .toLocaleLowerCase()
    .includes(normalizedKeyword);
}

export function formatGalleryOptionLabel(label: string, count: number): string {
  return `${label} (${count})`;
}

function buildFacetOptions(
  entries: readonly FigureGalleryEntry[],
  filters: Readonly<GalleryFilterValues>,
  kindLabels: Readonly<Record<FigureResultKind, string>>,
  collections: readonly FigureGalleryCollection[],
): GalleryFilterOptions & { totals: GalleryFilterTotals } {
  const collectionEntries = filterGalleryEntries(
    entries,
    {
      ...filters,
      collectionID: "",
      documentID: "",
    },
    collections,
  );
  const documentEntries = filterGalleryEntries(
    entries,
    {
      ...filters,
      documentID: "",
    },
    collections,
  );
  const kindEntries = filterGalleryEntries(
    entries,
    { ...filters, kind: "" },
    collections,
  );
  const yearEntries = filterGalleryEntries(
    entries,
    { ...filters, year: "" },
    collections,
  );
  const parents = new Map(
    collections.map(({ id, parentID }) => [id, parentID]),
  );
  const names = new Map(collections.map(({ id, name }) => [id, name]));
  const collectionOptions = countOptions(collectionEntries, (entry) => {
    const ids = new Set(entry.collectionIDs);
    for (const id of ids) {
      const parent = parents.get(id);
      if (parent) ids.add(parent);
    }
    return [...ids].map((id) => [
      String(id),
      names.get(id) ?? entry.collectionNames[entry.collectionIDs.indexOf(id)],
    ]);
  });
  return {
    collections: collectionOptions,
    documents: buildDocumentOptions(documentEntries),
    kinds: buildKindOptions(kindEntries, kindLabels),
    totals: {
      collections: collectionEntries.length,
      documents: documentEntries.length,
      kinds: kindEntries.length,
      years: yearEntries.length,
    },
    years: buildYearOptions(yearEntries),
  };
}

function buildCollectionOptions(
  entries: readonly FigureGalleryEntry[],
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) =>
    entry.collectionIDs.map(
      (id, index): RawFilterOption => [
        String(id),
        entry.collectionNames[index],
      ],
    ),
  );
}

function buildDocumentOptions(
  entries: readonly FigureGalleryEntry[],
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) => [
    [String(entry.documentItemID), entry.documentTitle],
  ]);
}

function buildKindOptions(
  entries: readonly FigureGalleryEntry[],
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) => [
    [entry.kind, kindLabels[entry.kind]],
  ]);
}

function buildYearOptions(
  entries: readonly FigureGalleryEntry[],
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) =>
    entry.year ? [[entry.year, entry.year]] : [],
  ).sort((first, second) => second[0].localeCompare(first[0]));
}

function retainAvailableValue(
  value: string,
  options: readonly CountedGalleryFilterOption[],
): string {
  return !value || options.some(([optionValue]) => optionValue === value)
    ? value
    : "";
}

export function parseGalleryYearRange(
  value: string,
): readonly [number, number] | undefined {
  const match = value.trim().match(/^(\d{4})(?:\s*[-–—至]\s*(\d{4}))?$/);
  if (!match) return undefined;
  const first = Number(match[1]);
  const last = Number(match[2] ?? match[1]);
  return first >= 1000 && last <= 9999 && first <= last
    ? [first, last]
    : undefined;
}

export function buildGalleryYearHistogram(
  options: readonly CountedGalleryFilterOption[],
  yearRange: string,
): Array<{ year: number; count: number }> {
  const range = parseGalleryYearRange(yearRange);
  if (yearRange.trim() && !range) return [];
  const counts = new Map(
    options
      .filter(([year]) => /^\d{4}$/.test(year) && Number(year) >= 1000)
      .map(([year, , count]) => [Number(year), count]),
  );
  const years = [...counts.keys()];
  const first = range?.[0] ?? Math.min(...years);
  const last = range?.[1] ?? Math.max(...years);
  const bins: Array<{ year: number; count: number }> = [];
  for (let year = first; year <= last; year++)
    bins.push({ year, count: counts.get(year) ?? 0 });
  return bins;
}

function getGalleryCollectionScope(
  id: string,
  collections: readonly FigureGalleryCollection[],
): Set<string> {
  const ids = new Set([id]);
  const children = new Map<string, string[]>();
  for (const collection of collections) {
    const parent = String(collection.parentID);
    children.set(parent, [
      ...(children.get(parent) ?? []),
      String(collection.id),
    ]);
  }
  for (const parent of ids)
    for (const child of children.get(parent) ?? []) ids.add(child);
  return ids;
}

export function buildGalleryCollectionTree(
  collections: readonly FigureGalleryCollection[],
): Array<FigureGalleryCollection & { depth: number }> {
  const known = new Set(collections.map(({ id }) => id));
  const children = new Map<number | null, FigureGalleryCollection[]>();
  for (const collection of collections) {
    const parent =
      collection.parentID && known.has(collection.parentID)
        ? collection.parentID
        : null;
    children.set(parent, [...(children.get(parent) ?? []), collection]);
  }
  const result: Array<FigureGalleryCollection & { depth: number }> = [];
  const visited = new Set<number>();
  function visit(
    nodes: readonly FigureGalleryCollection[],
    depth: number,
  ): void {
    for (const node of [...nodes].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      result.push({ ...node, depth });
      visit(children.get(node.id) ?? [], depth + 1);
    }
  }
  visit(children.get(null) ?? [], 0);
  visit(
    collections.filter(({ id }) => !visited.has(id)),
    0,
  );
  return result;
}

function countOptions(
  entries: readonly FigureGalleryEntry[],
  getOptions: (entry: FigureGalleryEntry) => readonly RawFilterOption[],
): CountedGalleryFilterOption[] {
  const values = new Map<string, { count: number; label: string }>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const [value, label] of getOptions(entry)) {
      if (!value || !label || seen.has(value)) continue;
      seen.add(value);
      const existing = values.get(value);
      values.set(value, {
        count: (existing?.count ?? 0) + 1,
        label: existing?.label ?? label,
      });
    }
  }
  return Array.from(
    values,
    ([value, { count, label }]): CountedGalleryFilterOption => [
      value,
      label,
      count,
    ],
  ).sort((first, second) => first[1].localeCompare(second[1]));
}
