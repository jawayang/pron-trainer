/**
 * ECDICT 子集的解析與查詢。
 *
 * 跟 phonology.js 一樣不碰 DOM，所以測試可以直接拿出貨的資料檔驗。
 */

/** ECDICT 的考試標籤代碼 */
export const TAGS = {
  zk: '中考', gk: '高考', ky: '考研',
  cet4: '四級', cet6: '六級',
  toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE',
};

/**
 * exchange 欄位的代碼。p/d/i/3/r/t/s 列出「由這個字衍生出來的形式」，
 * 所以可以反過來建 form → lemma 的索引：month 的 s:months 讓我們知道
 * months 要查 month。
 *
 * 0 和 1 方向相反（0 是「這個字的原形是 X」），建索引時要跳過。
 */
const DERIVED = new Set(['p', 'd', 'i', '3', 'r', 't', 's']);

export function parseEcdict(text) {
  const entries = Object.create(null);
  const lemmaOf = Object.create(null);

  for (const line of text.split('\n')) {
    if (!line) continue;
    const [word, translation, definition, tag, frq, exchange] = line.split('\t');
    if (!word) continue;
    const entry = { translation, definition, tag, frq: parseInt(frq, 10) || 0, lemma: null };
    entries[word] = entry;

    if (!exchange) continue;
    for (const pair of exchange.split('/')) {
      const c = pair.indexOf(':');
      if (c < 1) continue;
      const code = pair.slice(0, c);
      const form = pair.slice(c + 1);
      if (!form) continue;
      if (code === '0') {
        // 「這個字的原形是 X」。best 自己有詞條（v. 勝過），但原形是 good ——
        // 兩邊都值得給使用者看到
        if (form !== word) entry.lemma = form;
      } else if (DERIVED.has(code) && form !== word && !lemmaOf[form]) {
        // 已經是獨立詞條的就不要覆蓋，否則 run 的 d:run 會指向自己繞圈
        lemmaOf[form] = word;
      }
    }
  }
  return { entries, lemmaOf, size: Object.keys(entries).length };
}

/**
 * 查一個字。查不到就試原形：months → month、ran → run、best → good。
 * @returns {null | {word, via, lemma, zh: string[], en: string[], tags: string[], frq: number}}
 *   via   使用者點的變化形（months），查不到才還原時才有值
 *   lemma 這個字自己標註的原形（best → good），兩邊都有詞條時才有值
 */
export function define(db, word) {
  if (!db) return null;
  const w = String(word).toLowerCase();

  let key = w;
  let hit = db.entries[w];
  if (typeof hit !== 'object' || hit === null) hit = null;

  let via = null;
  if (!hit) {
    const lemma = db.lemmaOf[w];
    if (typeof lemma === 'string' && db.entries[lemma]) {
      key = lemma;
      via = w;              // 使用者點的是變化形
      hit = db.entries[lemma];
    }
  }
  if (!hit) return null;

  const lines = (s) => (s || '').split('|').map((x) => x.trim()).filter(Boolean);
  return {
    word: key,
    via,
    lemma: hit.lemma && db.entries[hit.lemma] ? hit.lemma : null,
    zh: lines(hit.translation),
    en: lines(hit.definition),
    tags: (hit.tag || '').split(/\s+/).filter(Boolean),
    frq: hit.frq,
  };
}

/** 詞頻排名換成一句人話 */
export function frequencyNote(frq) {
  if (!frq) return null;
  if (frq <= 1000) return `最常用的 1000 字之內（排名 ${frq}）`;
  if (frq <= 3000) return `常用字，排名 ${frq}`;
  if (frq <= 10000) return `中等常見，排名 ${frq}`;
  return `較少見，排名 ${frq}`;
}
