import * as assert from "node:assert/strict";
import test from "node:test";
import {
  openReaderSidebar,
  type PdfReader,
} from "../src/platform/zotero/reader";

test("opens the sidebar with current proxy, internal reader, and legacy APIs", () => {
  for (const api of ["proxy", "internal", "legacy"] as const) {
    const calls: boolean[] = [];
    const target = {
      toggleSidebar:
        api === "legacy"
          ? undefined
          : (open: boolean) => {
              calls.push(open);
            },
    };
    const reader =
      api === "proxy"
        ? target
        : api === "internal"
          ? { _internalReader: target }
          : { setSidebarOpen: (open: boolean) => calls.push(open) };
    openReaderSidebar(reader as unknown as PdfReader);
    openReaderSidebar(reader as unknown as PdfReader);
    assert.deepEqual(calls, [true, true]);
  }
  assert.doesNotThrow(() => openReaderSidebar({} as PdfReader));
});
