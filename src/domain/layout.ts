import { extractFigureNumber } from "./figureNumber";

export type LayoutElementType =
  | "figure"
  | "figure_caption"
  | "table"
  | "table_caption"
  | "table_footnote"
  | "isolate_formula"
  | "formula_caption"
  | string;

export type Rect = [number, number, number, number];

export interface PdfCharacter {
  c: string;
  rect: Rect;
  mathStyle?: boolean;
  lineBreakAfter?: boolean;
  spaceAfter?: boolean;
}

export interface LayoutElement {
  score: number;
  type: LayoutElementType;
  xyxy: Rect;
}

export interface PageLayoutData {
  chars: PdfCharacter[];
  elements: LayoutElement[];
  height: number;
  pageIndex: number;
  viewBox: Rect;
  width: number;
}

export interface AnnotationCandidate {
  comment: string;
  pageIndex: number;
  rect: Rect;
  tag: string;
}

interface Caption {
  bottom: number;
  element?: LayoutElement;
  left: number;
  number: string;
  right: number;
  text: string;
  top: number;
}

const LATIN_PAGE_HINT =
  /(?:^|[^a-z0-9_])(?:fig(?:ure)?s?|tables?|charts?|schemes?|equations?|eqs?|formulae?|figura|figure|tabella|tabelle|grafico|grafici|schema|schemi|equazione|equazioni)(?:$|[^a-z0-9_])/i;
const RUSSIAN_PAGE_HINT =
  /(?:^|[^а-яё0-9_])(?:рис(?:\.|унок|унка|унки)?|табл(?:\.|ица|ицы)?|график(?:а|и)?|схем(?:а|ы)|формул(?:а|ы)|уравнен(?:ие|ия))(?:$|[^а-яё0-9_])/i;
const CHINESE_NUMBER = "[0-9一二三四五六七八九十百零〇]+";
const CHINESE_PAGE_HINT = new RegExp(
  `(?:图|表|式)\\s*${CHINESE_NUMBER}|(?:上|下|本|该|如(?:下)?)\\s*(?:图|表|式)|图\\s*(?:中|示)|表\\s*中|公式|方程`,
  "i",
);
const MATHEMATICAL_PAGE_HINT = /[=∑∫√±≤≥≈≠]/;
const CAPTION_PADDING = 5;
const MAX_CAPTION_DISTANCE_RATIO = 0.3;
const MAX_FOOTNOTE_DISTANCE_RATIO = 0.2;
const MAX_FORMULA_CAPTION_DISTANCE_RATIO = 0.5;
const FORMULA_NUMBER_LABEL =
  /^[（(]?\s*[A-Z]?\d+(?:[.\-‐‑–—]\d+)*[a-z]?\s*[）)]?$/i;

export function charsToText(chars: readonly PdfCharacter[]): string {
  const text: string[] = [];
  for (const char of chars) {
    text.push(char.c);
    if (
      (char.spaceAfter || char.lineBreakAfter) &&
      char !== chars[chars.length - 1] &&
      !text[text.length - 1].endsWith("-")
    ) {
      text.push(" ");
    }
  }
  return text.join("");
}

export function extractTextInRect(
  chars: readonly PdfCharacter[],
  rect: Rect,
  padding = 0,
): string {
  return charsToText(
    chars.filter((char) => isCharacterCenteredInRect(char, rect, padding)),
  ).trim();
}

export function pageMayContainFigures(chars: readonly PdfCharacter[]): boolean {
  const pageText = charsToText(chars).toLocaleLowerCase();
  // Image-only and failed-text-extraction pages must still reach the model.
  if (!pageText.trim()) return true;
  return (
    LATIN_PAGE_HINT.test(pageText) ||
    RUSSIAN_PAGE_HINT.test(pageText) ||
    CHINESE_PAGE_HINT.test(pageText) ||
    MATHEMATICAL_PAGE_HINT.test(pageText)
  );
}

export function buildAnnotationCandidates(
  page: PageLayoutData,
  includeUncaptioned = false,
): AnnotationCandidate[] {
  const formulae = matchFormulae(page);
  const subjectPage = {
    ...page,
    elements: page.elements.filter(
      (element) => !formulae.numberElements.has(element),
    ),
  };
  const candidates: AnnotationCandidate[] = [];
  for (const subjectType of ["figure", "table"] as const) {
    candidates.push(
      ...matchSubjectType(subjectPage, subjectType, includeUncaptioned),
    );
  }
  candidates.push(...formulae.candidates);
  return candidates;
}

function matchSubjectType(
  page: PageLayoutData,
  subjectType: "figure" | "table",
  includeUncaptioned: boolean,
): AnnotationCandidate[] {
  const captions = collectCaptions(page, `${subjectType}_caption`);
  const footnotes =
    subjectType === "table" ? collectTextRegions(page, "table_footnote") : [];
  const usedCaptions = new Set<number>();
  const usedFootnotes = new Set<number>();
  const candidates: AnnotationCandidate[] = [];

  for (const element of page.elements) {
    if (element.type !== subjectType) continue;

    const subject = toPdfRect(element.xyxy, page.width, page.height);
    const captionIndex = findClosestCaption(
      subject,
      captions,
      usedCaptions,
      subjectType,
      page.height,
    );
    if (captionIndex === undefined && !includeUncaptioned) continue;

    const caption =
      captionIndex === undefined ? undefined : captions[captionIndex];
    const [xMin, yMin] = page.viewBox;
    let crop = subject;
    let comment = caption?.text ?? "";
    if (subjectType === "table") {
      const footnoteIndex = findClosestRegionBelow(
        subject,
        footnotes,
        usedFootnotes,
        page.height,
      );
      if (footnoteIndex !== undefined) {
        const footnote = footnotes[footnoteIndex];
        usedFootnotes.add(footnoteIndex);
        crop = unionRects(crop, footnote);
        comment = [comment, footnote.text].filter(Boolean).join("\n\n");
      }
    }
    const rect: Rect = [
      roundCoordinate(crop[0] + xMin),
      roundCoordinate(crop[1] + yMin),
      roundCoordinate(crop[2] + xMin),
      roundCoordinate(crop[3] + yMin),
    ];

    if (!includeUncaptioned && !comment && rect[2] - rect[0] < 30) continue;

    if (captionIndex !== undefined) usedCaptions.add(captionIndex);
    candidates.push({
      comment,
      pageIndex: page.pageIndex,
      rect,
      tag: `${capitalize(subjectType)} ${caption?.number ?? ""}`.trim(),
    });
  }

  return candidates;
}

export function matchFormulae(page: PageLayoutData): {
  candidates: AnnotationCandidate[];
  numberElements: Set<LayoutElement>;
  labels: Map<AnnotationCandidate, Rect>;
} {
  const candidates: AnnotationCandidate[] = [];
  const numberElements = new Set<LayoutElement>();
  const labels = new Map<AnnotationCandidate, Rect>();
  const result = { candidates, numberElements, labels };
  const formulae = page.elements.filter(
    (element) => element.type === "isolate_formula",
  );
  if (!formulae.length) return result;
  const numberCaptions = (
    ["figure", "figure_caption", "isolate_formula"] as const
  )
    .flatMap((type) => collectTextRegions(page, type, 0))
    .filter((caption) => FORMULA_NUMBER_LABEL.test(caption.text));
  const numberBoxes = new Set(numberCaptions.map((caption) => caption.element));
  const printedNumbers = printedEquationNumbers(page);
  const captions = [
    ...collectTextRegions(page, "formula_caption", 0),
    ...numberCaptions,
    ...printedNumbers,
  ];
  const usedCaptions = new Set<number>();

  for (const element of [
    ...formulae.filter((box) => !numberBoxes.has(box)),
    ...formulae.filter((box) => numberBoxes.has(box)),
  ]) {
    if (numberElements.has(element)) continue;
    const subject = toPdfRect(element.xyxy, page.width, page.height);
    const captionIndex = findClosestFormulaCaption(
      subject,
      captions,
      usedCaptions,
      page,
    );
    const detected =
      captionIndex === undefined ? undefined : captions[captionIndex];
    const caption =
      detected &&
      (printedNumbers.find((printed) => captionsOverlap(printed, detected)) ??
        detected);
    if (captionIndex !== undefined && caption) {
      usedCaptions.add(captionIndex);
      captions.forEach((numberCaption, index) => {
        if (
          numberCaption === detected ||
          (captionsOverlap(numberCaption, caption) &&
            numberCaption.top - numberCaption.bottom <=
              2 * (caption.top - caption.bottom) + CAPTION_PADDING &&
            numberCaption.right - numberCaption.left <=
              2 * (caption.right - caption.left) + CAPTION_PADDING)
        ) {
          usedCaptions.add(index);
          if (
            numberCaption.element &&
            numberCaption.element.type !== "formula_caption"
          )
            numberElements.add(numberCaption.element);
        }
      });
    }
    const [xMin, yMin] = page.viewBox;
    const candidate: AnnotationCandidate = {
      comment: caption?.text ?? "",
      pageIndex: page.pageIndex,
      rect: [
        roundCoordinate(subject[0] + xMin),
        roundCoordinate(subject[1] + yMin),
        roundCoordinate(subject[2] + xMin),
        roundCoordinate(subject[3] + yMin),
      ],
      tag: `Formula ${caption?.number ?? ""}`.trim(),
    };
    candidates.push(candidate);
    if (caption)
      labels.set(candidate, [
        caption.left + xMin,
        caption.bottom + yMin,
        caption.right + xMin,
        caption.top + yMin,
      ]);
  }
  return result;
}

function printedEquationNumbers(page: PageLayoutData): Caption[] {
  const printed: Caption[] = [];
  let run: PdfCharacter[] = [];
  const flush = () => {
    const text = run
      .map((char) => char.c)
      .join("")
      .trim();
    if (
      text.length <= 32 &&
      /^[（(].+[）)]$/.test(text) &&
      FORMULA_NUMBER_LABEL.test(text)
    ) {
      const ink = run.filter((char) => char.c.trim());
      const [xMin, yMin] = page.viewBox;
      const left = Math.min(...ink.map((char) => char.rect[0])) - xMin;
      const right = Math.max(...ink.map((char) => char.rect[2])) - xMin;
      const bottom = Math.min(...ink.map((char) => char.rect[1])) - yMin;
      const top = Math.max(...ink.map((char) => char.rect[3])) - yMin;
      const insideGraphic = page.elements.some((element) => {
        if (element.type !== "figure" && element.type !== "table") return false;
        const rect = toPdfRect(element.xyxy, page.width, page.height);
        return (
          (rect[3] - rect[1] > 2.5 * (top - bottom) ||
            rect[2] - rect[0] > 2 * (right - left + top - bottom)) &&
          left >= rect[0] - 1 &&
          right <= rect[2] + 1 &&
          bottom >= rect[1] - 1 &&
          top <= rect[3] + 1
        );
      });
      if (!insideGraphic)
        printed.push({
          left,
          right,
          bottom,
          top,
          text,
          number: extractFigureNumber(text),
        });
    }
    run = [];
  };
  for (const char of page.chars) {
    const previous = run[run.length - 1];
    if (
      previous &&
      char.rect[0] - previous.rect[2] > 2 * (char.rect[3] - char.rect[1])
    )
      flush();
    run.push(char);
    if (char.lineBreakAfter) flush();
  }
  if (run.length) flush();
  return printed;
}

function captionsOverlap(first: Caption, second: Caption): boolean {
  return (
    Math.min(first.right, second.right) > Math.max(first.left, second.left) &&
    Math.min(first.top, second.top) > Math.max(first.bottom, second.bottom)
  );
}

function collectCaptions(
  page: PageLayoutData,
  captionType: "figure_caption" | "formula_caption" | "table_caption",
): Caption[] {
  return collectTextRegions(page, captionType);
}

function collectTextRegions(
  page: PageLayoutData,
  regionType:
    | "figure"
    | "figure_caption"
    | "isolate_formula"
    | "formula_caption"
    | "table_caption"
    | "table_footnote",
  padding = CAPTION_PADDING,
): Caption[] {
  return page.elements
    .filter((element) => element.type === regionType)
    .map((element) => {
      const [left, bottom, right, top] = toPdfRect(
        element.xyxy,
        page.width,
        page.height,
      );
      const text = extractTextInRect(
        page.chars,
        [
          left + page.viewBox[0],
          bottom + page.viewBox[1],
          right + page.viewBox[0],
          top + page.viewBox[1],
        ],
        padding,
      );
      return {
        bottom,
        element,
        left,
        number: extractFigureNumber(text),
        right,
        text,
        top,
      };
    });
}

function findClosestRegionBelow(
  subject: Rect,
  regions: readonly Caption[],
  usedRegions: ReadonlySet<number>,
  pageHeight: number,
): number | undefined {
  let closestIndex: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  regions.forEach((region, index) => {
    if (usedRegions.has(index)) return;
    const horizontalOverlap =
      Math.min(subject[2], region.right) - Math.max(subject[0], region.left);
    if (horizontalOverlap <= 0 || subject[1] + CAPTION_PADDING < region.top) {
      return;
    }
    const distance = subject[1] - region.top;
    if (
      distance > pageHeight * MAX_FOOTNOTE_DISTANCE_RATIO ||
      distance >= closestDistance
    ) {
      return;
    }
    closestDistance = distance;
    closestIndex = index;
  });
  return closestIndex;
}

function findClosestFormulaCaption(
  subject: Rect,
  captions: readonly Caption[],
  usedCaptions: ReadonlySet<number>,
  page: PageLayoutData,
): number | undefined {
  let closestIndex: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  captions.forEach((caption, index) => {
    if (usedCaptions.has(index)) return;
    const subjectHeight = subject[3] - subject[1];
    const captionHeight = caption.top - caption.bottom;
    const centerY = (caption.top + caption.bottom) / 2;
    if (
      centerY < subject[1] - 1 ||
      centerY > subject[3] + 1 ||
      captionHeight > subjectHeight + CAPTION_PADDING ||
      (caption.left <
        subject[2] - Math.min(CAPTION_PADDING, captionHeight / 2) &&
        caption.right >
          subject[0] + Math.min(CAPTION_PADDING, captionHeight / 2))
    )
      return;
    const horizontalGap = Math.max(
      0,
      caption.left - subject[2],
      subject[0] - caption.right,
    );
    const distance =
      Math.abs(centerY - (subject[1] + subject[3]) / 2) +
      horizontalGap / page.width +
      (caption.number ? 0 : subjectHeight);
    if (
      horizontalGap > page.width * MAX_FORMULA_CAPTION_DISTANCE_RATIO ||
      distance >= closestDistance
    )
      return;
    if (horizontalGap > CAPTION_PADDING) {
      const [xMin, yMin] = page.viewBox;
      const gap: Rect =
        caption.left >= subject[2]
          ? [
              subject[2] + xMin + 1,
              caption.bottom + yMin,
              caption.left + xMin - 1,
              caption.top + yMin,
            ]
          : [
              caption.right + xMin + 1,
              caption.bottom + yMin,
              subject[0] + xMin - 1,
              caption.top + yMin,
            ];
      if (
        page.chars.some(
          (char) => char.c.trim() && isCharacterCenteredInRect(char, gap),
        )
      )
        return;
      if (
        page.elements.some((element) => {
          if (
            element.type !== "isolate_formula" &&
            element.type !== "table" &&
            element.type !== "figure"
          )
            return false;
          const rect = toPdfRect(element.xyxy, page.width, page.height);
          return (
            rect[0] + xMin >= gap[0] &&
            rect[2] + xMin <= gap[2] &&
            rect[1] <= centerY &&
            rect[3] >= centerY
          );
        })
      )
        return;
    }
    closestDistance = distance;
    closestIndex = index;
  });
  return closestIndex;
}

function unionRects(first: Rect, second: Caption | Rect): Rect {
  const rect: Rect = Array.isArray(second)
    ? second
    : [second.left, second.bottom, second.right, second.top];
  return [
    Math.min(first[0], rect[0]),
    Math.min(first[1], rect[1]),
    Math.max(first[2], rect[2]),
    Math.max(first[3], rect[3]),
  ];
}

export function isCharacterCenteredInRect(
  char: PdfCharacter,
  rect: Rect,
  padding = 0,
): boolean {
  const [left, bottom, right, top] = rect;
  const centerX = (char.rect[0] + char.rect[2]) / 2;
  const centerY = (char.rect[1] + char.rect[3]) / 2;
  return (
    centerX >= left - padding &&
    centerX <= right + padding &&
    centerY >= bottom - padding &&
    centerY <= top + padding
  );
}

function findClosestCaption(
  subject: Rect,
  captions: readonly Caption[],
  usedCaptions: ReadonlySet<number>,
  subjectType: "figure" | "table",
  pageHeight: number,
): number | undefined {
  let closestIndex: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  captions.forEach((caption, index) => {
    if (usedCaptions.has(index)) return;

    const horizontalOverlap =
      Math.min(subject[2], caption.right) - Math.max(subject[0], caption.left);
    if (horizontalOverlap <= 0) return;

    const distance = getCaptionDistance(subject, caption, subjectType);
    if (
      distance === undefined ||
      Math.abs(distance) > pageHeight * MAX_CAPTION_DISTANCE_RATIO
    ) {
      return;
    }

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function getCaptionDistance(
  subject: Rect,
  caption: Caption,
  subjectType: "figure" | "table",
): number | undefined {
  const [, subjectBottom, , subjectTop] = subject;
  if (subjectType === "figure") {
    if (subjectBottom + CAPTION_PADDING < caption.top) return undefined;
    return subjectBottom - caption.top;
  }

  if (subjectTop - CAPTION_PADDING > caption.bottom) return undefined;
  return caption.bottom - subjectTop;
}

function toPdfRect(normalizedRect: Rect, width: number, height: number): Rect {
  return [
    normalizedRect[0] * width,
    (1 - normalizedRect[3]) * height,
    normalizedRect[2] * width,
    (1 - normalizedRect[1]) * height,
  ];
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
