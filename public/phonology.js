/**
 * ARPAbet → IPA、音節切分、重音、以及「中文母語者會卡在哪」的規則。
 *
 * 這個檔案不碰 DOM，也不發任何請求 —— 所以 test/ 底下的回歸測試可以
 * 直接 import 它，拿整本 CMUdict（135,155 筆）跑驗證。
 */

export const IPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ',
  EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  // G 是 ASCII 的 g (U+0067)，不是音標學常用的 ɡ (U+0261)。
  // Azure 的 en-US IPA 集合只收 U+0067；用錯的話整份 SSML 會被拒、
  // 完全沒有聲音（不是忽略那一個音），而且影響 13,693 個字。
  // 兩個字元在畫面上看不出差別，所以靠 test/azure-ipa.test.mjs 把關。
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h', JH: 'dʒ', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't',
  TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

export const VOWELS = new Set(
  ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW']);
/** 鬆母音：帶重音時必須閉合自己的音節（happy = hæp.i，不是 hæ.pi） */
export const LAX = new Set(['IH', 'EH', 'AE', 'AH', 'UH']);
/** 中文音節唯一允許的尾音，其他收尾都要特別練 */
export const CODA_OK = new Set(['N', 'NG']);

export const bare = (p) => p.replace(/\d$/, '');
export const stressOf = (p) => { const m = p.match(/(\d)$/); return m ? +m[1] : null; };

export function toIPA(p) {
  const b = bare(p), s = stressOf(p);
  if (b === 'AH' && s === 0) return 'ə';
  if (b === 'ER' && s === 0) return 'ɚ';
  return IPA[b] ?? b.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * 字典查詢
 * ------------------------------------------------------------------ */

/**
 * 這份資料有兩個陷阱：
 *   1. 22 筆殘留了 CMUdict 的註解，例如
 *      "aalborg": "AO1 L B AO0 R G # place, danish"
 *   2. 多重發音從 (2) 開始編號，沒有 (1) —— npm 套件的 README 寫錯了，
 *      照它寫的從 1 開始迴圈，8,444 個多重發音的字會全部只拿到第一種。
 */
export function lookup(dict, word) {
  const key = String(word).toLowerCase();
  const first = dict[key];
  // typeof 檢查不只是防呆：查 "__proto__" 或 "constructor" 時，一般物件會
  // 回傳原型鏈上的東西而不是 undefined，後面 .split() 就會炸掉
  if (typeof first !== 'string' || !first) return null;
  const strip = (s) => s.split('#')[0].trim();
  const variants = [strip(first)];
  for (let i = 2; dict[`${key}(${i})`]; i++) variants.push(strip(dict[`${key}(${i})`]));
  return { key, variants, phones: variants[0].split(/\s+/) };
}

/* ------------------------------------------------------------------ *
 * 音節切分（近似）
 * ------------------------------------------------------------------ */

/** 英語合法的字首雙子音。沒有這張表的話 obsidian 會被切成 ə.bsɪd */
export const ONSET2 = new Set([
  'S P','S T','S K','S M','S N','S F','S L','S W',
  'P L','P R','B L','B R','K L','K R','G L','G R','F L','F R','T R','D R','TH R','SH R',
  'K W','G W','T W','D W','HH W','TH W',
  'P Y','B Y','K Y','G Y','M Y','F Y','V Y','HH Y','N Y','L Y','S Y','T Y','D Y','TH Y','Z Y',
]);
export const ONSET3 = new Set(['S T R', 'S P R', 'S K R', 'S P L', 'S K W', 'S K L']);

export const legalOnset = (cs) =>
  cs.length <= 1 ? true
  : cs.length === 2 ? ONSET2.has(cs.join(' '))
  : cs.length === 3 ? ONSET3.has(cs.join(' '))
  : false;

/** maximal onset principle + 合法字首白名單 + 重音鬆母音閉音節 */
export function syllabify(phones) {
  const nuclei = [];
  phones.forEach((p, i) => { if (VOWELS.has(bare(p))) nuclei.push(i); });
  if (!nuclei.length) return [phones];

  const cuts = [];
  for (let k = 0; k < nuclei.length - 1; k++) {
    const a = nuclei[k], b = nuclei[k + 1];
    const run = phones.slice(a + 1, b).map(bare);
    let onset = 0;
    for (let n = Math.min(run.length, 3); n >= 1; n--) {
      if (legalOnset(run.slice(run.length - n))) { onset = n; break; }
    }
    const st = stressOf(phones[a]);
    if (run.length && st && LAX.has(bare(phones[a])) && onset === run.length) {
      onset = run.length - 1;
    }
    cuts.push(b - onset);
  }

  const out = []; let start = 0;
  for (const c of cuts) { out.push(phones.slice(start, c)); start = c; }
  out.push(phones.slice(start));
  return out.filter((s) => s.length);
}

/** 把一個音節拆成 起首子音 / 母音 / 尾音 */
export function parts(syl) {
  const bs = syl.map(bare);
  const ni = bs.findIndex((p) => VOWELS.has(p));
  return ni < 0
    ? { onset: bs, nucleus: null, coda: [] }
    : { onset: bs.slice(0, ni), nucleus: syl[ni], coda: bs.slice(ni + 1) };
}

/** 重音符號本身就是音節分界，所以它前面不再放 `.` */
export function ipaString(phones) {
  return syllabify(phones).map((syl) => {
    const nuc = syl.find((p) => VOWELS.has(bare(p)));
    const s = nuc ? stressOf(nuc) : null;
    const mark = s === 1 ? 'ˈ' : s === 2 ? 'ˌ' : '';
    return mark + syl.map(toIPA).join('');
  }).join('.').replace(/\.(?=[ˈˌ])/g, '');
}

/* ------------------------------------------------------------------ *
 * Azure SSML <phoneme> 的音素白名單
 * ------------------------------------------------------------------ */

/**
 * Azure en-US 接受的 IPA 符號（抄自官方的 speech-ssml-phonetic-sets 文件）。
 * 送出前一定要驗：只要有一個無法識別的音素，Azure 會拒絕整份 SSML 文件
 * 並回 400，而不是忽略那一個音。
 */
export const AZURE_OK = new Set([
  ...['i','ɪ','eɪ','ɛ','æ','ɑ','ɔ','ʊ','oʊ','u','ʌ','aɪ','aʊ','ɔɪ','ju','ə'],
  ...['ɪɹ','ɛɹ','ʊɹ','aɪɹ','aʊɹ','ɔɹ','ɑɹ','ɝ','ɚ'],
  ...['w','j','p','b','t','d','k','g','m','n','ŋ','f','v','θ','ð','s','z','ʃ','ʒ','h','tʃ','dʒ','l','ɹ'],
  ...['ˈ','ˌ','.'],
].flatMap((s) => [...s]));

export const azureSafe = (ipa) => [...ipa].every((c) => AZURE_OK.has(c));

/* ------------------------------------------------------------------ *
 * 難點偵測（針對中文母語者）
 * ------------------------------------------------------------------ */

export const RULES = [
  { id: 'th',      label: 'θ / ð',        def: true  },
  { id: 'v',       label: 'v',            def: true  },
  { id: 'zh',      label: 'z / ʒ',        def: true  },
  { id: 'coda',    label: '字尾子音',       def: true  },
  { id: 'cluster', label: '子音叢集',       def: true  },
  { id: 'er',      label: '捲舌 ɝ / ɚ',    def: false },
  { id: 'stress',  label: '重音不在首音節',  def: true  },
  { id: 'hetero',  label: '多重發音',       def: true  },
  { id: 'ivpair',  label: 'ɪ / i 與 æ / ɛ', def: false },
];

export const defaultRules = () =>
  Object.fromEntries(RULES.map((r) => [r.id, r.def]));

/** @param on 哪些規則要套用，形如 {th:true, v:true, ...} */
export function findIssues(phones, variants = [], on = defaultRules()) {
  const out = [];
  const bs = phones.map(bare);
  const add = (lv, html) => out.push({ lv, html });

  if (on.th) {
    if (bs.includes('TH')) add(2, '含 <code>TH</code> = θ：中文沒有這個音，容易唸成 s。舌尖要輕觸上齒之間送氣。');
    if (bs.includes('DH')) add(2, '含 <code>DH</code> = ð：中文沒有這個音，容易唸成 z 或 d。同樣位置但要出聲。');
  }
  if (on.v && bs.includes('V')) add(2, '含 <code>V</code> = v：容易唸成 w。下唇要碰到上排牙齒。');
  if (on.zh) {
    if (bs.includes('ZH')) add(2, '含 <code>ZH</code> = ʒ：中文沒有這個音（像 vision 中間那個音）。');
    if (bs.includes('Z'))  add(1, '含 <code>Z</code> = z：容易清化成 s，要帶聲帶振動。字尾時最常被吃掉。');
  }
  if (on.er && bs.includes('ER')) add(1, '含 <code>ER</code> = ɝ/ɚ：美語捲舌母音，舌根要往後收，不是中文的「兒」。');

  const lastB = bs[bs.length - 1];
  if (on.coda && lastB && !VOWELS.has(lastB) && !CODA_OK.has(lastB)) {
    add(1, `字尾是子音 <code>${lastB}</code>（${toIPA(phones[phones.length - 1])}）：中文沒有這種收尾，容易整個省略或加母音。`);
  }

  if (on.cluster) {
    const syls = syllabify(phones);
    syls.forEach((syl, si) => {
      const { onset, coda } = parts(syl);
      const last = si === syls.length - 1;
      if (onset.length >= 2) add(onset.length >= 3 ? 2 : 1,
        `${si ? '音節' : '字'}首子音叢集 <code>${onset.join(' ')}</code>：${onset.length} 個子音連著唸，中間不能插母音。`);
      if (coda.length >= 2) add(coda.length >= 3 ? 2 : 1,
        `${last ? '字' : '音節'}尾子音叢集 <code>${coda.join(' ')}</code>：${coda.length} 個子音連著收尾，最容易整組吃掉。`);
    });
  }

  if (on.stress) {
    const nuc = phones.filter((p) => VOWELS.has(bare(p)));
    const at = nuc.findIndex((p) => stressOf(p) === 1);
    if (nuc.length >= 2 && at > 0) {
      add(1, `${nuc.length} 個音節，主重音在<b>第 ${at + 1} 個</b>：重音放錯位置是最容易被聽出來的錯誤。`);
    }
  }

  if (on.hetero && variants.length > 1) {
    add(1, `這個字有 ${variants.length} 種發音（見下方「其他唸法」）：語音合成常常選錯，以真人錄音為準。`);
  }

  if (on.ivpair) {
    if (bs.includes('IH') || bs.includes('IY')) add(1, '含 ɪ 或 i：ship 與 sheep 的對比，長短與鬆緊都要分。');
    if (bs.includes('AE') || bs.includes('EH')) add(1, '含 æ 或 ɛ：bad 與 bed 的對比，下巴開合不同。');
  }

  return out;
}

export const levelOf = (issues) => issues.reduce((a, b) => Math.max(a, b.lv), 0);
