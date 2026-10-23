/** 统一 PDF 文字层中的兼容字符和部首字符，便于识别字段和金额位值。 */
export function normalizePdfText(text: string): string {
  // NFKC 可转换“⽇、⾦、⼈、⼗”等康熙部首；以下两个部首需单独转换。
  return text.normalize('NFKC').replace(/⺠/g, '民').replace(/⻆/g, '角');
}
