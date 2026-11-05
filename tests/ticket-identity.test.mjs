import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractTicketIdentity } from '../split-print/src/ticket-identity.ts';

const packageNumber = '540233100091220261030101623914';
const items = lines => lines.map((str, i) => ({ str, transform: [1, 0, 0, 1, 10, 500 - i * 15] }));
const identity = lines => extractTicketIdentity(items(lines));
const packageLine = `票据号码: ${packageNumber}`;

test('同包不同子票分组，兼容标签、位置、分隔符和前导零', () => {
  const expectedKey = `${packageNumber}|1-123456`;
  assert.equal(identity([packageLine, '1 - 123456']).key, expectedKey);
  for (const label of ['子票区间', '子票据区间', '子票据号码', '子票号']) {
    for (const separator of ['-', '—', '至']) {
      const range = `${label}：000000000001${separator}000000123456`;
      for (const lines of [[`${packageLine} ${range}`], [packageLine, range], [packageLine, '汇票金额', '出票日期', range]]) {
        const result = identity(lines);
        assert.equal(result.key, expectedKey);
        assert.equal(result.hasSubTicket, true);
      }
    }
  }
  assert.notEqual(identity([packageLine, '子票区间: 123457-234567']).key, expectedKey);
});

test('只有包号时明确标记，续页不伪造票号，不截断超长区间', () => {
  for (const lines of [[packageLine], [packageLine, '子票区间: 1-1234567890123'], [packageLine, '子票区间: 1234567890123-2']]) {
    assert.deepEqual(identity(lines), { key: packageNumber, label: packageNumber, hasSubTicket: false });
  }
  assert.equal(identity(['转让背书']), null);
  assert.equal(identity([`Ticket No.: ${packageNumber}`]).hasSubTicket, false);
});

test('坐标重建乱序文本行，兼容无坐标文本', () => {
  const content = items([packageLine, '子票区间: 1-123456']);
  assert.equal(extractTicketIdentity(content.reverse()).key, `${packageNumber}|1-123456`);
  assert.equal(extractTicketIdentity([{ str: `${packageLine} 子票号: 1-123456` }]).hasSubTicket, true);
});

// 可选真实样本：JSON 数组，每项含 path、groups、blanks、outputPages。
// 路径仅从环境变量读取，不把业务 PDF 存入仓库。
const samples = JSON.parse(process.env.PDF_REGRESSION_SAMPLES || '[]');
test('真实汇票 PDF 分组及输出页数回归', { skip: samples.length === 0 }, async t => {
  for (const sample of samples) {
    await t.test(basename(sample.path), async () => {
      const bytes = await readFile(sample.path);
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      try {
        const pdf = await task.promise;
        const groups = [];
        let current;
        for (let i = 1; i <= pdf.numPages; i++) {
          const content = await (await pdf.getPage(i)).getTextContent();
          const ticket = extractTicketIdentity(content.items);
          if (ticket && (!current || current.key !== ticket.key)) {
            current = { ...ticket, pages: 1 };
            groups.push(current);
          } else if (current) current.pages++;
          else assert.fail(`第 ${i} 页无可识别票号`);
        }
        const blanks = groups.filter(group => group.pages % 2).length;
        assert.equal(groups.length, sample.groups);
        assert.equal(blanks, sample.blanks);
        assert.equal(pdf.numPages + blanks, sample.outputPages);
        if (sample.packageOnlyGroups !== undefined) {
          assert.equal(groups.filter(group => !group.hasSubTicket).length, sample.packageOnlyGroups);
        }
      } finally {
        await task.destroy();
      }
    });
  }
});
