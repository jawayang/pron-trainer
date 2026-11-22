import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEcdict, define, frequencyNote } from '../public/dictionary.js';

const db = parseEcdict(readFileSync(new URL('../public/ecdict.txt', import.meta.url), 'utf8'));

test('資料檔載得進來，筆數合理', () => {
  assert.ok(db.size > 50000, `應該五萬筆以上，實際 ${db.size}`);
});

test('中文釋義已經是繁體', () => {
  const zh = define(db, 'computer').zh.join(' ');
  assert.match(zh, /電腦|計算機/, `應該是繁體：${zh}`);
  assert.ok(!/电脑|计算机/.test(zh), '不該出現简体');
  assert.match(define(db, 'software').zh.join(' '), /軟體/, 'twp 應該把「软件」轉成台灣用語「軟體」');
});

test('中英釋義都有', () => {
  const m = define(db, 'month');
  assert.ok(m.zh.length >= 1, '要有中文釋義');
  assert.ok(m.en.length >= 1, '要有英文釋義');
  assert.match(m.zh[0], /月/);
});

test('原形還原：變化形查得到', () => {
  // 注意 running 不在這裡 —— 它在 ECDICT 裡是獨立詞條（n. 賽跑），
  // 直接回自己的釋義才是對的行為
  for (const [form, lemma] of [['months', 'month'], ['ran', 'run'],
                               ['believed', 'believe'], ['believes', 'believe']]) {
    const r = define(db, form);
    assert.ok(r, `${form} 應該查得到`);
    assert.equal(r.word, lemma, `${form} 的原形應該是 ${lemma}，實際是 ${r.word}`);
    assert.equal(r.via, form, '要記錄使用者原本點的是哪個形式');
  }
});

test('本來就是原形的字，不會標成變化形', () => {
  const r = define(db, 'month');
  assert.equal(r.via, null);
  assert.equal(r.word, 'month');
});

test('考試標籤解析正確', () => {
  const m = define(db, 'month');
  assert.ok(m.tags.includes('zk'), `month 應該有中考標籤，實際 ${m.tags}`);
});

test('沒有欄位分隔字元殘留在釋義裡', () => {
  for (const w of ['good', 'run', 'month', 'computer']) {
    const r = define(db, w);
    for (const line of [...r.zh, ...r.en]) {
      assert.ok(!line.includes('|'), `${w} 的釋義不該含 |：${line}`);
      assert.ok(!line.includes('\\n'), `${w} 的釋義不該含字面的 \\n：${line}`);
      assert.ok(!line.includes('\t'), `${w} 的釋義不該含 tab`);
    }
  }
});

test('查不到的字回 null，原型鏈攻擊也擋得住', () => {
  assert.equal(define(db, 'zzzznotaword'), null);
  assert.equal(define(db, '__proto__'), null, '__proto__ 不是單字，不該回傳原型物件');
  assert.equal(define(db, 'hasOwnProperty'), null, '不該回傳原型上的函式');
  assert.equal(define(db, 'toString'), null);
  assert.equal(define(null, 'month'), null);
  // constructor 是真的英文單字（承包商、建造者），應該查得到 —— 這正好證明
  // Object.create(null) 有效：查得到是因為它真的在資料裡，不是從原型鏈來的
  const c = define(db, 'constructor');
  assert.ok(c && c.zh.length, 'constructor 是真單字，應該有釋義');
});

test('自己有詞條、但也標了原形的字，兩邊都給', () => {
  // best 自己是動詞（勝過），但形容詞用法的原形是 good
  const b = define(db, 'best');
  assert.equal(b.word, 'best', '有自己的詞條就回自己的');
  assert.equal(b.via, null);
  assert.equal(b.lemma, 'good', '同時要標出原形是 good');
  assert.equal(define(db, 'month').lemma, null, '本來就是原形的字沒有 lemma');
});

test('running 有自己的詞條，不會被還原成 run', () => {
  const r = define(db, 'running');
  assert.equal(r.word, 'running');
  assert.equal(r.via, null);
  assert.ok(r.zh.length, '應該有自己的中文釋義');
});

test('原形索引不會自己指向自己（run 的 d:run）', () => {
  assert.notEqual(db.lemmaOf['run'], 'run');
});

test('詞頻說明', () => {
  assert.match(frequencyNote(236), /1000 字之內/);
  assert.equal(frequencyNote(0), null);
  assert.match(frequencyNote(50000), /較少見/);
});
