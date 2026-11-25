import * as assert from "node:assert/strict";
import test from "node:test";
import { isInlineFormulaSelection } from "../src/domain/inlineFormula";
import type { PdfCharacter, Rect } from "../src/domain/layout";

function inSentence(text: string, styled = false) {
  const chars: PdfCharacter[] = [{ c: "where ", rect: [0, 20, 17, 30] }];
  let left = 20;
  for (const c of text) {
    chars.push({ c, rect: [left, 20, left + 5, 30], mathStyle: styled });
    left += 5;
  }
  const rect: Rect = [18, 18, left + 1, 32];
  return { chars, rect };
}

test("ordinary inline selections use mathematical evidence in the surrounding text line", () => {
  for (const text of [
    "ΔP",
    "x²",
    "f(x)",
    "x < y",
    "p < 0.05",
    "log(x)",
    "a/b",
    "x₀",
  ]) {
    const { chars, rect } = inSentence(text);
    assert.ok(isInlineFormulaSelection(chars, rect), text);
  }
  const { chars, rect } = inSentence("k", true);
  assert.ok(isInlineFormulaSelection(chars, rect));
  assert.equal(isInlineFormulaSelection(chars.slice(1), rect), false);
});

test("ordinary text, references, numeric labels and large graphic regions do not trigger inline recognition", () => {
  for (const text of [
    "(7)",
    "2020-2021",
    "Fig. 2",
    "Yu et al., 2024",
    "stress = high",
    "M0 is defined",
    "ΔP 变化",
  ]) {
    const { chars, rect } = inSentence(text);
    assert.equal(isInlineFormulaSelection(chars, rect), false, text);
  }
  const { chars } = inSentence("M=VΔτ");
  assert.equal(isInlineFormulaSelection(chars, [18, 10, 210, 110]), false);
  const wide = [
    ...inSentence("AIC=2k").chars,
    { c: "(6)", rect: [158, 20, 170, 30] as Rect },
    { c: "margin", rect: [176, 20, 212, 30] as Rect },
  ];
  assert.equal(isInlineFormulaSelection(wide, [18, 18, 171, 32]), false);
});
