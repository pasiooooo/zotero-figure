import type { Rect } from "../../domain/layout";
import type { PdfReader } from "../../platform/zotero/reader";
import { getString } from "../../utils/locale";

export interface ReaderRegionSelection {
  pageIndex: number;
  rect: Rect;
}

interface SelectionPage {
  div: HTMLElement;
  viewport: {
    width: number;
    height: number;
    convertToPdfPoint(x: number, y: number): number[];
  };
}

export function startReaderRegionSelection(
  reader: PdfReader,
  onSelect: (region: ReaderRegionSelection) => void,
  onClose: () => void,
): () => void {
  const internal = reader._internalReader;
  const view = internal?._lastView ?? internal?._primaryView;
  const pdfWindow = view?._iframeWindow;
  const frame = view?._iframe;
  const document = frame?.ownerDocument;
  const win = document?.defaultView;
  const viewer = pdfWindow?.PDFViewerApplication?.pdfViewer;
  const frameBounds = frame?.getBoundingClientRect();
  if (
    !win ||
    !pdfWindow ||
    !document?.body ||
    !viewer?.getPageView ||
    !frameBounds?.width ||
    !frameBounds.height ||
    !pdfWindow.innerWidth ||
    !pdfWindow.innerHeight
  ) {
    throw new Error(getString("region-selection-unavailable"));
  }
  const scaleX = frameBounds.width / pdfWindow.innerWidth;
  const scaleY = frameBounds.height / pdfWindow.innerHeight;

  // Keep the drag outside the PDF iframe so native annotation handlers never receive it.
  const overlay = document.createElement("div");
  overlay.id = "pasiofigure-region-capture";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", getString("sidebar-select-region"));
  overlay.style.cssText = `position:fixed;left:${frameBounds.left}px;top:${frameBounds.top}px;width:${frameBounds.width}px;height:${frameBounds.height}px;z-index:2147483647;cursor:crosshair;touch-action:none;user-select:none;background:rgba(0,0,0,.28);outline:none;overflow:hidden;`;
  const selection = document.createElement("div");
  selection.style.cssText =
    "display:none;position:absolute;box-sizing:border-box;border:2px solid #60a5fa;box-shadow:0 0 0 100vmax rgba(0,0,0,.28);pointer-events:none;";
  const hint = document.createElement("div");
  hint.style.cssText =
    "position:absolute;top:12px;left:50%;transform:translateX(-50%);max-width:90%;box-sizing:border-box;padding:10px 14px;border-radius:8px;background:#20242b;color:#fff;font:13px/1.5 sans-serif;cursor:default;display:flex;align-items:center;gap:12px;";
  const label = document.createElement("span");
  label.textContent = getString("region-selection-hint");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = getString("sidebar-correct-region-cancel");
  cancel.style.cssText =
    "background:#374151;color:white;border:1px solid #9ca3af;border-radius:4px;padding:4px 8px;cursor:pointer;flex-shrink:0;font:inherit;";
  hint.append(label, cancel);
  overlay.append(selection, hint);

  let disposed = false;
  let drag:
    | {
        pointerID: number;
        page: SelectionPage;
        pageIndex: number;
        bounds: Pick<
          DOMRect,
          "left" | "top" | "right" | "bottom" | "width" | "height"
        >;
        startX: number;
        startY: number;
      }
    | undefined;
  const keyboardTargets = new Set<Window>([win, pdfWindow]);
  const stopEvent = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    drag = undefined;
    overlay.remove();
    for (const target of keyboardTargets)
      target.removeEventListener("keydown", handleKeyDown, true);
    win.removeEventListener("pagehide", dispose);
    win.removeEventListener("resize", dispose);
    pdfWindow.removeEventListener("pagehide", dispose);
    pdfWindow.removeEventListener("resize", dispose);
    pdfWindow.document.removeEventListener("scroll", dispose, true);
    onClose();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      stopEvent(event);
      dispose();
    } else if (event.key === "Tab") {
      stopEvent(event);
      cancel.focus();
    }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.target === cancel) return;
    stopEvent(event);
    if (event.button !== 0 || drag) return;
    const pageElement = pdfWindow.document
      .elementsFromPoint(
        (event.clientX - frameBounds.left) / scaleX,
        (event.clientY - frameBounds.top) / scaleY,
      )
      .map((element) => element.closest<HTMLElement>(".page[data-page-number]"))
      .find(Boolean);
    const pageIndex = Number(pageElement?.dataset.pageNumber) - 1;
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return;
    const page: SelectionPage | undefined = viewer.getPageView(pageIndex);
    if (!page?.viewport || page.div !== pageElement) return;
    const pageBounds = (
      page.div.querySelector<HTMLElement>(".canvasWrapper") ?? page.div
    ).getBoundingClientRect();
    const bounds = {
      left: frameBounds.left + pageBounds.left * scaleX,
      top: frameBounds.top + pageBounds.top * scaleY,
      right: frameBounds.left + pageBounds.right * scaleX,
      bottom: frameBounds.top + pageBounds.bottom * scaleY,
      width: pageBounds.width * scaleX,
      height: pageBounds.height * scaleY,
    };
    if (
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      return;
    drag = {
      pointerID: event.pointerId,
      page,
      pageIndex,
      bounds,
      startX: event.clientX,
      startY: event.clientY,
    };
    overlay.setPointerCapture(event.pointerId);
    hint.style.display = "none";
    overlay.style.background = "transparent";
    handlePointerMove(event);
  };
  const screenRect = (event: PointerEvent): Rect => {
    const { bounds, startX, startY } = drag!;
    const x = Math.max(bounds.left, Math.min(bounds.right, event.clientX));
    const y = Math.max(bounds.top, Math.min(bounds.bottom, event.clientY));
    return [
      Math.min(startX, x),
      Math.min(startY, y),
      Math.max(startX, x),
      Math.max(startY, y),
    ];
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerID) return;
    stopEvent(event);
    const [left, top, right, bottom] = screenRect(event);
    Object.assign(selection.style, {
      display: "block",
      left: `${left - frameBounds.left}px`,
      top: `${top - frameBounds.top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerID || event.button !== 0)
      return;
    stopEvent(event);
    const rect = screenRect(event);
    const { bounds, page, pageIndex } = drag;
    drag = undefined;
    overlay.releasePointerCapture(event.pointerId);
    if (rect[2] - rect[0] < 5 || rect[3] - rect[1] < 5) {
      selection.style.display = "none";
      hint.style.display = "flex";
      overlay.style.background = "rgba(0,0,0,.28)";
      return;
    }
    const point = (x: number, y: number) =>
      page.viewport.convertToPdfPoint(
        ((x - bounds.left) * page.viewport.width) / bounds.width,
        ((y - bounds.top) * page.viewport.height) / bounds.height,
      );
    const first = point(rect[0], rect[1]);
    const second = point(rect[2], rect[3]);
    const pdfRect: Rect = [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
    ];
    dispose();
    if (
      pdfRect.every(Number.isFinite) &&
      pdfRect[2] > pdfRect[0] &&
      pdfRect[3] > pdfRect[1]
    ) {
      onSelect({ pageIndex, rect: pdfRect });
    }
  };
  overlay.addEventListener("pointerdown", handlePointerDown);
  overlay.addEventListener("pointermove", handlePointerMove);
  overlay.addEventListener("pointerup", handlePointerUp);
  overlay.addEventListener("pointercancel", dispose);
  overlay.addEventListener("lostpointercapture", () => {
    if (drag) dispose();
  });
  overlay.addEventListener("contextmenu", (event) => {
    stopEvent(event);
    dispose();
  });
  overlay.addEventListener("wheel", stopEvent, { passive: false });
  cancel.addEventListener("click", dispose);
  for (const target of keyboardTargets)
    target.addEventListener("keydown", handleKeyDown, true);
  win.addEventListener("pagehide", dispose);
  win.addEventListener("resize", dispose);
  pdfWindow.addEventListener("pagehide", dispose);
  pdfWindow.addEventListener("resize", dispose);
  pdfWindow.document.addEventListener("scroll", dispose, true);
  document.body.append(overlay);
  overlay.focus({ preventScroll: true });
  return dispose;
}
