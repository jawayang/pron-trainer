import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dict as dictionary } from './_dict.mjs';
import { lookup, ipaString, syllabify, findIssues, levelOf } from '../public/phonology.js';

const ipaOf = (w) => ipaString(lookup(dictionary, w).phones);

test('多重發音從 (2) 開始編號，不是 (1)', () => {
  // 套件的 README 寫從 (1) 開始。照著寫的話，8,444 個多重發音的字
  // 會全部只拿到第一種唸法 —— record 的動詞/名詞之分就沒了。
  assert.equal(dictionary['record(1)'], undefined, '不應該存在 (1)');
  assert.ok(dictionary['record(2)'], '應該存在 (2)');

  const record = lookup(dictionary, 'record');
  assert.equal(record.variants.length, 3, 'record 有三種唸法');

  for (const [word, n] of [['lead', 2], ['present', 3], ['read', 2], ['live', 2]]) {
    assert.equal(lookup(dictionary, word).variants.length, n, `${word} 應該有 ${n} 種唸法`);
  }
});

test('切掉資料裡殘留的 # 註解', () => {
  // 例如 "aalborg": "AO1 L B AO0 R G # place, danish"
  // 註解在 build 時就切掉了，這裡確認出貨的資料是乾淨的
  const info = lookup(dictionary, 'aalborg');
  assert.ok(!info.phones.some((p) => /[#,]/.test(p)), `音素裡不該有 # 或逗號：${info.phones}`);
  assert.equal(ipaOf('aalborg'), 'ˈɔl.bɔɹg');
});

test('音節切分只接受英語合法的字首組合', () => {
  // bs / nn 都不是合法的 onset，maximal onset 單獨會切錯
  assert.equal(ipaOf('obsidian'), 'əbˈsɪd.i.ən');       // 不是 ə.bsɪd...
  assert.equal(ipaOf('unnecessary'), 'ənˈnɛs.əˌsɛɹ.i'); // 不是 ə.nnɛs...
  // py 是合法的 onset，所以 computer 切在 kəm | pju
  assert.equal(ipaOf('computer'), 'kəmˈpju.tɚ');
});

test('重音的鬆母音要閉合自己的音節', () => {
  assert.equal(ipaOf('happy'), 'ˈhæp.i');   // 不是 ˈhæ.pi
  assert.equal(ipaOf('city'), 'ˈsɪt.i');
  // 緊母音就不適用，子音歸下一個音節的 onset
  assert.equal(ipaOf('paper'), 'ˈpeɪ.pɚ');
});

test('重音符號本身就是音節分界', () => {
  assert.equal(ipaOf('about'), 'əˈbaʊt');   // 不是 ə.ˈbaʊt
});

test('動詞 record 的音素就是我們要餵給 Azure 的那一串', () => {
  assert.equal(ipaOf('record'), 'ɹəˈkɔɹd');
});

test('難點偵測：中文母語者真的會卡的那些字', () => {
  const check = (w) => findIssues(lookup(dictionary, w).phones, lookup(dictionary, w).variants);
  const text = (w) => check(w).map((i) => i.html.replace(/<[^>]+>/g, '')).join(' / ');

  assert.match(text('months'), /TH/, 'months 要標出 θ');
  assert.match(text('months'), /N TH S/, 'months 要標出字尾三連子音');
  assert.equal(levelOf(check('months')), 2);

  assert.match(text('strength'), /S T R/, 'strength 要標出字首叢集');
  assert.match(text('vision'), /ZH|ʒ/, 'vision 要標出 ʒ');

  // happy 沒有任何中文母語者的典型難點
  assert.equal(levelOf(check('happy')), 0);
});

test('沒有母音的字不會讓切分爆掉', () => {
  for (const w of ['hmm', 'shh', 'mm']) {
    const info = lookup(dictionary, w);
    if (!info) continue;
    assert.ok(syllabify(info.phones).length >= 1, `${w} 應該至少切出一個音節`);
  }
});

test('查不到的字回 null，不是丟例外', () => {
  assert.equal(lookup(dictionary, 'zzzzznotaword'), null);
});
