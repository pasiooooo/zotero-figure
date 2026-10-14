import * as assert from "node:assert/strict";
import test from "node:test";
import {
  mapLayoutElementsToPdf,
  transformRect,
} from "../src/domain/pdfCoordinates";
import { buildAnnotationCandidates } from "../src/domain/layout";
import type { LayoutElement } from "../src/domain/layout";

const element: LayoutElement = {
  score: 0.9,
  type: "figure",
  xyxy: [0.1, 0.2, 0.4, 0.5],
};

test("preserves normalized detections on an unrotated offset CropBox", () => {
  const [mapped] = mapLayoutElementsToPdf([element], {
    pageBounds: [0, 0, 612, 792],
    pageToPdf: [1, 0, 0, -1, 10, 812],
    viewBox: [10, 20, 622, 812],
  });

  assertRectClose(mapped.xyxy, [0.1, 0.2, 0.4, 0.5]);
});

test("maps a rotated page detection back into Zotero PDF coordinates", () => {
  const [mapped] = mapLayoutElementsToPdf([element], {
    pageBounds: [0, 0, 792, 612],
    pageToPdf: [0, 1, 1, 0, 10, 20],
    viewBox: [10, 20, 622, 812],
  });

  assertRectClose(mapped.xyxy, [0.2, 0.6, 0.5, 0.9]);
});

test("maps detections from a rotated selected crop into full PDF coordinates", () => {
  const pageBounds = transformRect(
    [110, 220, 310, 420],
    [0, 1, 1, 0, -20, -10],
  );
  const elements = mapLayoutElementsToPdf(
    [{ ...element, xyxy: [0, 0, 1, 1] }],
    {
      pageBounds,
      pageToPdf: [0, 1, 1, 0, 10, 20],
      viewBox: [10, 20, 610, 820],
    },
  );
  const [candidate] = buildAnnotationCandidates(
    {
      chars: [],
      elements,
      pageIndex: 0,
      height: 800,
      width: 600,
      viewBox: [10, 20, 610, 820],
    },
    true,
  );
  assert.deepEqual(candidate.rect, [110, 220, 310, 420]);
});

function assertRectClose(
  actual: readonly number[],
  expected: readonly number[],
): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-10,
      `${value} differs from ${expected[index]}`,
    );
  });
}
