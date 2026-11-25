import {
  charsToText,
  isCharacterCenteredInRect,
  type PdfCharacter,
  type Rect,
} from "./layout";

const MATH_MARK = /[=+<>×÷±−≈≠≤≥∝∈∑∫∏∇∂√∞∆Α-Ωα-ωϕϑϵℏℓ¹²³⁰-⁹₀-₉^_]/;
const MATH_FUNCTION =
  /^(?:abs|arg|sin[h]?|cos[h]?|tan[h]?|cot|sec|csc|exp|log|lim|erfc?|det|diag|max|min|sup|inf|mod|var|cov)$/i;

export function isInlineFormulaSelection(
  chars: readonly PdfCharacter[],
  region: Rect,
): boolean {
  const selected = chars.filter((char) =>
    isCharacterCenteredInRect(char, region),
  );
  const glyphs = selected.filter((char) => char.c.trim());
  if (!glyphs.length || glyphs.length > 160) return false;
  const text = charsToText(selected).trim();
  if (
    !/[a-zΑ-ω0-9∂∇∑∫√]/i.test(text) ||
    /[\u3400-\u9fff\u0400-\u052f]/.test(text)
  )
    return false;
  if (!/[a-zΑ-ω]/i.test(text) && !/[=+×÷±≈≠≤≥∑∫√]/.test(text)) return false;
  const words = text.match(/[a-z]{3,}/gi) ?? [];
  if (
    words.some(
      (word) => !MATH_FUNCTION.test(word) && !/^[A-Z]{2,5}$/.test(word),
    )
  )
    return false;

  const left = Math.min(...glyphs.map(({ rect }) => rect[0]));
  const right = Math.max(...glyphs.map(({ rect }) => rect[2]));
  const bottom = Math.min(...glyphs.map(({ rect }) => rect[1]));
  const top = Math.max(...glyphs.map(({ rect }) => rect[3]));
  const heights = glyphs
    .map(({ rect }) => rect[3] - rect[1])
    .sort((a, b) => a - b);
  const em = heights[Math.floor(heights.length / 2)];
  if (
    em <= 0 ||
    region[3] - region[1] > 3.5 * em ||
    region[2] - region[0] > right - left + 3 * em
  )
    return false;
  let previousRight = left;
  for (const glyph of [...glyphs].sort(
    (first, second) => first.rect[0] - second.rect[0],
  )) {
    if (glyph.rect[0] - previousRight > 2.5 * em) return false;
    previousRight = Math.max(previousRight, glyph.rect[2]);
  }

  const hasScript = glyphs.some(
    ({ c, rect }) =>
      /^[\da-z]$/i.test(c) &&
      rect[3] - rect[1] < 0.83 * heights[heights.length - 1] &&
      (rect[1] < bottom + em * 0.2 || rect[3] > top - em * 0.2),
  );
  const compact = text.replace(/\s/g, "");
  const arithmetic = /[\da-z)][*/-][a-z(\d]/i.test(compact);
  const functionCall =
    /^(?:[a-z]|sin|cos|tan|log|exp|erfc?)\([a-z\d,]+\)[.,;]?$/i.test(compact);
  const styledVariable =
    glyphs.length <= 2 &&
    glyphs.every((glyph) => glyph.mathStyle && /^[a-z]$/i.test(glyph.c));
  if (
    !MATH_MARK.test(text) &&
    !arithmetic &&
    !functionCall &&
    !(hasScript && /[a-z]/i.test(text)) &&
    !styledVariable
  )
    return false;

  const center = (top + bottom) / 2;
  const hasProse = (from: number, to: number) => {
    const nearby = charsToText(
      chars.filter((char) =>
        isCharacterCenteredInRect(char, [
          from,
          center - em * 0.6,
          to,
          center + em * 0.6,
        ]),
      ),
    );
    return /[a-zа-яё]{2,}|[\u3400-\u9fff]/i.test(nearby);
  };
  return (
    hasProse(left - 6 * em, left - 0.1) || hasProse(right + 0.1, right + 6 * em)
  );
}
