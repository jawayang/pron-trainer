/**
 * 出貨的字典檔本身的格式驗證。
 *
 * 這份檔案會被頁面直接讀進來、音素會進 DOM，所以它的格式就是一條
 * 安全邊界：只要保證音素只有大寫字母、數字和空格，字典資料就不可能
 * 夾帶任何標記。build script 負責產生，這裡負責把關。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raw, dict, entryCount } from './_dict.mjs';

test('筆數合理', () => {
  assert.ok(entryCount > 130000, `應該有十三萬筆以上，實際 ${entryCount}`);
});

test('每一行都是 word<TAB>PHONES，音素只有大寫字母、數字和空格', () => {
  const bad = [];
  raw.split('\n').forEach((line, i) => {
    if (!line) return;
    const tab = line.indexOf('\t');
    if (tab < 1) { bad.push(`第 ${i + 1} 行沒有 tab：${line.slice(0, 60)}`); return; }
    const phones = line.slice(tab + 1);
    if (!/^[A-Z0-9 ]+$/.test(phones)) bad.push(`第 ${i + 1} 行音素格式不符：${line.slice(0, 60)}`);
  });
  assert.deepEqual(bad.slice(0, 5), [], `共 ${bad.length} 行有問題`);
});

test('沒有殘留的 # 註解', () => {
  assert.ok(!raw.includes('#'), '出貨的字典裡不該有任何 # 註解');
  assert.equal(dict['aalborg'], 'AO1 L B AO0 R G', '註解應該在 build 時就被切掉');
});

test('音素不含任何可能被當成標記的字元', () => {
  // 音素會以 <code>${phone}</code> 的形式進 DOM
  const dangerous = /[<>&"'`]/;
  const hits = Object.entries(dict).filter(([, p]) => dangerous.test(p));
  assert.deepEqual(hits.slice(0, 5), [], `有 ${hits.length} 筆音素含危險字元`);
});

test('多重發音的 key 保留下來了', () => {
  assert.ok(dict['record(2)'], 'record(2) 應該在檔案裡');
  assert.equal(dict['record(1)'], undefined, '不該有 (1)');
});
