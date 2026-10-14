/** Read a caption label, without treating numbers in its body as an index. */
export function extractFigureNumber(text: string): string {
  const label = text
    .trim()
    .match(
      /^(?:(?:fig(?:ure|ura)?s?\.?|tab(?:le|ella)?s?\.?|eq(?:uation)?s?\.?|formula|рис(?:унок)?\.?|табл(?:ица)?\.?|формула|图|圖|表|公式|式)\s*[:：]?\s*[（(]?\s*([A-Z]?\d+(?:[.\-‐‑–—]\d+)*[a-z]?)|[（(]?\s*([A-Z]?\d+(?:[.\-‐‑–—]\d+)*[a-z]?)\s*[）)]?$)/i,
    );
  return label?.[1] ?? label?.[2] ?? "";
}
