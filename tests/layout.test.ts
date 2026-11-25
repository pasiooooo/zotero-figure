import * as assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnnotationCandidates,
  charsToText,
  pageMayContainFigures,
  type PageLayoutData,
  type PdfCharacter,
} from "../src/domain/layout";

test("manual region recognition accepts small figures and tables without captions", () => {
  const page = createPage({
    elements: [
      { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.12, 0.15] },
      { score: 0.9, type: "table", xyxy: [0.6, 0.6, 0.9, 0.9] },
    ],
  });
  assert.deepEqual(buildAnnotationCandidates(page), []);
  assert.deepEqual(
    buildAnnotationCandidates(page, true).map(({ tag, comment }) => ({
      tag,
      comment,
    })),
    [
      { tag: "Figure", comment: "" },
      { tag: "Table", comment: "" },
    ],
  );
});

test("reconstructs page text without inserting a space after a hyphen", () => {
  const chars: PdfCharacter[] = [
    character("multi-", [0, 0, 10, 10], true),
    character("column", [10, 0, 20, 10], true),
    character("Figure 1", [20, 0, 30, 10]),
  ];
  assert.equal(charsToText(chars), "multi-column Figure 1");
  assert.equal(pageMayContainFigures(chars), true);
  assert.equal(pageMayContainFigures([character("plain text")]), false);
});

test("page hints use complete multilingual terms instead of substrings", () => {
  for (const text of [
    "Fig. 2 Results",
    "Tabella 3",
    "Рис. 4",
    "Таблица 5",
    "结果见下图",
    "表 6 数据",
    "Equation 7",
    "公式 8",
    "x = y + 1",
  ]) {
    assert.equal(pageMayContainFigures([character(text)]), true, text);
  }
  for (const text of [
    "configuration is suitable",
    "comfortable reading",
    "这表示结果可靠",
    "普通正文",
  ]) {
    assert.equal(pageMayContainFigures([character(text)]), false, text);
  }
  assert.equal(pageMayContainFigures([]), true);
});

test("matches a figure with its caption and applies both view-box offsets", () => {
  const page = createPage({
    chars: [character("Figure 12. Result", [120, 425, 400, 475])],
    elements: [
      { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.5, 0.5] },
      {
        score: 0.9,
        type: "figure_caption",
        xyxy: [0.1, 0.52, 0.5, 0.58],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page), [
    {
      comment: "Figure 12. Result",
      pageIndex: 2,
      rect: [110, 520, 510, 920],
      tag: "Figure 12",
    },
  ]);
});

test("retains complete figure, table and formula numbers in detected tags", () => {
  for (const number of ["1.2", "1-10", "2.1"]) {
    const figure = createPage({
      chars: [character(`Fig. ${number}. Result`, [120, 425, 400, 475])],
      elements: [
        { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.5, 0.5] },
        { score: 0.9, type: "figure_caption", xyxy: [0.1, 0.52, 0.5, 0.58] },
      ],
    });
    assert.equal(buildAnnotationCandidates(figure)[0].tag, `Figure ${number}`);
    const table = createPage({
      chars: [character(`Table ${number}. Result`, [120, 825, 400, 875])],
      elements: [
        { score: 0.9, type: "table", xyxy: [0.1, 0.3, 0.5, 0.8] },
        { score: 0.9, type: "table_caption", xyxy: [0.1, 0.12, 0.5, 0.18] },
      ],
    });
    assert.equal(buildAnnotationCandidates(table)[0].tag, `Table ${number}`);
    const formula = createPage({
      chars: [character(`(${number})`, [805, 525, 855, 575])],
      elements: [
        { score: 0.9, type: "isolate_formula", xyxy: [0.2, 0.4, 0.75, 0.5] },
        { score: 0.9, type: "formula_caption", xyxy: [0.8, 0.42, 0.86, 0.48] },
      ],
    });
    assert.equal(
      buildAnnotationCandidates(formula)[0].tag,
      `Formula ${number}`,
    );
  }
});

test("reads captions in absolute PDF coordinates on an offset CropBox", () => {
  const page = createPage({
    width: 100,
    height: 100,
    viewBox: [200, 300, 300, 400],
    chars: [
      character("Figure 7. Correct", [218, 308, 260, 310]),
      character("Wrong text", [18, 8, 60, 10]),
    ],
    elements: [
      { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.9, 0.8] },
      { score: 0.9, type: "figure_caption", xyxy: [0.1, 0.82, 0.9, 0.95] },
    ],
  });
  assert.deepEqual(buildAnnotationCandidates(page), [
    {
      comment: "Figure 7. Correct",
      tag: "Figure 7",
      pageIndex: 2,
      rect: [210, 320, 290, 390],
    },
  ]);
});

test("matches table captions above the table", () => {
  const page = createPage({
    chars: [character("Table 3", [580, 725, 850, 795])],
    elements: [
      { score: 0.8, type: "table", xyxy: [0.55, 0.3, 0.9, 0.7] },
      {
        score: 0.8,
        type: "table_caption",
        xyxy: [0.55, 0.2, 0.9, 0.28],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page)[0], {
    comment: "Table 3",
    pageIndex: 2,
    rect: [560, 320, 910, 720],
    tag: "Table 3",
  });
});

test("includes the nearest table footnote in its text and crop", () => {
  const page = createPage({
    chars: [
      character("Table 4. Values", [110, 730, 700, 790]),
      character("* p < 0.05", [110, 225, 700, 275]),
    ],
    elements: [
      { score: 0.9, type: "table", xyxy: [0.1, 0.3, 0.9, 0.7] },
      {
        score: 0.9,
        type: "table_caption",
        xyxy: [0.1, 0.2, 0.9, 0.28],
      },
      {
        score: 0.85,
        type: "table_footnote",
        xyxy: [0.1, 0.72, 0.9, 0.78],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page)[0], {
    comment: "Table 4. Values\n\n* p < 0.05",
    pageIndex: 2,
    rect: [110, 240, 910, 720],
    tag: "Table 4",
  });
});

test("keeps formula numbers as metadata while cropping only formula bodies", () => {
  const page = createPage({
    chars: [character("(7)", [805, 525, 855, 575])],
    elements: [
      {
        score: 0.9,
        type: "isolate_formula",
        xyxy: [0.2, 0.4, 0.75, 0.5],
      },
      {
        score: 0.8,
        type: "formula_caption",
        xyxy: [0.8, 0.42, 0.86, 0.48],
      },
      {
        score: 0.85,
        type: "isolate_formula",
        xyxy: [0.25, 0.65, 0.7, 0.72],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page), [
    {
      comment: "(7)",
      pageIndex: 2,
      rect: [210, 520, 760, 620],
      tag: "Formula 7",
    },
    {
      comment: "",
      pageIndex: 2,
      rect: [260, 300, 710, 370],
      tag: "Formula",
    },
  ]);
});

test("recovers equation numbers misclassified as figures or figure captions without creating number images", () => {
  for (const type of ["figure", "figure_caption"]) {
    for (const [text, number] of [
      ["(7)", "7"],
      ["（2.1）", "2.1"],
      ["1-10", "1-10"],
      ["(S3a)", "S3a"],
    ]) {
      const page = createPage({
        chars: [character(text, [815, 545, 855, 585])],
        elements: [
          { score: 0.9, type: "isolate_formula", xyxy: [0.2, 0.4, 0.75, 0.5] },
          { score: 0.9, type, xyxy: [0.8, 0.42, 0.86, 0.48] },
        ],
      });
      assert.deepEqual(buildAnnotationCandidates(page, true), [
        {
          comment: text,
          pageIndex: 2,
          rect: [210, 520, 760, 620],
          tag: `Formula ${number}`,
        },
      ]);
    }
  }
});

test("does not emit a number image when its box also has a formula-caption detection", () => {
  const page = createPage({
    chars: [character("(7)", [815, 545, 855, 585])],
    elements: [
      { score: 0.9, type: "isolate_formula", xyxy: [0.2, 0.4, 0.75, 0.5] },
      { score: 0.9, type: "figure", xyxy: [0.8, 0.42, 0.86, 0.48] },
      { score: 0.9, type: "formula_caption", xyxy: [0.79, 0.41, 0.87, 0.49] },
    ],
  });
  assert.deepEqual(buildAnnotationCandidates(page, true), [
    {
      comment: "(7)",
      pageIndex: 2,
      rect: [210, 520, 760, 620],
      tag: "Formula 7",
    },
  ]);
});

test("does not reuse duplicate equation-number detections for a second formula", () => {
  const page = createPage({
    chars: [character("(7)", [815, 545, 855, 585])],
    elements: [
      { score: 0.9, type: "isolate_formula", xyxy: [0.2, 0.4, 0.75, 0.5] },
      { score: 0.9, type: "isolate_formula", xyxy: [0.2, 0.52, 0.75, 0.62] },
      { score: 0.9, type: "figure", xyxy: [0.8, 0.42, 0.86, 0.48] },
      { score: 0.9, type: "figure_caption", xyxy: [0.8, 0.42, 0.86, 0.48] },
      { score: 0.9, type: "formula_caption", xyxy: [0.79, 0.41, 0.87, 0.49] },
    ],
  });
  const candidates = buildAnnotationCandidates(page, true);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].tag, "Formula 7");
  assert.equal(candidates[1].tag, "Formula");
  assert.equal(candidates[1].comment, "");
});

test("recovers a distant standalone printed number on the same row without crossing intervening text", () => {
  const page = createPage({
    chars: [
      {
        c: "AIC = 2k − 2LLK",
        rect: [462, 530, 576, 545],
        lineBreakAfter: true,
      },
      { c: "(", rect: [910, 530, 914, 545] },
      { c: "6", rect: [914, 530, 920, 545] },
      { c: ")", rect: [920, 530, 924, 545], lineBreakAfter: true },
    ],
    elements: [
      { score: 0.9, type: "isolate_formula", xyxy: [0.45, 0.47, 0.57, 0.5] },
    ],
  });
  assert.deepEqual(
    buildAnnotationCandidates(page).map((candidate) => [
      candidate.tag,
      candidate.comment,
    ]),
    [["Formula 6", "(6)"]],
  );
  page.chars.splice(1, 0, {
    c: "other column",
    rect: [676, 530, 763, 545],
    lineBreakAfter: true,
  });
  assert.equal(buildAnnotationCandidates(page)[0].tag, "Formula");
  page.chars.splice(1, 1);
  page.elements.push({
    score: 0.9,
    type: "figure",
    xyxy: [0.65, 0.46, 0.72, 0.5],
  });
  assert.equal(buildAnnotationCandidates(page).at(-1)?.tag, "Formula");
});

test("keeps both parentheses from the text line when the model label clips the last character", () => {
  const page = createPage({
    chars: [
      { c: "A=B", rect: [460, 530, 576, 545], lineBreakAfter: true },
      { c: "(", rect: [910, 530, 914, 545] },
      { c: "5", rect: [914, 530, 920, 545] },
      { c: ")", rect: [920, 530, 925, 545], lineBreakAfter: true },
    ],
    elements: [
      { score: 0.9, type: "isolate_formula", xyxy: [0.45, 0.47, 0.57, 0.5] },
      {
        score: 0.9,
        type: "formula_caption",
        xyxy: [0.899, 0.474, 0.909, 0.491],
      },
    ],
  });
  const [formula] = buildAnnotationCandidates(page);
  assert.equal(formula.comment, "(5)");
  assert.equal(formula.tag, "Formula 5");
});

test("keeps numerical figures inside a formula, in another row or larger than a number label", () => {
  for (const [xyxy, textRect] of [
    [
      [0.3, 0.43, 0.36, 0.48],
      [315, 545, 355, 575],
    ],
    [
      [0.8, 0.7, 0.86, 0.76],
      [815, 265, 855, 305],
    ],
    [
      [0.8, 0.3, 0.98, 0.7],
      [815, 445, 855, 485],
    ],
  ] as Array<[PdfCharacter["rect"], PdfCharacter["rect"]]>) {
    const page = createPage({
      chars: [character("(7)", textRect)],
      elements: [
        { score: 0.9, type: "isolate_formula", xyxy: [0.2, 0.4, 0.75, 0.5] },
        { score: 0.9, type: "figure", xyxy },
      ],
    });
    const candidates = buildAnnotationCandidates(page, true);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].tag, "Figure");
    assert.equal(candidates[1].tag, "Formula");
    assert.equal(candidates[1].comment, "");
  }
});

test("does not reuse one caption for multiple detected subjects", () => {
  const page = createPage({
    chars: [character("Figure 1", [100, 425, 500, 475])],
    elements: [
      { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.3, 0.5] },
      { score: 0.8, type: "figure", xyxy: [0.3, 0.1, 0.5, 0.5] },
      {
        score: 0.9,
        type: "figure_caption",
        xyxy: [0.1, 0.52, 0.5, 0.58],
      },
    ],
  });
  assert.equal(buildAnnotationCandidates(page).length, 1);
});

function createPage(overrides: Partial<PageLayoutData> = {}): PageLayoutData {
  return {
    chars: [],
    elements: [],
    height: 1_000,
    pageIndex: 2,
    viewBox: [10, 20, 1_010, 1_020],
    width: 1_000,
    ...overrides,
  };
}

function character(
  c: string,
  rect: PdfCharacter["rect"] = [0, 0, 1, 1],
  spaceAfter = false,
): PdfCharacter {
  return { c, rect, spaceAfter };
}
