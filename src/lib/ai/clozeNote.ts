// 克漏字題「因果鏈」規則：只在老師有勾選 cloze 題型時才加進 prompt，
// 讓短文從條列知識點變成有邏輯推導的一段話（南方公園式「但是/因此」因果鏈，
// 禁止「然後」流水帳）。經 baseline vs candidate 實測比較確認能明顯提升
// 克漏字短文的邏輯連貫性，故只套用在此題型；listening 題型不套用——
// 它既有規則要求避開書面語「因此」，實測套用因果鏈會產生「因此啊」這種
// 彆扭混用，跟既有口語化規則打架，效益也不明顯。
export function buildClozeCausalChainNote(selectedTypes: string[]): string {
  if (!selectedTypes.includes('cloze')) {
    return '';
  }
  return `

克漏字題特別注意：
- 【因果鏈】短文裡的敘述要用「但是」「因此」這類因果連接詞串起 2-3 個句子，呈現有邏輯推導的一段話，不要用「然後...然後...」的條列式流水帳講法`;
}
