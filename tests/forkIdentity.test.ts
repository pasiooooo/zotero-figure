import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test, { type TestContext } from "node:test";
import { config } from "../package.json";
import { MODEL_MANAGED_DIRECTORY } from "../src/services/model/modelCatalog";
import { migrateForkData } from "../src/services/results/migrateForkData";

test("fork installation, runtime, and update identities are independent", () => {
  assert.equal(config.addonID, "zotero-figure@pasiooooo.github.io");
  assert.equal(config.addonInstance, "PasioFigure");
  assert.equal(config.prefsPrefix, `extensions.zotero.${config.addonRef}`);
  assert.equal(MODEL_MANAGED_DIRECTORY, `${config.dataDirectory}/models`);
  assert.equal(
    config.updateURL,
    "https://github.com/pasiooooo/zotero-figure/releases/latest/download/update.json",
  );
  assert.equal(
    config.updateLink,
    "https://github.com/pasiooooo/zotero-figure/releases/latest/download/zotero-figure.xpi",
  );
  for (const file of [
    "src/features/reader/figureSidebarPanel.ts",
    "addon/chrome/content/figure-sidebar.css",
  ]) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /zoterofigure-/);
  }
});

test("first startup copies data and settings without changing the original plugin", async (t) => {
  const h = installHarness(t);
  fs.mkdirSync(path.join(h.legacy, "results"), { recursive: true });
  fs.writeFileSync(
    path.join(h.legacy, "results", "image.png"),
    Uint8Array.of(1, 2, 3),
  );
  fs.writeFileSync(
    path.join(h.legacy, "comparison-layouts.json"),
    '{"1":{"rows":[]}}',
  );
  h.prefs.set("extensions.zotero.zoterofigure.galleryImageScale", 150);
  h.prefs.set("extensions.zotero.zoterofigure.siliconFlowApiKey", "test-key");
  h.prefs.set(`${config.prefsPrefix}.galleryImageScale`, 125);
  await migrateForkData();
  assert.deepEqual(
    fs.readFileSync(path.join(h.target, "results", "image.png")),
    Buffer.from([1, 2, 3]),
  );
  assert.equal(
    fs.readFileSync(path.join(h.target, "comparison-layouts.json"), "utf8"),
    '{"1":{"rows":[]}}',
  );
  assert.equal(h.prefs.get(`${config.prefsPrefix}.galleryImageScale`), 125);
  assert.equal(
    h.prefs.get(`${config.prefsPrefix}.siliconFlowApiKey`),
    "test-key",
  );
  assert.equal(
    h.prefs.get("extensions.zotero.zoterofigure.galleryImageScale"),
    150,
  );
  assert.equal(
    fs.existsSync(path.join(h.legacy, "results", "image.png")),
    true,
  );
  assert.equal(
    h.prefs.get(`${config.prefsPrefix}.forkMigrationComplete`),
    true,
  );
  fs.writeFileSync(
    path.join(h.legacy, "results", "image.png"),
    Uint8Array.of(9),
  );
  await migrateForkData();
  assert.deepEqual(
    fs.readFileSync(path.join(h.target, "results", "image.png")),
    Buffer.from([1, 2, 3]),
  );
});

test("an existing fork data directory is never overwritten or merged", async (t) => {
  const h = installHarness(t);
  fs.mkdirSync(h.legacy);
  fs.mkdirSync(h.target);
  fs.writeFileSync(path.join(h.legacy, "comparison-layouts.json"), "old");
  fs.writeFileSync(path.join(h.target, "comparison-layouts.json"), "new");
  await migrateForkData();
  assert.equal(
    fs.readFileSync(path.join(h.target, "comparison-layouts.json"), "utf8"),
    "new",
  );
  assert.equal(
    fs.readFileSync(path.join(h.legacy, "comparison-layouts.json"), "utf8"),
    "old",
  );
});

test("a failed copy leaves originals intact and retries instead of publishing partial data", async (t) => {
  const h = installHarness(t);
  fs.mkdirSync(h.legacy);
  fs.writeFileSync(path.join(h.legacy, "comparison-layouts.json"), "original");
  const copy = IOUtils.copy;
  IOUtils.copy = async () => {
    fs.mkdirSync(`${h.target}.migrating`);
    fs.writeFileSync(
      path.join(`${h.target}.migrating`, "partial"),
      "incomplete",
    );
    throw new Error("copy failed");
  };
  await assert.rejects(migrateForkData(), /copy failed/);
  assert.equal(fs.existsSync(h.target), false);
  assert.equal(
    h.prefs.has(`${config.prefsPrefix}.forkMigrationComplete`),
    false,
  );
  assert.equal(
    fs.readFileSync(path.join(h.legacy, "comparison-layouts.json"), "utf8"),
    "original",
  );
  IOUtils.copy = copy;
  await migrateForkData();
  assert.equal(fs.existsSync(path.join(h.target, "partial")), false);
  assert.equal(
    fs.readFileSync(path.join(h.target, "comparison-layouts.json"), "utf8"),
    "original",
  );
});

test("a fresh installation initializes only the fork directory", async (t) => {
  const h = installHarness(t);
  await migrateForkData();
  assert.equal(fs.existsSync(h.target), true);
  assert.equal(fs.existsSync(h.legacy), false);
  assert.equal(
    h.prefs.get(`${config.prefsPrefix}.forkMigrationComplete`),
    true,
  );
});

function installHarness(t: TestContext) {
  const previous = {
    Zotero: globalThis.Zotero,
    IOUtils: globalThis.IOUtils,
    PathUtils: globalThis.PathUtils,
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "figure-fork-test-"));
  const prefs = new Map<string, string | number | boolean>();
  globalThis.Zotero = {
    DataDirectory: { dir: directory },
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: string | number | boolean) =>
        prefs.set(key, value),
      rootBranch: { prefHasUserValue: (key: string) => prefs.has(key) },
    },
  } as unknown as typeof Zotero;
  globalThis.PathUtils = { join: path.join } as unknown as typeof PathUtils;
  globalThis.IOUtils = {
    exists: async (file: string) => fs.existsSync(file),
    copy: async (source: string, target: string) =>
      fs.cpSync(source, target, {
        recursive: true,
        force: false,
        errorOnExist: true,
      }),
    move: async (source: string, target: string) => {
      assert.equal(fs.existsSync(target), false);
      fs.renameSync(source, target);
    },
    makeDirectory: async (file: string) => {
      fs.mkdirSync(file);
    },
    remove: async (file: string) =>
      fs.rmSync(file, { recursive: true, force: true }),
  } as unknown as typeof IOUtils;
  t.after(() => {
    globalThis.Zotero = previous.Zotero;
    globalThis.IOUtils = previous.IOUtils;
    globalThis.PathUtils = previous.PathUtils;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    prefs,
    legacy: path.join(directory, "zotero-figure"),
    target: path.join(directory, config.dataDirectory),
  };
}
