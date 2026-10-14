import { config } from "../../../package.json";
import { ZoteroMainTab } from "../../platform/zotero/mainTab";
import { getString } from "../../utils/locale";

const MENU_ID = `${config.addonRef}-open-gallery`;
const TAB_TYPE = `${config.addonRef}-gallery`;

export class FigureGalleryController {
  private readonly tab: ZoteroMainTab;
  private started = false;
  private readonly attachmentWindows = new Map<number, Window>();

  constructor(private readonly window: Window) {
    this.tab = new ZoteroMainTab(window, {
      contentURL: `chrome://${config.addonRef}/content/gallery/index.html?v=${Date.now()}`,
      iconName: `${config.addonRef}-gallery`,
      iconURL: `chrome://${config.addonRef}/content/icons/favicon.png`,
      title: getString("gallery-title"),
      type: TAB_TYPE,
    });
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    const popup = this.window.document.querySelector(
      "#menu_ToolsPopup",
    ) as XUL.MenuPopup | null;
    if (!popup) return;
    ztoolkit.Menu.register(popup, {
      commandListener: () => this.open(),
      icon: `chrome://${config.addonRef}/content/icons/favicon.png`,
      id: MENU_ID,
      label: getString("gallery-menu-open"),
      tag: "menuitem",
    });
  }

  public open(): void {
    this.tab.open();
  }

  public openAttachment(attachment: Zotero.Item): void {
    const existing = this.attachmentWindows.get(attachment.id);
    if (existing && !existing.closed) {
      existing.maximize();
      existing.focus();
      return;
    }
    const documentID = attachment.parentItemID || attachment.id;
    const uri = `chrome://${config.addonRef}/content/gallery/index.html?libraryID=${attachment.libraryID}&documentID=${documentID}&v=${Date.now()}`;
    // Native select popups need a content browser hosted by a chrome window.
    const window = this.window.openDialog(
      "chrome://zotero/content/standalone/basicViewer.xhtml",
      `${TAB_TYPE}-${attachment.id}`,
      "chrome,dialog=no,resizable,centerscreen,width=1200,height=800",
      { wrappedJSObject: { uri } },
    );
    if (!window) throw new Error("Unable to open PDF Figure Library");
    this.attachmentWindows.set(attachment.id, window);
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
            if (this.attachmentWindows.get(attachment.id) === window)
              this.attachmentWindows.delete(attachment.id);
          },
          { once: true },
        );
      },
      { once: true },
    );
  }

  public dispose(): void {
    this.window.document.getElementById(MENU_ID)?.remove();
    this.tab.dispose();
    for (const window of this.attachmentWindows.values()) {
      if (!window.closed) window.close();
    }
    this.attachmentWindows.clear();
    this.started = false;
  }
}
