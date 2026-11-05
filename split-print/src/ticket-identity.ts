export type TicketIdentity = { key: string; label: string; hasSubTicket: boolean };
export type PdfTextItem = { str?: string; transform?: number[] };

function buildTextLines(items: PdfTextItem[]): string[] {
  const positioned = items
    .map((item, index) => ({ text: item.str || '', index, x: item.transform?.[4], y: item.transform?.[5] }))
    .filter(item => item.text);
  if (!positioned.length) return [];
  if (!positioned.every(item => typeof item.x === 'number' && typeof item.y === 'number')) {
    return [positioned.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()];
  }

  const rows: Array<{ y: number; items: typeof positioned }> = [];
  for (const item of positioned) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y!) <= 2);
    if (row) row.items.push(item);
    else rows.push({ y: item.y!, items: [item] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => row.items
      .sort((a, b) => (a.x! - b.x!) || (a.index - b.index))
      .map(item => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim());
}

export function extractTicketIdentity(items: PdfTextItem[]): TicketIdentity | null {
  const lines = buildTextLines(items);
  for (let i = 0; i < lines.length; i++) {
    const compactLine = lines[i].replace(/\s/g, '');
    const labelIndex = compactLine.indexOf('票据号码');
    if (labelIndex < 0) continue;
    const packageNumber = compactLine.slice(labelIndex + '票据号码'.length).match(/\d{16,30}/)?.[0];
    if (!packageNumber) continue;

    // 兼容包号同一行或紧邻下方的“子票区间: 起-止”，以及不带标签的独立区间行。
    const candidates = [compactLine, ...lines.slice(i + 1, i + 4).map(line => line.replace(/\s/g, ''))];
    let subTicketNumber = '';
    for (const line of candidates) {
      const range = line.match(/子票(?:据)?(?:区间|号码|号)?[:：]?(\d{1,12})[-—至](\d{1,12})(?!\d)/)
        || line.match(/^(\d{1,12})[-—至](\d{1,12})$/);
      if (!range) continue;
      // 区间号的前导零不影响票据身份，避免首页和续页补零格式不同而被拆组。
      subTicketNumber = `${range[1].replace(/^0+(?=\d)/, '')}-${range[2].replace(/^0+(?=\d)/, '')}`;
      break;
    }
    return {
      hasSubTicket: Boolean(subTicketNumber),
      key: subTicketNumber ? `${packageNumber}|${subTicketNumber}` : packageNumber,
      label: subTicketNumber ? `${packageNumber} / ${subTicketNumber}` : packageNumber,
    };
  }

  const joined = items.map(x => x.str || '').join(' ');
  const labeled = joined.match(/(?:No\.?|Ticket\s*No\.?)\s*[.:：]?\s*(\d[\d\s]{14,}\d)/i);
  if (!labeled) return null;
  const packageNumber = labeled[1].replace(/\s/g, '');
  return packageNumber.length <= 30 ? { key: packageNumber, label: packageNumber, hasSubTicket: false } : null;
}
