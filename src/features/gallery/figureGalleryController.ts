import { config } from "../../../package.json";
import { getString } from "../../utils/locale";

const BUTTON_ID = `${config.addonRef}-open-gallery`;
const WINDOW_NAME = `${config.addonRef}-gallery`;

export class FigureGalleryController {
  private started = false;
  private readonly galleryWindows = new Map<number | "library", Window>();

  constructor(private readonly window: Window) {}

  public start(): void {
    if (this.started) return;
    const document = this.window.document;
    const toolbar = document.getElementById("zotero-items-toolbar");
    if (!toolbar) return;
    const button = document.createXULElement("toolbarbutton");
    button.id = BUTTON_ID;
    button.setAttribute("class", "zotero-tb-button");
    button.setAttribute("tooltiptext", getString("gallery-menu-open"));
    button.setAttribute("aria-label", getString("gallery-menu-open"));
    button.setAttribute("tabindex", "0");
    button.setAttribute(
      "style",
      `width: 28px; height: 28px; background-image: url("chrome://${config.addonRef}/content/icons/favicon.png"); background-size: 16px 16px; background-position: center; background-repeat: no-repeat;`,
    );
    button.addEventListener("command", () => this.open());
    toolbar.insertBefore(button, toolbar.querySelector("spacer"));
    this.started = true;
  }

  public open(): void {
    this.openWindow();
  }

  public openAttachment(attachment: Zotero.Item): void {
    this.openWindow(attachment);
  }

  private openWindow(attachment?: Zotero.Item): void {
    const key = attachment?.id ?? "library";
    const existing = this.galleryWindows.get(key);
    if (existing && !existing.closed) {
      existing.maximize();
      existing.focus();
      return;
    }
    const filter = attachment
      ? `libraryID=${attachment.libraryID}&documentID=${attachment.parentItemID || attachment.id}&`
      : "";
    const uri = `chrome://${config.addonRef}/content/gallery/index.html?${filter}toolbar=collapsed&v=${Date.now()}`;
    // Native select popups need a content browser hosted by a chrome window.
    const window = this.window.openDialog(
      "chrome://zotero/content/standalone/basicViewer.xhtml",
      `${WINDOW_NAME}-${key}`,
      "chrome,dialog=no,resizable,centerscreen,width=1200,height=800",
      { wrappedJSObject: { uri } },
    );
    if (!window) throw new Error("Unable to open PDF Figure Library");
    this.galleryWindows.set(key, window);
    window.addEventListener(
      "load",
      () => {
        window.document
          .getElementById("navigator-toolbox")
          ?.setAttribute("hidden", "true");
        // basicViewer sizes itself during load; maximize after its handlers finish.
        window.setTimeout(() => {
          if (!window.closed) window.maximize();
        }, 0);
        window.addEventListener(
          "unload",
          () => {
            if (this.galleryWindows.get(key) === window)
              this.galleryWindows.delete(key);
          },
          { once: true },
        );
      },
      { once: true },
    );
  }

  public dispose(): void {
    this.window.document.getElementById(BUTTON_ID)?.remove();
    for (const window of this.galleryWindows.values()) {
      if (!window.closed) window.close();
    }
    this.galleryWindows.clear();
    this.started = false;
  }
}
