/**
 * UI：斷詞、標色、詳細面板、發音、不熟清單。
 * 純邏輯（音素轉換、音節切分、難點規則）都在 phonology.js，
 * 這樣 test/ 可以在沒有瀏覽器的情況下直接驗證。
 */
import {
  VOWELS, bare, stressOf, toIPA, syllabify, ipaString,
  lookup as lookupIn, RULES, defaultRules, findIssues, azureSafe,
} from './phonology.js';

/** 哪些難點規則目前開著 */
const on = defaultRules();

/* ---------------------------------------------------------------
   4. 字典
   --------------------------------------------------------------- */
let DICT = null;
const statusEl = document.getElementById('status');

/**
 * 字典是自己託管的純文字資料檔，不是從 CDN import 的 JS 模組。
 * 差別在於：資料檔不會被「執行」—— 就算檔案被動過手腳，最糟也只是
 * 音標錯掉，不會變成在頁面裡跑別人的程式碼（那等於交出 localStorage
 * 裡的 token 和整個 DOM）。
 */
(async () => {
  try {
    const res = await fetch('./cmudict.txt');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // Object.create(null) 而不是 {}：字典裡若出現 __proto__ 或 constructor
    // 這類字，用一般物件查詢會拿到原型鏈上的東西而不是 undefined
    const dict = Object.create(null);
    let n = 0;
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 1) continue;
      dict[line.slice(0, tab)] = line.slice(tab + 1);
      n++;
    }
    DICT = dict;
    statusEl.textContent = `CMUdict ${n.toLocaleString()} 筆已載入`;
    if (tokens.length) render();
  } catch (e) {
    statusEl.textContent = '字典載入失敗 — 仍可點字聽發音與查音標';
    statusEl.className = 'err';
    console.warn('CMUdict load failed:', e);
  }
})();

const lookup = (word) => (DICT ? lookupIn(DICT, word) : null);

/* ---------------------------------------------------------------
   5. 已標記（localStorage）
   --------------------------------------------------------------- */
const KEY = 'pron-marked-v1';
let marked = new Set();
try { marked = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch {}
function saveMarked() {
  try { localStorage.setItem(KEY, JSON.stringify([...marked])); } catch {}
}

/* ---------------------------------------------------------------
   6. 斷詞與渲染
   --------------------------------------------------------------- */
let tokens = [];          // { text, isWord, at }
let selected = null;
let rawText = '';

function tokenize(text) {
  rawText = text;
  const out = [];
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), isWord: false });
    out.push({ text: m[0], isWord: true, at: m.index });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isWord: false });
  return out;
}

const cache = new Map();   // lowercase word -> { lv, issues, info }
function analyze(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const info = lookup(word);
  let res;
  if (!info) {
    res = { lv: 0, issues: [], info: null, oov: true };
  } else {
    const issues = findIssues(info.phones, info.variants, on);
    res = { lv: issues.reduce((a, b) => Math.max(a, b.lv), 0), issues, info, oov: false };
  }
  cache.set(key, res);
  return res;
}

const readingEl = document.getElementById('reading');
const statsEl = document.getElementById('stats');

function render() {
  cache.clear();
  const onlyHard = document.getElementById('only-hard').checked;
  const onlyMarked = document.getElementById('only-marked').checked;

  const frag = document.createDocumentFragment();
  let nWord = 0, hard = 0, warn = 0, oov = 0;
  const seen = new Set();

  for (const t of tokens) {
    if (!t.isWord) { frag.appendChild(document.createTextNode(t.text)); continue; }
    nWord++;
    const key = t.text.toLowerCase();
    const a = analyze(t.text);
    if (!seen.has(key)) {
      seen.add(key);
      if (a.oov) oov++; else if (a.lv === 2) hard++; else if (a.lv === 1) warn++;
    }

    const span = document.createElement('span');
    span.className = 'w';
    span.dataset.word = t.text;
    span.dataset.at = t.at;
    span.textContent = t.text;
    if (a.oov) span.classList.add('oov');
    else if (a.lv) span.classList.add('lv' + a.lv);
    if (marked.has(key)) span.classList.add('marked');
    if (selected === key) span.classList.add('sel');

    const isHard = a.lv === 2;
    const isMark = marked.has(key);
    if ((onlyHard && !isHard && !isMark) || (onlyMarked && !isMark)) span.classList.add('dim');

    frag.appendChild(span);
  }

  readingEl.replaceChildren(frag);
  statsEl.innerHTML = tokens.length
    ? `總字數 <b>${nWord}</b>　不同單字 <b>${seen.size}</b>　難 <b>${hard}</b>　注意 <b>${warn}</b>　字典沒有 <b>${oov}</b>　已標記 <b>${marked.size}</b>`
    : '';
  renderMarked();
}

/* ---------------------------------------------------------------
   7. 發音
   --------------------------------------------------------------- */
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^en[-_]US/i.test(v.lang));
  voice = vs.find(v => /natural|siri|samantha|ava|google/i.test(v.name)) || vs[0] || null;
}
pickVoice();
speechSynthesis.addEventListener('voiceschanged', pickVoice);

function speak(word, rate = 0.85) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US'; u.rate = rate;
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

/* 真人錄音：三個來源疊起來
   1. dictionaryapi.dev —— Wiktionary 詞條裡剛好連結的那一個（常常是空的）
   2. Commons 精確檔名探測 —— 舊的 En-us-xxx.ogg 慣例，一個請求打十個檔名
   3. Commons 限定搜尋 —— Lingua Libre 的 LL-Q1860 (eng)-<錄音者>-<字>.wav
   第 3 層不能用一般搜尋：相關度排序會把發音檔擠到二十名外。 */
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const commonsUrl = p => COMMONS + '?' + new URLSearchParams(
  { format: 'json', formatversion: '2', origin: '*', ...p });
const clean = u => u.split('?')[0];
const ACCENT = { us: '美音', uk: '英音', gb: '英音', au: '澳音', ca: '加音' };

function parseCommonsTitle(title, word) {
  const name = title.replace(/^File:/, '').replace(/\.(ogg|oga|wav|mp3|flac)$/i, '');
  const LL = 'LL-Q1860 (eng)-';
  if (name.startsWith(LL)) {
    const stem = name.slice(LL.length);
    // 錄音者名字本身可能含連字號、空白、括號，所以用「結尾是 -<字>」判斷
    if (stem.toLowerCase().endsWith('-' + word)) {
      return { label: stem.slice(0, -(word.length + 1)), note: '錄音者（口音未標註）' };
    }
    return null;
  }
  const m = name.match(/^En(?:-(us|uk|gb|au|ca))?-(.+)$/i);
  if (m && m[2].toLowerCase() === word) {
    const acc = (m[1] || '').toLowerCase();
    return { label: ACCENT[acc] || '英語', note: 'Wikimedia Commons' };
  }
  return null;
}

async function commonsProbe(word) {
  const cap = word[0].toUpperCase() + word.slice(1);
  const titles = [];
  for (const a of ['us', 'uk']) for (const x of [word, cap]) for (const e of ['ogg', 'wav'])
    titles.push(`File:En-${a}-${x}.${e}`);
  for (const x of [word, cap]) titles.push(`File:En-${x}.ogg`);
  const r = await fetch(commonsUrl({
    action: 'query', prop: 'imageinfo', iiprop: 'url', titles: titles.join('|') }));
  const pages = (await r.json())?.query?.pages ?? [];
  return pages.flatMap(p => {
    const url = p.imageinfo?.[0]?.url;
    const meta = url && parseCommonsTitle(p.title, word);
    return meta ? [{ url: clean(url), ...meta }] : [];
  });
}

async function commonsSearch(word) {
  const r = await fetch(commonsUrl({
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    gsrsearch: `intitle:"LL-Q1860 (eng)" intitle:${word} filetype:audio`,
    prop: 'imageinfo', iiprop: 'url' }));
  const pages = (await r.json())?.query?.pages ?? [];
  return pages.flatMap(p => {
    const url = p.imageinfo?.[0]?.url;
    const meta = url && parseCommonsTitle(p.title, word);
    return meta ? [{ url: clean(url), ...meta }] : [];
  });
}

async function wiktionary(word) {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!r.ok) return { ipa: null, clips: [] };
  const d = (await r.json())[0];
  const ph = d.phonetics ?? [];
  const audio = (ph.find(p => p.audio)?.audio) || null;   // 注意：空字串要當 falsy
  return {
    ipa: (ph.find(p => p.text)?.text) || d.phonetic || null,
    clips: audio ? [{ url: audio, label: /-uk\./.test(audio) ? '英音' : /-us\./.test(audio) ? '美音' : '真人', note: 'Wiktionary' }] : [],
  };
}

const audioCache = new Map();   // word -> { ipa, clips }
async function fetchAudio(word) {
  const key = word.toLowerCase();
  if (audioCache.has(key)) return audioCache.get(key);
  const [wk, probe, search] = await Promise.all([
    wiktionary(key).catch(() => ({ ipa: null, clips: [] })),
    commonsProbe(key).catch(() => []),
    commonsSearch(key).catch(() => []),
  ]);
  // ogg 在 Safari 上不一定能播，排後面
  const rank = u => /\.ogg|\.oga$/i.test(u) ? 2 : /\.wav$/i.test(u) ? 1 : 0;
  const seen = new Set();
  const clips = [...wk.clips, ...probe, ...search]
    .filter(c => !seen.has(c.url) && seen.add(c.url))
    .sort((a, b) => rank(a.url) - rank(b.url))
    .slice(0, 5);
  const res = { ipa: wk.ipa, clips };
  audioCache.set(key, res);
  return res;
}

/* ---------------------------------------------------------------
   7b. Azure TTS（透過你自己的 Cloudflare Worker）
   把 CMUdict 的音素餵進 SSML 的 <phoneme>，TTS 就不用猜 ——
   record / lead / present 這 8,444 個多重發音的字不會再被唸錯。
   --------------------------------------------------------------- */
// 音素白名單與 azureSafe() 在 phonology.js，由 test/azure-ipa.test.mjs 把關。

const CFG = 'pron-azure-v1';
// 頁面和 /tts 由同一個 Worker 提供，所以預設走同網域的相對路徑 ——
// 沒有跨來源請求，就沒有 CORS 也沒有 CSP 問題。
let cfg = { worker: '/tts', voice: 'en-US-AvaNeural' };
let firstRun = true;
try {
  const saved = localStorage.getItem(CFG);
  if (saved) { Object.assign(cfg, JSON.parse(saved)); firstRun = false; }
} catch {}
const saveCfg = () => { try { localStorage.setItem(CFG, JSON.stringify(cfg)); } catch {} };

const azureCache = new Map();   // cacheKey -> object URL
let currentAudio = null;

async function azureSpeak(text, ipa, rate = 1) {
  if (!cfg.worker) throw new Error('no-worker');
  const ck = `${cfg.voice}|${rate}|${ipa || ''}|${text}`;
  let url = azureCache.get(ck);
  if (!url) {
    const r = await fetch(cfg.worker, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ipa: ipa || null, voice: cfg.voice, rate }),
    });
    if (!r.ok) {
      let d = ''; try { d = (await r.json()).detail || ''; } catch {}
      throw new Error(`${r.status}${d ? ' · ' + d.slice(0, 120) : ''}`);
    }
    url = URL.createObjectURL(await r.blob());
    azureCache.set(ck, url);
  }
  speechSynthesis.cancel();
  if (currentAudio) currentAudio.pause();
  currentAudio = new Audio(url);
  await currentAudio.play();
}

// 找出這個字在原文裡所屬的句子，讓 Azure 可以唸「你自己的句子」—— 這是
// 真人語料給不了的：Tatoeba 只有別人的例句。
function sentenceAt(offset) {
  const t = rawText;
  if (!t) return null;
  let a = 0, b = t.length;
  for (let i = offset; i > 0; i--) if (/[.!?\n]/.test(t[i - 1])) { a = i; break; }
  for (let i = offset; i < t.length; i++) if (/[.!?]/.test(t[i])) { b = i + 1; break; }
  const s = t.slice(a, b).trim();
  return s.length > 3 && s.length < 400 ? s : null;
}

/* ---------------------------------------------------------------
   8. 詳細面板
   --------------------------------------------------------------- */
const detailEl = document.getElementById('detail');

function showDetail(word, at) {
  const key = word.toLowerCase();
  selected = key;
  const a = analyze(word);

  const parts = [];
  parts.push(`<p class="word-hd">${word}</p>`);

  if (a.info) {
    const { phones, variants } = a.info;
    const nuc = phones.filter(p => VOWELS.has(bare(p)));
    const at = nuc.findIndex(p => stressOf(p) === 1);

    parts.push(`<p class="ipa">/${ipaString(phones)}/</p>`);

    const sylHtml = syllabify(phones).map(s => {
      const n = s.find(p => VOWELS.has(bare(p)));
      const st = n ? stressOf(n) : null;
      const txt = s.map(toIPA).join('');
      return st === 1 ? `<span class="on">${txt}</span>` : txt;
    }).join('·');

    const phHtml = phones.map(p => {
      const st = stressOf(p);
      return st ? `<span class="s${st === 1 ? 1 : 2}">${p}</span>` : p;
    }).join(' ');

    parts.push('<dl class="kv">');
    parts.push(`<dt>音節</dt><dd class="syl">${sylHtml}</dd>`);
    parts.push(`<dt>重音</dt><dd>${nuc.length} 音節，主重音在第 ${at < 0 ? '—' : at + 1} 個</dd>`);
    parts.push(`<dt>音素</dt><dd class="phones">${phHtml}</dd>`);
    if (variants.length > 1) {
      parts.push(`<dt>其他唸法</dt><dd class="phones">${variants.slice(1).map(v =>
        `/${ipaString(v.split(' '))}/`).join('　')}</dd>`);
    }
    parts.push('</dl>');
  } else {
    parts.push(`<p class="empty">${DICT ? 'CMUdict 沒有這個字 — 可能是專有名詞或新詞。下方仍可試聽。' : '字典還沒載入。'}</p>`);
  }

  const ipa = a.info ? ipaString(a.info.phones) : null;
  const ipaOK = !!ipa && azureSafe(ipa);
  const sent = Number.isInteger(at) ? sentenceAt(at) : null;

  parts.push(`<div class="row" id="audio-row">
      <button class="primary" data-act="say">▶ 發音</button>
      <button data-act="slow">0.6×</button>
      ${sent ? '<button data-act="sent">▶ 聽整句</button>' : ''}
    </div>
    <div class="src" id="eng-note"></div>
    <div class="src" id="src-note">正在找真人錄音…</div>`);

  if (a.issues.length) {
    parts.push('<ul class="issues">' + a.issues.map(i =>
      `<li class="lv${i.lv}">${i.html}</li>`).join('') + '</ul>');
  } else if (a.info) {
    parts.push('<p class="empty mt12">依目前勾選的規則，這個字沒有特別標出的難點。</p>');
  }

  parts.push(`<div class="row"><button data-act="mark">${
    marked.has(key) ? '✓ 已標記為不熟（點一下取消）' : '標記為不熟'
  }</button></div>`);

  detailEl.innerHTML = parts.join('');

  const engNote = detailEl.querySelector('#eng-note');
  const setEng = t => { if (engNote) engNote.textContent = t; };

  // 有 Worker 就走 Azure + <phoneme>，否則退回瀏覽器合成音
  async function say(rate = 1, text = word, useIpa = true) {
    if (!cfg.worker) {
      speak(text, rate * 0.85);
      setEng('瀏覽器合成音 — 設定 Worker 網址後改用 Azure，發音才不會猜錯');
      return;
    }
    const sendIpa = useIpa && ipaOK ? ipa : null;
    setEng('產生中…');
    try {
      await azureSpeak(text, sendIpa, rate);
      setEng(sendIpa
        ? `Azure ${cfg.voice} · 音素由 CMUdict 指定 /${sendIpa}/`
        : `Azure ${cfg.voice} · ${ipa && !ipaOK ? '這個字的音素有 Azure 不收的符號，改用一般唸法' : '一般唸法（字典沒有這個字）'}`);
    } catch (e) {
      speak(text, rate * 0.85);
      setEng(e.message === 'no-worker' ? '瀏覽器合成音' : `Azure 失敗（${e.message}）— 已改用瀏覽器合成音`);
    }
  }

  detailEl.querySelector('[data-act="say"]').onclick = () => say(1);
  detailEl.querySelector('[data-act="slow"]').onclick = () => say(0.6);
  const sentBtn = detailEl.querySelector('[data-act="sent"]');
  if (sentBtn) sentBtn.onclick = () => say(1, sent, false);
  setEng(cfg.worker
    ? (ipaOK ? '按發音會用 CMUdict 指定的音素，TTS 不會猜' : '這個字沒有可用的音素，會用一般唸法')
    : '目前是瀏覽器合成音 — 右上「設定」填入 Worker 網址可改用 Azure');
  detailEl.querySelector('[data-act="mark"]').onclick = () => {
    marked.has(key) ? marked.delete(key) : marked.add(key);
    saveMarked(); render(); showDetail(word);
  };

  // 真人錄音：背景抓，到了才長出按鈕，完全不卡合成音播放
  fetchAudio(word).then(r => {
    if (selected !== key) return;
    const note = document.getElementById('src-note');
    const row = document.getElementById('audio-row');
    if (!note || !row) return;

    if (!r.clips.length) {
      note.textContent = '找不到這個字的真人錄音 — 只能用合成音（合成音對重音和多音字不一定可靠）';
    } else {
      for (const c of r.clips) {
        const b = document.createElement('button');
        const short = c.label.length > 14 ? c.label.slice(0, 13) + '…' : c.label;
        b.textContent = '▶ ' + short;
        b.title = c.label + ' — ' + c.note + ' · ' + decodeURIComponent(c.url.split('/').pop());
        b.onclick = () => {
          speechSynthesis.cancel();
          const au = new Audio(c.url);
          au.play().catch(() => { b.textContent = '✕ ' + c.label; b.disabled = true; });
          au.onerror = () => { b.textContent = '✕ ' + c.label; b.disabled = true; note.textContent = '這個格式你的瀏覽器播不動 — 試旁邊其他錄音'; };
        };
        row.appendChild(b);
      }
      note.textContent = `${r.clips.length} 個真人錄音，來自 Wikimedia Commons / Wiktionary（CC BY-SA）`;
    }

    if (r.ipa && !a.info) {
      const p = document.createElement('p');
      p.className = 'ipa';
      p.textContent = r.ipa + '（來自 Wiktionary，口音未標註）';
      detailEl.querySelector('.word-hd').after(p);
    }
  });

  render();
}

readingEl.addEventListener('click', e => {
  const w = e.target.closest('.w');
  if (w) showDetail(w.dataset.word, +w.dataset.at);
});

/* ---------------------------------------------------------------
   9. 不熟清單
   --------------------------------------------------------------- */
const listEl = document.getElementById('marked-list');
function renderMarked() {
  document.getElementById('marked-count').textContent = marked.size ? `(${marked.size})` : '';
  if (!marked.size) { listEl.innerHTML = '<p class="empty">還沒有標記任何字。</p>'; return; }
  listEl.replaceChildren(...[...marked].sort().map(w => {
    const c = document.createElement('span');
    c.className = 'chip'; c.textContent = w;
    c.onclick = () => showDetail(w);
    return c;
  }));
}

function exportRows() {
  return [...marked].sort().map(w => {
    const a = analyze(w);
    const ph = a.info ? a.info.phones : null;
    return {
      word: w,
      ipa: ph ? '/' + ipaString(ph) + '/' : '',
      arpabet: ph ? ph.join(' ') : '',
      issues: a.issues.map(i => i.html.replace(/<[^>]+>/g, '')).join(' | '),
    };
  });
}

function buildCsv() {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return '﻿' + ['word,ipa,arpabet,issues']
    .concat(exportRows().map(r => [r.word, r.ipa, r.arpabet, r.issues].map(esc).join(',')))
    .join('\n');
}

document.getElementById('copy').onclick = async () => {
  if (!marked.size) return;
  const txt = exportRows().map(r => `${r.word}\t${r.ipa}\t${r.issues}`).join('\n');
  try {
    await navigator.clipboard.writeText(txt);
    document.getElementById('marked-count').textContent = `(${marked.size}) 已複製`;
    setTimeout(renderMarked, 1500);
  } catch {
    // 剪貼簿被擋時，給一個可以手動全選複製的欄位
    const ta = document.createElement('textarea');
    ta.value = txt; ta.rows = 6;
    ta.style.cssText = 'width:100%;margin-top:8px;font-family:var(--mono);font-size:11.5px';
    listEl.after(ta); ta.select();
  }
};

// artifact 環境不允許頁面直接下載檔案，必須走 downloads capability；
// 若是把這個檔案存到本機直接開啟，則退回一般的 blob 下載。
const csvBtn = document.getElementById('csv');
let downloads = null;
if (window.claude?.use) {
  csvBtn.style.display = 'none';
  window.claude.use('downloads')
    .then(d => { if (d) { downloads = d; csvBtn.style.display = ''; } })
    .catch(() => {});
}

csvBtn.onclick = async () => {
  if (!marked.size) return;
  const csv = buildCsv();
  if (downloads) {
    try {
      await downloads.save({ filename: 'pronunciation-review.csv', data: csv });
    } catch (e) {
      if (e?.code && e.code !== 'declined') alert('下載失敗：' + (e.message || e.code));
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'pronunciation-review.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};

document.getElementById('reset').onclick = () => {
  if (!marked.size || !confirm(`清除全部 ${marked.size} 個已標記的字？`)) return;
  marked.clear(); saveMarked(); render();
  if (selected) showDetail(selected);
};

/* ---------------------------------------------------------------
   10. 控制項
   --------------------------------------------------------------- */
const tgEl = document.getElementById('toggles');
tgEl.replaceChildren(...RULES.map(r => {
  const l = document.createElement('label');
  l.className = 'tg';
  const i = document.createElement('input');
  i.type = 'checkbox'; i.checked = r.def;
  i.onchange = () => { on[r.id] = i.checked; render(); if (selected) showDetail(selected); };
  l.append(i, document.createTextNode(r.label));
  return l;
}));

// 設定面板
const cfgPanel = document.getElementById('cfg-panel');
const cfgWorker = document.getElementById('cfg-worker');
const cfgVoice = document.getElementById('cfg-voice');
cfgWorker.value = cfg.worker;
cfgVoice.value = cfg.voice;
document.getElementById('cfg-btn').onclick = () => { cfgPanel.hidden = !cfgPanel.hidden; };
cfgWorker.onchange = () => {
  cfg.worker = cfgWorker.value.trim().replace(/\/$/, '');
  azureCache.clear(); saveCfg();
  if (selected) showDetail(selected);
};
cfgVoice.onchange = () => {
  cfg.voice = cfgVoice.value; saveCfg();
  if (selected) showDetail(selected);
};

// 測試連線 —— 把整條鏈走一遍並說清楚卡在哪一段
const WHY = {
  400: 'Azure 拒絕這份 SSML — 音素裡有它不收的符號',
  401: 'Azure 拒絕 key — AZURE_KEY 貼錯，或 AZURE_REGION 不是 japaneast',
  403: 'token 不對 — 網址結尾的 ?t=... 要跟 Worker 的 TOKEN secret 完全一致',
  404: '這個網址上沒有 Worker — 檢查網址有沒有打錯',
  405: '網址指到的不是這個 Worker',
  429: 'Azure 額度用完，或請求太頻繁',
  500: 'Worker 的環境變數沒設好 — 檢查 AZURE_KEY 和 AZURE_REGION',
};
const cfgTest = document.getElementById('cfg-test');
const cfgResult = document.getElementById('cfg-result');

// 用 DOM 組裝而不是 innerHTML：detail 來自 Azure 的錯誤訊息、e.message 可能
// 含使用者自己打的網址，都是外部字串，不該當成標記解析
function showResult(ok, label, detail) {
  const b = document.createElement('b');
  b.textContent = label;
  b.style.color = ok ? 'var(--accent)' : 'var(--hard)';
  cfgResult.replaceChildren(b, document.createTextNode(detail ? '　' + detail : ''));
}

cfgTest.onclick = async () => {
  const u = cfgWorker.value.trim().replace(/\/$/, '');
  if (!u) { cfgResult.textContent = '先把 Worker 網址填進左邊的欄位'; return; }
  cfg.worker = u; azureCache.clear(); saveCfg();
  cfgResult.textContent = '測試中…';
  const t0 = performance.now();
  try {
    const r = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'record', ipa: 'ɹəˈkɔɹd', voice: cfg.voice, rate: 1 }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) {
      let d = ''; try { d = ((await r.json()).detail || '').slice(0, 120); } catch {}
      showResult(false, `失敗 ${r.status}`, `${WHY[r.status] || '未知錯誤'}${d ? '　' + d : ''}`);
      return;
    }
    const blob = await r.blob();
    const hit = r.headers.get('x-cache') || '—';
    showResult(true, '成功',
      `${(blob.size / 1024).toFixed(1)} KB・${ms} ms・x-cache ${hit}　正在播放，應該聽到動詞的 re-CORD（重音在後）`);
    speechSynthesis.cancel();
    new Audio(URL.createObjectURL(blob)).play().catch(() => {});
  } catch (e) {
    showResult(false, '連不上', `${e.message}。多半是網址打錯，或 Worker 還沒換成新版程式碼`);
  }
};
if (firstRun) cfgPanel.hidden = false;   // 第一次來就先展開設定

const inputEl = document.getElementById('input');
document.getElementById('go').onclick = () => {
  tokens = tokenize(inputEl.value);
  document.getElementById('hint').textContent = tokens.length ? '點任何有顏色的字看說明' : '';
  render();
};
document.getElementById('clear').onclick = () => {
  inputEl.value = ''; tokens = []; selected = null;
  readingEl.innerHTML = ''; statsEl.innerHTML = '';
  detailEl.innerHTML = '<p class="empty">點任何一個字看詳細資訊。</p>';
  renderMarked();
};
document.getElementById('only-hard').onchange = render;
document.getElementById('only-marked').onchange = render;

renderMarked();
document.getElementById('go').click();
