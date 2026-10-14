import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function releaseNotes(version, tag, changelog) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Releases require a stable version");
  assert.equal(tag, `v${version}`, "Tag and package version must match");
  const lines = changelog.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith(`## [${version}] - `),
  );
  assert.ok(start >= 0, `CHANGELOG.md is missing version ${version}`);
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  const notes = lines
    .slice(start + 1, next < 0 ? undefined : next)
    .join("\n")
    .trim();
  assert.ok(notes, `CHANGELOG.md has no notes for ${version}`);
  return `${notes}\n`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
  const { version, config } = readJSON("package.json");
  const lock = readJSON("package-lock.json");
  const manifest = readJSON("build/addon/manifest.json");
  const update = readJSON("update.json").addons[config.addonID].updates[0];
  for (const actual of [
    lock.version,
    lock.packages[""].version,
    manifest.version,
    update.version,
  ]) {
    assert.equal(
      actual,
      version,
      "Package, build, and update versions must match",
    );
  }
  assert.equal(manifest.applications.zotero.update_url, config.updateURL);
  assert.equal(
    update.update_link,
    config.updateLink.replace("/latest/download/", `/download/v${version}/`),
  );
  writeFileSync(
    "build/release-notes.md",
    releaseNotes(
      version,
      process.env.RELEASE_TAG ?? `v${version}`,
      readFileSync("CHANGELOG.md", "utf8"),
    ),
  );
  console.log(`Release metadata verified for v${version}`);
}
