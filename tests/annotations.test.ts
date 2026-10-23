import * as assert from "node:assert/strict";
import test from "node:test";
import type { AnnotationCandidate } from "../src/domain/layout";
import {
  getGeneratedAnnotationKind,
  getImageAnnotationCandidate,
  isGeneratedResultAnnotation,
  reconcileGeneratedAnnotations,
  removeGeneratedAnnotationForCandidate,
  updateGeneratedAnnotationCommentForCandidate,
  updateGeneratedAnnotationPositionForCandidate,
} from "../src/platform/zotero/annotations";
import type { PdfReader } from "../src/platform/zotero/reader";
import { createZoteroFigureGalleryPlatform } from "../src/platform/zotero/figureGallery";

test("identifies generated annotations by both author and tag", () => {
  assert.equal(
    isGeneratedResultAnnotation(annotation("zoterofigure", "Figure 2")),
    false,
  );
  assert.equal(
    isGeneratedResultAnnotation(annotation("pasiofigure", "Figure 2")),
    true,
  );
  assert.equal(
    isGeneratedResultAnnotation(annotation("Researcher", "Figure 2")),
    false,
  );
  assert.equal(
    isGeneratedResultAnnotation(annotation("pasiofigure", "Important")),
    false,
  );
  assert.equal(
    isGeneratedResultAnnotation(annotation("pasiofigure", "Formula 7")),
    true,
  );
  for (const kind of ["figure", "table", "formula"] as const) {
    assert.equal(
      isGeneratedResultAnnotation(annotation("pasiofigure", kind)),
      true,
    );
    assert.equal(
      isGeneratedResultAnnotation(annotation("Researcher", kind)),
      false,
    );
    assert.equal(getGeneratedAnnotationKind({ tags: [{ name: kind }] }), kind);
  }
});

test("selected conversion preserves unselected annotations and skips duplicates for all result types", async () => {
  const unselected = makeExistingAnnotation(
    makeCandidate("Figure 9", "Keep", 50),
  );
  const personal = makeExistingAnnotation(
    makeCandidate("Table 9", "Personal", 70),
  );
  personal.item.annotationAuthorName = "Researcher";
  const annotations = [unselected.item, personal.item];
  const attachment = {
    getAnnotations: () => annotations,
  } as unknown as Zotero.Item;
  const platform = createZoteroFigureGalleryPlatform();
  const harness = installZoteroHarness();
  try {
    for (const [index, kind] of (
      ["figure", "formula", "table"] as const
    ).entries()) {
      const tag = `${kind[0].toUpperCase()}${kind.slice(1)} 1`;
      const result = {
        ...makeCandidate(tag, `Selected ${kind}`, index * 10),
        id: kind,
        kind,
        imageFile: `${kind}.png`,
        pageLabel: "1",
      };
      await platform.addAnnotation(attachment, result);
      assert.equal(harness.created.length, index + 1);
      assert.deepEqual(harness.created[index].tags, [kind]);
      annotations.push(makeExistingAnnotation({ ...result, tag: kind }).item);
      await platform.addAnnotation(attachment, result);
      assert.equal(harness.created.length, index + 1);
    }
    assert.equal(unselected.erased, false);
    assert.equal(personal.erased, false);
    assert.ok(harness.created.every(({ erased }) => !erased));
  } finally {
    harness.restore();
  }
});

test("imports category-tagged image annotations without losing their result kind", () => {
  for (const tag of ["figure", "table", "formula", "Table 2"]) {
    const existing = makeExistingAnnotation(makeCandidate(tag, "Caption"));
    existing.item.isAnnotation = () => true;
    const result = getImageAnnotationCandidate(existing.item);
    assert.equal(result?.tag, tag);
    assert.equal(result?.comment, "Caption");
  }
});

test("replacement recognizes category-tagged annotations and numbered legacy annotations as the same result", async () => {
  const candidate = makeCandidate("Table 2", "Table 2. Caption");
  const harness = installZoteroHarness();
  try {
    for (const tag of ["Table 2", "table"]) {
      const existing = makeExistingAnnotation({ ...candidate, tag });
      const result = await reconcileGeneratedAnnotations(
        makeReader([existing.item]),
        0,
        [candidate],
        "replace-page",
      );
      assert.deepEqual(result, { created: 0, removed: 0, skipped: 1 });
      assert.equal(existing.erased, false);
    }
    assert.equal(harness.created.length, 0);
  } finally {
    harness.restore();
  }
});

test("deleting a numbered local result removes its category-tagged annotation only", async () => {
  const candidate = makeCandidate("Formula 3", "(3)");
  const existing = makeExistingAnnotation({ ...candidate, tag: "formula" });
  const other = makeExistingAnnotation(makeCandidate("formula", "Keep", 50));
  const attachment = {
    getAnnotations: () => [existing.item, other.item],
  } as unknown as Zotero.Item;
  assert.equal(
    await removeGeneratedAnnotationForCandidate(attachment, candidate),
    true,
  );
  assert.equal(existing.erased, true);
  assert.equal(other.erased, false);
});

test("rejects annotation candidates without a generated result tag", async () => {
  const harness = installZoteroHarness();
  try {
    await assert.rejects(
      reconcileGeneratedAnnotations(
        makeReader([]),
        0,
        [makeCandidate("Important", "Not a generated result")],
        "replace-page",
      ),
      /invalid result tag/,
    );
    assert.equal(harness.created.length, 0);
  } finally {
    harness.restore();
  }
});

test("replacement does not delete or claim upstream annotations", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Caption");
  const existing = makeExistingAnnotation(candidate);
  existing.item.annotationAuthorName = "zoterofigure";
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      makeReader([existing.item]),
      0,
      [candidate],
      "replace-page",
    );
    assert.equal(existing.erased, false);
    assert.equal(result.created, 1);
    assert.equal(result.removed, 0);
  } finally {
    harness.restore();
  }
});

function annotation(author: string, tag: string): Zotero.Item {
  return {
    annotationAuthorName: author,
    annotationType: "image",
    getTags: () => [{ tag }],
  } as unknown as Zotero.Item;
}

test("replace-page is idempotent when generated annotations are unchanged", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Caption");
  const existing = makeExistingAnnotation(candidate);
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      makeReader([existing.item]),
      0,
      [candidate],
      "replace-page",
    );

    assert.deepEqual(result, { created: 0, removed: 0, skipped: 1 });
    assert.equal(harness.created.length, 0);
    assert.equal(existing.erased, false);
  } finally {
    harness.restore();
  }
});

test("annotation reconciliation accepts a PDF attachment without a Reader", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Caption");
  const existing = makeExistingAnnotation(candidate);
  const attachment = {
    getAnnotations: () => [existing.item],
  } as unknown as Zotero.Item;
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      attachment,
      0,
      [candidate],
      "replace-page",
    );

    assert.deepEqual(result, { created: 0, removed: 0, skipped: 1 });
    assert.equal(harness.created.length, 0);
  } finally {
    harness.restore();
  }
});

test("updates an existing generated annotation after a manual caption edit", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Corrected caption");
  let saves = 0;
  const annotation = {
    annotationAuthorName: "pasiofigure",
    annotationComment: "Figure 1. Detected caption",
    annotationPosition: JSON.stringify({
      pageIndex: candidate.pageIndex,
      rects: [candidate.rect],
    }),
    annotationType: "image",
    getTags: () => [{ tag: "figure" }],
    saveTx: async () => {
      saves++;
    },
  } as unknown as Zotero.Item;
  const attachment = {
    getAnnotations: () => [annotation],
  } as unknown as Zotero.Item;

  assert.equal(
    await updateGeneratedAnnotationCommentForCandidate(attachment, candidate),
    true,
  );
  assert.equal(annotation.annotationComment, candidate.comment);
  assert.equal(saves, 1);
});

test("updates an existing generated annotation after a region correction", async () => {
  const previous = makeCandidate("Formula 3", "(3)");
  const updated = {
    ...previous,
    rect: [2, 3, 12, 14] as [number, number, number, number],
  };
  let saves = 0;
  const existing = {
    annotationAuthorName: "pasiofigure",
    annotationComment: previous.comment,
    annotationPosition: JSON.stringify({
      pageIndex: previous.pageIndex,
      rects: [previous.rect],
    }),
    annotationType: "image",
    getTags: () => [{ tag: "formula" }],
    saveTx: async () => {
      saves++;
    },
  } as unknown as Zotero.Item;
  const attachment = {
    getAnnotations: () => [existing],
  } as unknown as Zotero.Item;

  assert.equal(
    await updateGeneratedAnnotationPositionForCandidate(
      attachment,
      previous,
      updated,
    ),
    true,
  );
  assert.deepEqual(JSON.parse(existing.annotationPosition), {
    pageIndex: 0,
    rects: [[2, 3, 12, 14]],
  });
  assert.equal(saves, 1);
});

test("skip-existing creates only missing generated annotations", async () => {
  const existingCandidate = makeCandidate("Figure 1", "Old caption");
  const missingCandidate = makeCandidate("Table 2", "Table 2. Results", 20);
  const existing = makeExistingAnnotation(existingCandidate);
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      makeReader([existing.item]),
      0,
      [existingCandidate, missingCandidate],
      "skip-existing",
    );

    assert.deepEqual(result, { created: 1, removed: 0, skipped: 1 });
    assert.equal(harness.created.length, 1);
    assert.equal(existing.erased, false);
  } finally {
    harness.restore();
  }
});

test("cancellation rolls back annotations created by the current page", async () => {
  const controller = new AbortController();
  const harness = installZoteroHarness(() => controller.abort());
  try {
    await assert.rejects(
      reconcileGeneratedAnnotations(
        makeReader([]),
        0,
        [
          makeCandidate("Figure 1", "Figure 1. Caption"),
          makeCandidate("Table 2", "Table 2. Results", 20),
        ],
        "skip-existing",
        controller.signal,
      ),
      { name: "OperationCancelledError" },
    );

    assert.equal(harness.created.length, 1);
    assert.equal(harness.created[0].erased, true);
  } finally {
    harness.restore();
  }
});

test("replace-page rolls back new annotations when old annotation removal fails", async () => {
  const previous = makeCandidate("Figure 1", "Figure 1. Old caption");
  const replacement = makeCandidate("Figure 2", "Figure 2. New caption");
  const existing = makeExistingAnnotation(previous);
  existing.item.eraseTx = async () => {
    throw new Error("simulated old annotation removal failure");
  };
  const harness = installZoteroHarness();
  try {
    await assert.rejects(
      reconcileGeneratedAnnotations(
        makeReader([existing.item]),
        0,
        [replacement],
        "replace-page",
      ),
      /simulated old annotation removal failure/,
    );

    assert.equal(harness.created.length, 1);
    assert.equal(harness.created[0].erased, true);
  } finally {
    harness.restore();
  }
});

test("rolls back an annotation when its tag save fails", async () => {
  const harness = installZoteroHarness(undefined, true);
  try {
    await assert.rejects(
      reconcileGeneratedAnnotations(
        makeReader([]),
        0,
        [makeCandidate("Formula 1", "(1)")],
        "skip-existing",
      ),
      /simulated annotation save failure/,
    );

    assert.equal(harness.created.length, 1);
    assert.equal(harness.created[0].erased, true);
  } finally {
    harness.restore();
  }
});

test("region reconciliation leaves outside and crossing annotations untouched", async () => {
  const old = makeExistingAnnotation(makeCandidate("Figure", "old"));
  const outside = makeExistingAnnotation(
    makeCandidate("Figure", "outside", 50),
  );
  const crossing = makeExistingAnnotation(
    makeCandidate("Figure", "crossing", 15),
  );
  const reader = makeReader([old.item, outside.item, crossing.item]);
  const harness = installZoteroHarness();
  try {
    const empty = await reconcileGeneratedAnnotations(
      reader,
      0,
      [],
      "replace-page",
      undefined,
      [0, 0, 20, 20],
    );
    assert.equal(empty.removed, 0);
    assert.equal(old.erased, false);
    const result = await reconcileGeneratedAnnotations(
      reader,
      0,
      [makeCandidate("Figure", "new"), makeCandidate("Figure", "outside", 50)],
      "replace-page",
      undefined,
      [0, 0, 20, 20],
    );
    assert.deepEqual(result, { created: 1, removed: 1, skipped: 0 });
    assert.equal(old.erased, true);
    assert.equal(outside.erased, false);
    assert.equal(crossing.erased, false);
  } finally {
    harness.restore();
  }
});

function makeCandidate(
  tag: string,
  comment: string,
  offset = 0,
): AnnotationCandidate {
  return {
    comment,
    pageIndex: 0,
    rect: [1 + offset, 2, 10 + offset, 12],
    tag,
  };
}

function makeExistingAnnotation(candidate: AnnotationCandidate): {
  erased: boolean;
  item: Zotero.Item;
} {
  const state = {
    erased: false,
    item: undefined as unknown as Zotero.Item,
  };
  state.item = {
    annotationAuthorName: "pasiofigure",
    annotationComment: candidate.comment,
    annotationPosition: JSON.stringify({
      pageIndex: candidate.pageIndex,
      rects: [candidate.rect],
    }),
    annotationType: "image",
    eraseTx: async () => {
      state.erased = true;
    },
    getTags: () => [{ tag: candidate.tag }],
  } as unknown as Zotero.Item;
  return state;
}

function makeReader(annotations: Zotero.Item[]): PdfReader {
  return {
    _item: {
      getAnnotations: () => annotations,
    },
  } as unknown as PdfReader;
}

function installZoteroHarness(
  onSave?: () => void,
  failCreatedSave = false,
): {
  created: Array<{ erased: boolean; item: Zotero.Item; tags: string[] }>;
  restore: () => void;
} {
  const previous = globalThis.Zotero;
  const created: Array<{ erased: boolean; item: Zotero.Item; tags: string[] }> =
    [];
  let nextKey = 1;
  globalThis.Zotero = {
    Annotations: {
      saveFromJSON: async () => {
        const state = {
          erased: false,
          tags: [] as string[],
          item: undefined as unknown as Zotero.Item,
        };
        state.item = {
          eraseTx: async () => {
            state.erased = true;
          },
          saveTx: async () => {
            if (failCreatedSave) {
              throw new Error("simulated annotation save failure");
            }
          },
          setTags: (tags: string[]) => {
            state.tags = tags;
          },
        } as unknown as Zotero.Item;
        created.push(state);
        onSave?.();
        return state.item;
      },
    },
    Utilities: {
      generateObjectKey: () => `KEY${nextKey++}`,
    },
    logError: () => undefined,
  } as unknown as typeof Zotero;
  return {
    created,
    restore: () => {
      globalThis.Zotero = previous;
    },
  };
}
