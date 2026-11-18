import * as assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { config } from "../package.json";

for (const environment of ["production", "development"]) {
  test(`toolkit startup and cleanup leave protocol bridges inactive (${environment})`, async () => {
    const result = await build({
      bundle: true,
      define: { __env__: JSON.stringify(environment) },
      format: "iife",
      globalName: "ToolkitTest",
      stdin: {
        contents: 'export { createZToolkit } from "./src/utils/ztoolkit";',
        resolveDir: process.cwd(),
      },
      write: false,
    });
    const bridgeAccesses: string[] = [];
    const mainWindow = {};
    let choice = 0;
    class NativeFilePicker {
      public readonly modeGetFolder = 2;
      public readonly returnOK = 0;
      public readonly returnReplace = 2;
      public readonly file = "/export";
      public init(window: Window, title: string, mode: number): void {
        assert.equal(window, mainWindow);
        assert.equal(title, "Export PNG");
        assert.equal(mode, this.modeGetFolder);
      }
      public async show(): Promise<number> {
        return choice;
      }
    }
    const context = {
      ChromeUtils: {
        importESModule(uri: string) {
          assert.equal(uri, "chrome://zotero/content/modules/filePicker.mjs");
          return { FilePicker: NativeFilePicker };
        },
      },
      Zotero: new Proxy(
        { getMainWindow: () => mainWindow, debug: () => {} },
        {
          has(target, property) {
            if (property === "_toolkitGlobal") {
              bridgeAccesses.push(String(property));
              throw new Error(
                "Toolkit global would initialize protocol bridges",
              );
            }
            return Reflect.has(target, property);
          },
        },
      ),
      ToolkitTest: undefined as unknown as {
        createZToolkit: typeof import("../src/utils/ztoolkit").createZToolkit;
      },
    };
    runInNewContext(result.outputFiles[0].text, context);
    const toolkit = context.ToolkitTest.createZToolkit();
    assert.equal("Menu" in toolkit, false);
    assert.equal(typeof toolkit.UI.createElement, "function");
    assert.equal(typeof toolkit.Dialog, "function");
    assert.equal(typeof toolkit.ProgressWindow, "function");
    assert.equal(typeof toolkit.FilePicker, "function");
    assert.equal(toolkit.basicOptions.api.pluginID, config.addonID);
    assert.equal("Prompt" in toolkit, false);
    assert.equal(
      toolkit.basicOptions.log.disableConsole,
      environment === "production",
    );
    assert.equal(
      await new toolkit.FilePicker("Export PNG", "folder").open(),
      "/export",
    );
    choice = 1;
    assert.equal(
      await new toolkit.FilePicker("Export PNG", "folder").open(),
      false,
    );
    NativeFilePicker.prototype.show = async () => {
      throw new Error("picker unavailable");
    };
    await assert.rejects(
      new toolkit.FilePicker("Export PNG", "folder").open(),
      /picker unavailable/,
    );

    let removed = 0;
    const element = { remove: () => removed++ };
    const ui = toolkit.UI as unknown as { elementCache: WeakRef<Element>[] };
    ui.elementCache.push(new WeakRef(element as unknown as Element));
    toolkit.unregisterAll();
    assert.equal(removed, 1);
    assert.deepEqual(bridgeAccesses, []);
  });
}
