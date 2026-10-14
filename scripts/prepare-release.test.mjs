import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "./prepare-release.mjs";

const changelog =
  "# Changelog\r\n\r\n## [1.1.0] - 2026-10-14\r\n\r\n### 新增\r\n\r\n- Batch selection\r\n\r\n## [1.0.3] - 2026-10-01\r\n\r\n- Previous release\r\n";

test("extracts only the tagged version's notes with normalized newlines", () => {
  assert.equal(
    releaseNotes("1.1.0", "v1.1.0", changelog),
    "### 新增\n\n- Batch selection\n",
  );
  assert.equal(
    releaseNotes("1.0.3", "v1.0.3", changelog),
    "- Previous release\n",
  );
});

test("rejects mismatched tags, prereleases, missing and empty changelog entries", () => {
  assert.throws(() => releaseNotes("1.1.0", "v1.0.3", changelog), /must match/);
  assert.throws(
    () => releaseNotes("1.1.0-beta.1", "v1.1.0-beta.1", changelog),
    /stable version/,
  );
  assert.throws(
    () => releaseNotes("1.2.0", "v1.2.0", changelog),
    /missing version/,
  );
  assert.throws(
    () => releaseNotes("1.1.0", "v1.1.0", "## [1.1.0] - 2026-10-14\n\n"),
    /no notes/,
  );
});
