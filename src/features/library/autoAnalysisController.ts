import { config } from "../../../package.json";
import type { LayoutAnalyzer } from "../../services/layout/layoutAnalyzer";
import { isCancellationError, throwIfAborted } from "../../utils/cancellation";
import { getPref } from "../../utils/prefs";

const IMPORT_DELAY_MS = 2_000;
const FILE_RETRY_DELAY_MS = 10_000;
const MAX_FILE_ATTEMPTS = 30;

export class AutoAnalysisController {
  // Pending work retains IDs and retry counts, never PDF bytes or result images.
  private readonly pending = new Map<number, number>();
  private observerID?: string;
  private preferenceObserver?: symbol;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: AbortController;
  private activeID?: number;

  constructor(
    private readonly analyzer: LayoutAnalyzer,
    private readonly onAnalyzed: (
      attachment: Zotero.Item,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {}

  public start(): void {
    if (this.observerID !== undefined) return;
    this.observerID = Zotero.Notifier.registerObserver(
      { notify: (event, type, ids) => this.notify(event, type, ids) },
      ["item"],
      `${config.addonRef}-auto-analysis`,
    );
    this.preferenceObserver = Zotero.Prefs.registerObserver(
      `${config.prefsPrefix}.autoAnalyzeNewPdfs`,
      () => {
        if (getPref("autoAnalyzeNewPdfs") !== true) this.cancel();
      },
      true,
    );
  }

  public dispose(): void {
    if (this.observerID !== undefined)
      Zotero.Notifier.unregisterObserver(this.observerID);
    if (this.preferenceObserver !== undefined)
      Zotero.Prefs.unregisterObserver(this.preferenceObserver);
    this.observerID = undefined;
    this.preferenceObserver = undefined;
    this.cancel();
  }

  private notify(event: string, type: string, ids: string[] | number[]): void {
    if (type !== "item" || this.observerID === undefined) return;
    if (event === "delete" || event === "trash") {
      for (const id of ids) {
        this.pending.delete(Number(id));
        if (Number(id) === this.activeID) this.active?.abort();
      }
      return;
    }
    if (event !== "add" || getPref("autoAnalyzeNewPdfs") !== true) return;
    for (const value of ids) {
      const id = Number(value);
      const item = Zotero.Items.get(id);
      if (
        item &&
        !item.deleted &&
        item.isPDFAttachment() &&
        id !== this.activeID &&
        !this.pending.has(id)
      ) {
        this.pending.set(id, 0);
      }
    }
    // Never return the analysis promise to Zotero's import notification chain.
    this.schedule(IMPORT_DELAY_MS);
  }

  private cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.active?.abort();
  }

  private schedule(delay: number): void {
    if (
      this.observerID === undefined ||
      this.active ||
      this.timer !== undefined ||
      this.pending.size === 0 ||
      getPref("autoAnalyzeNewPdfs") !== true
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, delay);
  }

  private async drain(): Promise<void> {
    const controller = new AbortController();
    this.active = controller;
    const { signal } = controller;
    try {
      for (const [id, attempts] of this.pending) {
        throwIfAborted(signal);
        this.activeID = id;
        let retry = false;
        try {
          const item = await Zotero.Items.getAsync(id);
          throwIfAborted(signal);
          if (!item || item.deleted || !item.isPDFAttachment()) continue;
          const path = await item.getFilePathAsync();
          throwIfAborted(signal);
          if (!path) {
            retry = attempts + 1 < MAX_FILE_ATTEMPTS;
            if (retry) this.pending.set(id, attempts + 1);
            else
              ztoolkit.log("Automatic analysis skipped: PDF is not local", id);
            continue;
          }
          const summary = await this.analyzer.analyzeAttachment(
            item,
            { update() {} },
            {
              duplicateMode: "skip-existing",
              signal,
              skipIfAnalyzed: true,
              syncAnnotations: getPref("syncAnnotations") === true,
            },
          );
          throwIfAborted(signal);
          if (summary.totalPages > 0) await this.onAnalyzed(item, signal);
        } catch (error) {
          if (signal.aborted || isCancellationError(error)) return;
          ztoolkit.log("Automatic PDF analysis failed", {
            attachmentID: id,
            error,
          });
        } finally {
          if (!signal.aborted && !retry) this.pending.delete(id);
          this.activeID = undefined;
          // Yield even when missing files or existing results make a batch cheap.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    } catch (error) {
      if (!isCancellationError(error)) Zotero.logError(error as Error);
    } finally {
      this.active = undefined;
      this.schedule(FILE_RETRY_DELAY_MS);
    }
  }
}
