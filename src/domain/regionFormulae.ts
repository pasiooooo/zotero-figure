import {
  isCharacterCenteredInRect,
  matchFormulae,
  type AnnotationCandidate,
  type PageLayoutData,
  type Rect,
} from "./layout";
import { containsResultRegion } from "./resultRegion";

export function recoverRegionFormulae(
  page: PageLayoutData,
  region: Rect,
  cropped: AnnotationCandidate[],
): AnnotationCandidate[] {
  const context = matchFormulae(page);
  const replaced = new Set<AnnotationCandidate>();
  const recovered: AnnotationCandidate[] = [];
  const labels: Rect[] = [];
  for (const formula of context.candidates) {
    const body = formula.rect;
    const intersection: Rect = [
      Math.max(body[0], region[0]),
      Math.max(body[1], region[1]),
      Math.min(body[2], region[2]),
      Math.min(body[3], region[3]),
    ];
    if (!containsResultRegion(region, body)) {
      if (
        area(intersection) < 0.75 * area(body) ||
        area(intersection) < 0.65 * area(region)
      )
        continue;
      const ink = page.chars.filter(
        (char) => char.c.trim() && isCharacterCenteredInRect(char, body),
      );
      if (
        !ink.length ||
        !ink.every((char) => isCharacterCenteredInRect(char, region))
      )
        continue;
    }
    const touching = cropped.filter(
      ({ rect }) => overlap(rect, intersection) > 0,
    );
    const matching = touching.filter((candidate) => {
      if (!candidate.tag.startsWith("Formula") && candidate.comment.trim())
        return false;
      const shared = overlap(candidate.rect, intersection);
      return (
        shared >= 0.45 * Math.max(area(candidate.rect), area(intersection)) &&
        shared >= 0.65 * Math.min(area(candidate.rect), area(intersection))
      );
    });
    if (touching.length && !matching.length) continue;
    matching.forEach((candidate) => replaced.add(candidate));
    const metadata =
      !formula.comment &&
      matching.find(
        (candidate) => candidate.tag.startsWith("Formula") && candidate.comment,
      );
    recovered.push({
      ...formula,
      ...(metadata && { comment: metadata.comment, tag: metadata.tag }),
      rect: intersection,
    });
    const label = context.labels.get(formula);
    if (label) labels.push(label);
  }
  if (!recovered.length) return cropped;
  const isNumberCrop = (rect: Rect) => {
    const matches = labels.filter((label) => overlap(label, rect) > 0);
    if (!matches.length) return false;
    const pad = Math.max(...matches.map((label) => label[3] - label[1]));
    const ink = page.chars.filter(
      (char) => char.c.trim() && isCharacterCenteredInRect(char, rect),
    );
    const verticalPadding = ink.length ? 2 * pad : pad;
    const envelope: Rect = [
      Math.min(...matches.map((label) => label[0])) - pad,
      Math.min(...matches.map((label) => label[1])) - verticalPadding,
      Math.max(...matches.map((label) => label[2])) + pad,
      Math.max(...matches.map((label) => label[3])) + verticalPadding,
    ];
    return (
      containsResultRegion(envelope, rect) &&
      ink.every((char) =>
        matches.some((label) => isCharacterCenteredInRect(char, label, 2)),
      )
    );
  };
  return [
    ...cropped.filter(
      (candidate) => !replaced.has(candidate) && !isNumberCrop(candidate.rect),
    ),
    ...recovered,
  ];
}

function overlap(first: Rect, second: Rect): number {
  return (
    Math.max(0, Math.min(first[2], second[2]) - Math.max(first[0], second[0])) *
    Math.max(0, Math.min(first[3], second[3]) - Math.max(first[1], second[1]))
  );
}

function area(rect: Rect): number {
  return Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]);
}
