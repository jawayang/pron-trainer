/**
 * 載入實際會出貨的那份字典（public/cmudict.txt），而不是 npm 套件。
 * 測試要驗的是使用者真正拿到的東西 —— build script 若哪天壞了，
 * 從套件讀的測試會全部通過，但線上是壞的。
 */
import { readFileSync } from 'node:fs';

export const raw = readFileSync(new URL('../public/cmudict.txt', import.meta.url), 'utf8');

export const dict = (() => {
  const d = Object.create(null);
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    d[line.slice(0, tab)] = line.slice(tab + 1);
  }
  return d;
})();

export const entryCount = Object.keys(dict).length;
