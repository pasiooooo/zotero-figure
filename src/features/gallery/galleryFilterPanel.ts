import type { FigureGalleryCollection } from "../../domain/figureGallery";
import type { FigureResultKind } from "../../domain/figureResults";
import { createFigureSidebarIcon } from "../reader/figureSidebarIcons";
import {
  buildGalleryCollectionTree,
  buildGalleryYearHistogram,
  formatGalleryOptionLabel,
  parseGalleryYearRange,
  type GalleryFacetState,
  type GalleryFilterValues,
} from "./galleryFilters";

export interface GalleryFilterLabels {
  allLabels: readonly [string, string, string, string];
  kindLabels: Readonly<Record<FigureResultKind, string>>;
  invalidYear: string;
  histogram: string;
  noDocuments: string;
}

/** In-page controls work in both Zotero tabs and the standalone Reader window. */
export class GalleryFilterPanel {
  values: GalleryFilterValues = {
    collectionID: "",
    documentID: "",
    keyword: "",
    kind: "",
    year: "",
  };
  private state?: Readonly<GalleryFacetState>;
  private labels?: Readonly<GalleryFilterLabels>;
  private activePopup?: { panel: HTMLElement; trigger: HTMLButtonElement };
  private readonly browse: HTMLElement;
  private readonly yearPanel: HTMLElement;
  private readonly documentSearch: HTMLInputElement;
  private readonly yearInput: HTMLInputElement;

  constructor(
    private readonly document: Document,
    private readonly onChange: () => void,
  ) {
    this.browse = this.element("browse-panel");
    this.yearPanel = this.element("year-panel");
    this.documentSearch = this.element("document-search");
    this.yearInput = this.element("year-input");
    for (const id of ["collection-filter", "document-filter"]) {
      const trigger = this.element<HTMLButtonElement>(id);
      trigger.addEventListener("click", () =>
        this.toggle(
          this.browse,
          trigger,
          id === "document-filter"
            ? this.documentSearch
            : this.element("collection-list"),
        ),
      );
    }
    const yearTrigger = this.element<HTMLButtonElement>("year-filter");
    yearTrigger.addEventListener("click", () =>
      this.toggle(this.yearPanel, yearTrigger, this.yearInput),
    );
    this.documentSearch.addEventListener("input", () => this.renderDocuments());
    this.element("year-apply").addEventListener("click", () =>
      this.applyYear(),
    );
    this.yearInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.applyYear();
      }
    });
    this.yearInput.addEventListener("input", () => {
      this.showYearError(false);
      const value = this.yearInput.value.trim();
      if (!value || parseGalleryYearRange(value)) this.renderHistogram(value);
    });
    this.element("year-clear").addEventListener("click", () => {
      this.yearInput.value = "";
      this.applyYear();
    });
    this.document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node | null;
      if (target && !this.element("filter-toolbar").contains(target))
        this.close();
    });
    this.document.addEventListener("focusin", (event) => {
      const target = event.target as Node | null;
      if (target && !this.element("filter-toolbar").contains(target))
        this.close();
    });
    this.document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && this.activePopup) {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        }
      },
      true,
    );
  }

  private element<T extends HTMLElement>(id: string): T {
    const node = this.document.getElementById(id);
    if (!node) throw new Error(`Gallery markup is missing #${id}`);
    return node as T;
  }

  close(restoreFocus = false): void {
    if (!this.activePopup) return;
    const { panel, trigger } = this.activePopup;
    panel.hidden = true;
    for (const id of ["collection-filter", "document-filter", "year-filter"])
      this.element(id).setAttribute("aria-expanded", "false");
    this.activePopup = undefined;
    if (restoreFocus) trigger.focus();
  }

  private toggle(
    panel: HTMLElement,
    trigger: HTMLButtonElement,
    focus: HTMLElement,
  ): void {
    const wasOpen =
      this.activePopup?.panel === panel && this.activePopup.trigger === trigger;
    this.close();
    if (wasOpen) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    this.activePopup = { panel, trigger };
    focus.focus();
  }

  reset(): void {
    this.values = {
      collectionID: "",
      documentID: "",
      keyword: "",
      kind: "",
      year: "",
    };
    this.documentSearch.value = "";
    this.yearInput.value = "";
    this.showYearError(false);
  }

  render(
    state: Readonly<GalleryFacetState>,
    labels: Readonly<GalleryFilterLabels>,
    collections: readonly FigureGalleryCollection[],
  ): void {
    this.state = state;
    this.labels = labels;
    this.values = { ...state.filters };
    const [allDocuments, allCollections, allYears, allTypes] = labels.allLabels;
    const collectionLabel =
      collections.find(({ id }) => String(id) === state.filters.collectionID)
        ?.name ??
      state.collections.find(
        ([id]) => id === state.filters.collectionID,
      )?.[1] ??
      allCollections;
    this.element("collection-filter").textContent = collectionLabel;
    const documentLabel = state.documents.find(
      ([id]) => id === state.filters.documentID,
    )?.[1];
    // Keep the selected title visible when another filter leaves no matching cards.
    const documentButton = this.element<HTMLButtonElement>("document-filter");
    if (documentLabel || !state.filters.documentID)
      documentButton.textContent = documentLabel ?? allDocuments;
    this.element("year-filter").textContent = state.filters.year || allYears;
    if (this.document.activeElement !== this.yearInput)
      this.yearInput.value = state.filters.year;
    for (const id of ["collection-filter", "document-filter", "year-filter"])
      this.element(id).title = this.element(id).textContent ?? "";

    const tree = this.element("collection-list");
    tree.replaceChildren(
      this.option(
        allCollections,
        "",
        state.filters.collectionID,
        state.totals.collections,
        () => this.selectCollection(""),
      ),
    );
    const counts = new Map(
      state.collections.map(([id, , count]) => [id, count]),
    );
    const nodes = collections.length
      ? collections
      : state.collections.map(([id, name]) => ({
          id: Number(id),
          name,
          parentID: null,
        }));
    for (const node of buildGalleryCollectionTree(nodes)) {
      const id = String(node.id);
      const button = this.option(
        node.name,
        id,
        state.filters.collectionID,
        counts.get(id) ?? 0,
        () => this.selectCollection(id),
      );
      button.style.paddingInlineStart = `${10 + node.depth * 16}px`;
      button.classList.add("gallery-collection-option");
      const icon = createFigureSidebarIcon(this.document, "folder");
      icon.classList.add("gallery-folder-icon");
      button.prepend(icon);
      tree.append(button);
    }
    this.renderDocuments();

    const types = this.element("type-filter");
    const focusedKind = (
      this.document.activeElement as HTMLElement | null
    )?.closest<HTMLButtonElement>("[data-filter-kind]")?.dataset.filterKind;
    types.replaceChildren();
    for (const kind of ["", "figure", "table", "formula"] as const) {
      const label = kind ? labels.kindLabels[kind] : allTypes;
      const count = kind
        ? (state.kinds.find(([id]) => id === kind)?.[2] ?? 0)
        : state.totals.kinds;
      const button = this.document.createElement("button");
      button.type = "button";
      button.dataset.filterKind = kind;
      button.className = "gallery-type-button";
      button.title = formatGalleryOptionLabel(label, count);
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(state.filters.kind === kind));
      button.append(createFigureSidebarIcon(this.document, kind || "all"));
      button.addEventListener("click", () => {
        this.values.kind = this.values.kind === kind ? "" : kind;
        this.onChange();
      });
      types.append(button);
      if (focusedKind === kind) button.focus();
    }
    this.renderHistogram();
  }

  private option(
    label: string,
    value: string,
    selected: string,
    count: number,
    choose: () => void,
  ): HTMLButtonElement {
    const button = this.document.createElement("button");
    button.type = "button";
    button.className = "gallery-filter-option";
    button.setAttribute("aria-pressed", String(value === selected));
    button.title = label;
    const name = this.document.createElement("span");
    name.textContent = label;
    const badge = this.document.createElement("small");
    badge.textContent = String(count);
    button.append(name, badge);
    button.addEventListener("click", choose);
    return button;
  }

  private selectCollection(id: string): void {
    this.values.collectionID = id;
    this.values.documentID = "";
    this.onChange();
    this.documentSearch.focus();
  }

  private renderDocuments(): void {
    if (!this.state || !this.labels) return;
    const { state, labels } = this;
    const list = this.element("document-list");
    const choose = (id: string) => {
      this.values.documentID = id;
      this.onChange();
      this.close(true);
    };
    list.replaceChildren(
      this.option(
        labels.allLabels[0],
        "",
        state.filters.documentID,
        state.totals.documents,
        () => choose(""),
      ),
    );
    const search = this.documentSearch.value.trim().toLocaleLowerCase();
    const matches = state.documents.filter(([, title]) =>
      title.toLocaleLowerCase().includes(search),
    );
    for (const [id, title, count] of matches)
      list.append(
        this.option(title, id, state.filters.documentID, count, () =>
          choose(id),
        ),
      );
    if (!matches.length) {
      const empty = this.document.createElement("p");
      empty.className = "gallery-filter-hint";
      empty.textContent = labels.noDocuments;
      list.append(empty);
    }
  }

  private showYearError(invalid: boolean): void {
    this.yearInput.setAttribute("aria-invalid", String(invalid));
    const message = this.element("year-error");
    message.hidden = !invalid;
    message.textContent = invalid ? (this.labels?.invalidYear ?? "") : "";
  }

  private applyYear(): void {
    const value = this.yearInput.value.trim();
    const range = parseGalleryYearRange(value);
    if (value && !range) {
      this.showYearError(true);
      this.yearInput.focus();
      return;
    }
    this.showYearError(false);
    this.values.year = range
      ? range[0] === range[1]
        ? String(range[0])
        : `${range[0]}–${range[1]}`
      : "";
    this.onChange();
  }

  private renderHistogram(yearRange = this.values.year): void {
    if (!this.state || !this.labels) return;
    const chart = this.element("year-histogram");
    chart.replaceChildren();
    const hover = this.element("year-hover");
    hover.textContent = "";
    const bins = buildGalleryYearHistogram(this.state.years, yearRange);
    const maximum = Math.max(1, ...bins.map(({ count }) => count));
    const selected = parseGalleryYearRange(this.values.year);
    const labelEachYear = bins.length <= 8;
    chart.classList.toggle("is-dense", !labelEachYear);
    for (const { year, count } of bins) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "gallery-year-bar";
      button.title = `${year}: ${count} · ${this.labels.histogram}`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute(
        "aria-pressed",
        String(!!selected && year >= selected[0] && year <= selected[1]),
      );
      const bar = this.document.createElement("span");
      bar.className = "gallery-year-fill";
      bar.style.height = `${Math.max(2, (count / maximum) * 72)}px`;
      const quantity = this.document.createElement("span");
      quantity.className = "gallery-year-count";
      quantity.textContent = String(count);
      quantity.setAttribute("aria-hidden", "true");
      button.append(quantity, bar);
      if (labelEachYear) {
        const label = this.document.createElement("small");
        label.textContent = String(year);
        label.setAttribute("aria-hidden", "true");
        button.append(label);
      }
      const showValue = () => {
        hover.textContent = `${year}: ${count}`;
      };
      const clearValue = () => {
        hover.textContent = "";
      };
      button.addEventListener("pointerenter", showValue);
      button.addEventListener("focus", showValue);
      button.addEventListener("pointerleave", clearValue);
      button.addEventListener("blur", clearValue);
      button.addEventListener("click", () => {
        this.yearInput.value = String(year);
        this.applyYear();
        this.yearInput.focus();
      });
      chart.append(button);
    }
    this.element("year-first").textContent = bins.length
      ? String(bins[0].year)
      : "—";
    this.element("year-last").textContent = bins.length
      ? String(bins[bins.length - 1].year)
      : "—";
    this.element("year-axis").hidden = labelEachYear;
  }
}
