import * as assert from "node:assert/strict";
import test from "node:test";
import { extractFigureNumber } from "../src/domain/figureNumber";

test("extracts full caption identifiers without reading numbers from body text", () => {
  for (const [text, number] of [
    ["Fig. 1.12. Caption", "1.12"],
    ["Figure 1-2 Caption", "1-2"],
    ["图 2.1 结果", "2.1"],
    ["Table 1–10. Caption", "1–10"],
    ["表2-1 标题", "2-1"],
    ["(1.2)", "1.2"],
    ["（2-1）", "2-1"],
    ["Eq. (1.10)", "1.10"],
    ["式（3.2）", "3.2"],
    ["Figura 2.1: esempio", "2.1"],
    ["Рис. 1-2. Пример", "1-2"],
    ["Figure S12. Supplement", "S12"],
    ["2.1", "2.1"],
    ["Measured at 2 GHz", ""],
    ["2024 measurements", ""],
    ["Figure without a number 42", ""],
    ["", ""],
  ])
    assert.equal(extractFigureNumber(text), number, text);
});
