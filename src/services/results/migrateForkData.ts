import { config } from "../../../package.json";
import { getPref, setPref, type PreferenceSchema } from "../../utils/prefs";

const LEGACY_PREFS_PREFIX = "extensions.zotero.zoterofigure";
const PREFERENCE_KEYS: readonly (keyof PreferenceSchema)[] = [
  "autoRecognizeFormula",
  "duplicateMode",
  "galleryComparisonLayouts",
  "galleryImageScale",
  "galleryViewMode",
  "siliconFlowApiKey",
  "siliconFlowApiKeyValidated",
  "syncAnnotations",
  "view",
];

export async function migrateForkData(): Promise<void> {
  if (getPref("forkMigrationComplete")) return;
  const source = PathUtils.join(Zotero.DataDirectory.dir, "zotero-figure");
  const destination = PathUtils.join(
    Zotero.DataDirectory.dir,
    config.dataDirectory,
  );
  if (!(await IOUtils.exists(destination))) {
    // Publish the copy only after it is complete; never modify the old store.
    const staging = `${destination}.migrating`;
    await IOUtils.remove(staging, { recursive: true, ignoreAbsent: true });
    if (await IOUtils.exists(source)) {
      await IOUtils.copy(source, staging, {
        recursive: true,
        noOverwrite: true,
      });
    } else {
      await IOUtils.makeDirectory(staging);
    }
    await IOUtils.move(staging, destination, { noOverwrite: true });
  }
  for (const key of PREFERENCE_KEYS) {
    const target = `${config.prefsPrefix}.${key}`;
    if (Zotero.Prefs.rootBranch.prefHasUserValue(target)) continue;
    const value = Zotero.Prefs.get(`${LEGACY_PREFS_PREFIX}.${key}`, true);
    if (value !== undefined) Zotero.Prefs.set(target, value, true);
  }
  setPref("forkMigrationComplete", true);
}
