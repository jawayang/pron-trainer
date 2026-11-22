/**
 * 整本字典掃一遍，確認產生出來的每一個 IPA 字元 Azure 都收。
 *
 * 為什麼值得花這個時間：ARPAbet 的 G 一開始被我對應成 ɡ（U+0261，音標學
 * 常用的那個 script g），而 Azure 的 en-US 集合只收 g（U+0067）。兩個字元
 * 在畫面上看不出任何差別，但 Azure 遇到無法識別的音素時會「拒絕整份 SSML
 * 文件」而不是忽略那一個音 —— 結果是完全沒有聲音，回 400。
 *
 * 影響 13,693 個字。肉眼審查永遠抓不到，所以做成回歸測試。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dict as dictionary } from './_dict.mjs';
import { ipaString, lookup, AZURE_OK, azureSafe } from '../public/phonology.js';

test('整本 CMUdict 產生的音素，Azure 全部收得下', () => {
  const bad = new Map();
  let n = 0;

  for (const word of Object.keys(dictionary)) {
    const info = lookup(dictionary, word.replace(/\(\d+\)$/, ''));
    if (!info) continue;
    const ipa = ipaString(info.phones);
    n++;
    for (const ch of ipa) {
      if (!AZURE_OK.has(ch)) {
        if (!bad.has(ch)) bad.set(ch, { count: 0, example: `${word} → /${ipa}/` });
        bad.get(ch).count++;
      }
    }
  }

  assert.ok(n > 100000, `應該掃到十萬筆以上，實際 ${n}`);

  const report = [...bad].map(([ch, v]) =>
    `  "${ch}" U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` +
    ` — ${v.count} 筆，例如 ${v.example}`).join('\n');
  assert.equal(bad.size, 0, `有 Azure 不收的音素：\n${report}`);
});

test('G 必須是 ASCII 的 g，不是 ɡ', () => {
  const ipa = ipaString(lookup(dictionary, 'good').phones);
  assert.ok(ipa.includes('g'), `good 的音素裡應該有 U+0067，實際是 /${ipa}/`);
  assert.ok(!ipa.includes('ɡ'), `good 的音素裡不該出現 U+0261（Azure 會拒絕整份 SSML）`);
});

test('azureSafe 擋得掉不合法的音素', () => {
  assert.equal(azureSafe('ɹəˈkɔɹd'), true);
  assert.equal(azureSafe('ɹəˈkɔɹɡd'), false, 'script g 應該被擋下來');
  assert.equal(azureSafe('ɹəˈkɔɹd#place,danish'), false, '註解殘留應該被擋下來');
});
