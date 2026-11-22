/**
 * 把 ECDICT 裁切成瀏覽器載得動的子集：public/ecdict.txt
 *
 * ECDICT 完整版有 77 萬筆、66 MB，不可能整份丟進瀏覽器。但其中絕大多數是
 * 專有名詞、生僻字和各種變體 —— 讀一般英文文章永遠不會遇到。
 *
 * 篩選條件是「這個字值不值得認識」，用 ECDICT 自己的標註來判斷：
 *   frq      當代語料庫詞頻排名（有排名 = 真的有人在用）
 *   bnc      英國國家語料庫詞頻排名
 *   tag      考試大綱標籤（中考/高考/四級/六級/托福/雅思/GRE）
 *   collins  柯林斯星級
 *   oxford   牛津三千核心詞彙
 * 任一條成立就收，結果約 59,000 筆、8.8 MB，gzip 後約 3.6 MB。
 *
 * 不帶 phonetic 欄位 —— 音標用 CMUdict 算出來的美式音，比 ECDICT 的英式音標
 * 更貼近這個工具的用途，而且已經有了。
 *
 * 中文釋義在這裡就轉成繁體（台灣用語），不要丟到瀏覽器端每次載入都轉一遍。
 *
 * 取得原始資料（66 MB，不進 repo）：
 *   git clone --depth 1 https://github.com/skywind3000/ECDICT.git vendor/ECDICT
 * 然後：
 *   npm run build:ecdict
 */
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { Converter } from 'opencc-js';

// ECDICT 的中文是简体；這個工具的介面是繁體，所以 build 時就轉成台灣用語
// （twp 連術語一起換：软件→軟體、计算机→計算機）
const toTW = Converter({ from: 'cn', to: 'twp' });

const SRC = new URL('../vendor/ECDICT/ecdict.csv', import.meta.url);
const OUT = new URL('../public/ecdict.txt', import.meta.url);

if (!existsSync(SRC)) {
  console.error(`找不到 ${SRC.pathname}

先取得原始資料（66 MB，刻意不進 repo）：
  git clone --depth 1 https://github.com/skywind3000/ECDICT.git vendor/ECDICT
`);
  process.exit(1);
}

/** 逐字元解析 CSV 的一行，處理引號內的逗號與換行 */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = await new Promise((resolve, reject) => {
  const chunks = [];
  createReadStream(SRC, 'utf8')
    .on('data', (c) => chunks.push(c))
    .on('end', () => resolve(chunks.join('')))
    .on('error', reject);
});

const rows = parseCSV(text);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

const kept = [];
let total = 0;
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (r.length < header.length) continue;
  total++;
  const get = (k) => (r[idx[k]] ?? '').trim();
  const word = get('word');
  const translation = get('translation');
  if (!word || !translation) continue;
  // 只收常見字、考試字、核心詞彙
  const worth = num(get('frq')) > 0 || num(get('bnc')) > 0
    || get('tag') || get('collins') || get('oxford');
  if (!worth) continue;
  // 一行一筆，欄內的分隔要換掉。注意 CSV 裡的 \n 是「反斜線加 n」兩個字元，
  // 不是真的換行 —— 不處理的話畫面上會直接出現 \n 字樣。
  const flat = (s) => s
    .replace(/\\n/g, '|')      // 字面的 \n
    .replace(/[\t\r\n]/g, ' ')  // 真的 tab / 換行（保險）
    .replace(/\|+/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
  kept.push([
    word,
    toTW(flat(translation)),
    flat(get('definition')),
    get('tag'),
    get('frq') || '0',
    get('exchange'),
  ].join('\t'));
}

const out = kept.join('\n') + '\n';
writeFileSync(OUT, out);

console.log('寫入 public/ecdict.txt');
console.log(`  來源 ${total.toLocaleString()} 筆 → 保留 ${kept.length.toLocaleString()} 筆`);
console.log(`  ${(Buffer.byteLength(out) / 1024 / 1024).toFixed(2)} MB（gzip 後約 3.6 MB，Cloudflare 會自動壓縮）`);
console.log('  欄位：word / translation / definition / tag / frq / exchange');
