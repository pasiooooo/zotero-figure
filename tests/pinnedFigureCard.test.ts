import * as assert from "node:assert/strict";
import test from "node:test";
import {
  clampPinnedCardTransform,
  getPinnedCardSmoothingProgress,
  interpolatePinnedCardTransform,
  layoutPinnedCards,
  zoomPinnedCardAtPoint,
} from "../src/domain/pinnedFigureCard";

test("floating card layouts stay within the reader, never overlap and shrink dense batches", () => {
  for (const count of [1, 2, 3, 8, 30, 100]) {
    for (const area of [
      { x: 300, y: 12, width: 900, height: 700 },
      { x: 100, y: 12, width: 200, height: 140 },
    ]) {
      const sizes = Array.from({ length: count }, (_, index) => ({
        width: 300 + (index % 3) * 100,
        height: 180 + (index % 4) * 90,
      }));
      const cells = layoutPinnedCards(sizes, area, { x: 10000, y: 10000 });
      assert.equal(cells.length, count);
      for (const [index, cell] of cells.entries()) {
        assert.ok(cell.width > 0 && cell.height > 0);
        assert.ok(cell.x >= area.x && cell.y >= area.y);
        assert.ok(cell.x + cell.width <= area.x + area.width + 1e-8);
        assert.ok(cell.y + cell.height <= area.y + area.height + 1e-8);
        for (const other of cells.slice(index + 1)) {
          assert.ok(
            cell.x + cell.width <= other.x ||
              other.x + other.width <= cell.x ||
              cell.y + cell.height <= other.y ||
              other.y + other.height <= cell.y,
          );
        }
      }
    }
  }
  assert.deepEqual(
    layoutPinnedCards(
      [],
      { x: 0, y: 0, width: 800, height: 600 },
      { x: 100, y: 100 },
    ),
    [],
  );
  assert.deepEqual(
    layoutPinnedCards(
      [{ width: 200, height: 150 }],
      { x: 300, y: 12, width: 900, height: 700 },
      { x: 400, y: 120 },
    ),
    [{ x: 400, y: 120, width: 200, height: 150 }],
  );
});

test("keeps a pinned card inside the viewport when it fits", () => {
  assert.deepEqual(
    clampPinnedCardTransform(
      { scale: 1, x: 900, y: -20 },
      { height: 200, width: 300 },
      { height: 600, width: 800 },
      12,
    ),
    { scale: 1, x: 488, y: 12 },
  );
});

test("interpolates pinned card transforms without overshooting", () => {
  assert.deepEqual(
    interpolatePinnedCardTransform(
      { scale: 1, x: 20, y: 40 },
      { scale: 2, x: 120, y: 240 },
      0.25,
    ),
    { scale: 1.25, x: 45, y: 90 },
  );
  assert.deepEqual(
    interpolatePinnedCardTransform(
      { scale: 1, x: 20, y: 40 },
      { scale: 2, x: 120, y: 240 },
      2,
    ),
    { scale: 2, x: 120, y: 240 },
  );
});

test("keeps zoom smoothing consistent across different frame rates", () => {
  const fullInterval = getPinnedCardSmoothingProgress(100, 55);
  const quarterInterval = getPinnedCardSmoothingProgress(25, 55);
  const fourQuarterIntervals = 1 - (1 - quarterInterval) ** 4;

  assert.ok(Math.abs(fullInterval - fourQuarterIntervals) < 1e-12);
  assert.equal(getPinnedCardSmoothingProgress(0, 55), 0);
  assert.equal(getPinnedCardSmoothingProgress(10, 0), 1);
});

test("allows both edges of an oversized pinned card to be reached", () => {
  assert.equal(
    clampPinnedCardTransform(
      { scale: 3, x: -2_000, y: 0 },
      { height: 200, width: 300 },
      { height: 600, width: 800 },
      12,
    ).x,
    -112,
  );
  assert.equal(
    clampPinnedCardTransform(
      { scale: 3, x: 2_000, y: 0 },
      { height: 200, width: 300 },
      { height: 600, width: 800 },
      12,
    ).x,
    12,
  );
});

test("zooms around the pointer without moving its card-local position", () => {
  const current = { scale: 1, x: 100, y: 80 };
  const point = { x: 250, y: 180 };
  const zoomed = zoomPinnedCardAtPoint(current, 2, point);

  assert.deepEqual(zoomed, { scale: 2, x: -50, y: -20 });
  assert.equal((point.x - current.x) / current.scale, 150);
  assert.equal((point.x - zoomed.x) / zoomed.scale, 150);
  assert.equal((point.y - current.y) / current.scale, 100);
  assert.equal((point.y - zoomed.y) / zoomed.scale, 100);
});
