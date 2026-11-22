/**
 * 把 npm 的 cmu-pronouncing-dictionary 轉成 public/cmudict.txt。
 *
 * 為什麼不直接從 CDN import：
 *   原本的寫法是 await import('https://cdn.jsdelivr.net/npm/...')，
 *   那會在頁面裡**執行**第三方 JavaScript，權限跟自己的程式碼一樣大 ——
 *   能讀 localStorage（裡面有 API token）、能改畫面、能對外送資料。
 *   套件被挾持或 CDN 被攻破，整個站就沒了。
 *
 *   改成自己託管一份純文字資料檔：JSON.parse / split 不會執行任何東西，
 *   所以這條路徑從「可能執行任意程式碼」變成「最多就是資料有問題」。
 *   附帶好處是同網域、可以上嚴格的 CSP、而且離線也能用。
 *
 * 格式：每行 `word<TAB>PHONES`，比 JSON 省掉引號和逗號。
 * 執行：npm run build:dict
 */
import { writeFileSync } from 'node:fs';
import { dictionary } from 'cmu-pronouncing-dictionary';

const lines = [];
let stripped = 0;
const rejected = [];

for (const [word, phones] of Object.entries(dictionary)) {
  // 這份資料有 22 筆殘留了 CMUdict 的註解，例如
  // "aalborg": "AO1 L B AO0 R G # place, danish"
  const clean = phones.split('#')[0].trim();
  if (clean !== phones.trim()) stripped++;
  if (!clean) continue;
  // 音素只允許大寫字母、數字、空格。頁面會把音素放進 <code> 顯示，
  // 在這裡定死格式，就不可能有任何標記從字典資料跑進 DOM。
  // tab 和換行另外會破壞檔案格式本身。
  if (!/^[A-Z0-9 ]+$/.test(clean)) { rejected.push([word, clean]); continue; }
  if (/[\t\n\r]/.test(word)) { rejected.push([word, clean]); continue; }
  lines.push(`${word}\t${clean}`);
}

const out = lines.join('\n') + '\n';
writeFileSync(new URL('../public/cmudict.txt', import.meta.url), out);

console.log(`寫入 public/cmudict.txt`);
console.log(`  ${lines.length.toLocaleString()} 筆`);
console.log(`  ${(out.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`  清掉 ${stripped} 筆殘留的註解`);
if (rejected.length) {
  console.log(`  格式不合、已排除 ${rejected.length} 筆：`);
  rejected.slice(0, 10).forEach(([w, p]) => console.log(`    ${w} → ${p}`));
}
