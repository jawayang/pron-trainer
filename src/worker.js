/**
 * 一個 Worker 同時提供兩件事：
 *   GET  /*     → public/ 裡的靜態檔（由 wrangler.jsonc 的 assets binding 處理）
 *   POST /tts   → Azure 語音合成的代理
 *
 * 合在一起是為了讓頁面和 API 同網域 —— 沒有跨來源請求，
 * 就不會踩到 CORS，也不會被託管環境的 Content-Security-Policy 擋掉。
 *
 * 環境變數：
 *   AZURE_KEY     Azure Speech 資源的 KEY 1（Secret）
 *   AZURE_REGION  例如 japaneast（Text）
 *   TOKEN         選填（Secret）。設了之後 /tts 必須帶 ?t=<TOKEN>，
 *                 避免網址外流被陌生人用光每月免費額度。
 */

const VOICE_OK = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;
const MAX_TEXT = 400;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/**
 * 嚴格的 CSP。能這樣寫是因為：
 *   - 頁面沒有任何 inline <script> 或 inline style（都拆成外部檔）
 *   - 字典改成自己託管的資料檔，不再從 CDN 載入並執行第三方 JS
 * 所以 script-src 可以只允許 'self'，也就是說就算哪裡有 XSS 缺口，
 * 注入的腳本也跑不起來。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  // 真人錄音的查詢來源
  "connect-src 'self' https://api.dictionaryapi.dev https://commons.wikimedia.org",
  // 音檔：Azure 的經由 /tts 回來變成 blob，真人錄音在這兩個網域上
  "media-src 'self' blob: https://upload.wikimedia.org https://api.dictionaryapi.dev",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/tts') return handleTTS(request, env, ctx, url);

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};

async function handleTTS(request, env, ctx, url) {
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);
  if (request.method !== 'POST') return cors(json({ error: 'use POST' }, 405), request);

  // token 兩種帶法都收：
  //   ?t=...        給瀏覽器用（頁面只要存一個網址就好）
  //   x-token 標頭   給 CI 和腳本用 —— 不會出現在網址裡，就不會被記進
  //                 任何一層的存取紀錄或錯誤訊息
  if (env.TOKEN) {
    const given = request.headers.get('x-token') ?? url.searchParams.get('t');
    if (given !== env.TOKEN) return cors(json({ error: 'bad token' }, 403), request);
  }
  if (!env.AZURE_KEY || !env.AZURE_REGION) {
    return cors(json({ error: 'AZURE_KEY / AZURE_REGION 沒設定' }, 500), request);
  }

  let body;
  try { body = await request.json(); }
  catch { return cors(json({ error: 'body 不是 JSON' }, 400), request); }

  const text = String(body.text ?? '').trim().slice(0, MAX_TEXT);
  if (!text) return cors(json({ error: 'text 是空的' }, 400), request);

  const ipa = body.ipa ? String(body.ipa).slice(0, 200) : null;
  const voice = VOICE_OK.test(body.voice || '') ? body.voice : 'en-US-AvaNeural';
  const rate = Math.min(2, Math.max(0.5, Number(body.rate) || 1));

  // 同樣的字 + 音素 + 聲音 + 語速 = 同一個檔。
  // 注意：Cache API 在 *.workers.dev 上是空操作，要接自訂網域才會真的生效。
  const cacheKey = new Request(
    'https://tts.cache/' + [voice, rate, ipa || '-', text].map(encodeURIComponent).join('/'),
    { method: 'GET' },
  );
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set('x-cache', 'HIT');
    return cors(r, request);
  }

  const ssml = buildSSML({ text, ipa, voice, rate });
  const res = await fetch(
    `https://${env.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        'User-Agent': 'pron-trainer',
      },
      body: ssml,
    },
  );

  if (!res.ok) {
    // 400 幾乎都是音素裡有 Azure 不收的符號。把 SSML 一起回傳方便對照。
    const detail = await res.text().catch(() => '');
    return cors(json({ error: res.status, detail: detail.slice(0, 400), ssml }, res.status), request);
  }

  const audio = new Response(res.body, {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'public, max-age=31536000',
      'x-cache': 'MISS',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, audio.clone()));
  return cors(audio, request);
}

/**
 * 組 SSML。<phoneme> 裡放 CMUdict 給的音素，包住的文字只是 fallback。
 *
 * 刻意壓成一行、標籤之間不留空白：Azure 的計費把 <speak> 和 <voice> 以外的
 * 所有標記都算進字元數，包含空白和換行。縮排排版每次會多算幾十個字元。
 */
export function buildSSML({ text, ipa, voice = 'en-US-AvaNeural', rate = 1 }) {
  // 聲音名稱直接進屬性值，所以這裡自己再驗一次，不倚賴呼叫端先擋過
  const safeVoice = VOICE_OK.test(voice) ? voice : 'en-US-AvaNeural';
  const inner = ipa
    ? `<phoneme alphabet="ipa" ph="${esc(ipa)}">${esc(text)}</phoneme>`
    : esc(text);
  const pct = Math.round((rate - 1) * 100);
  const wrapped = pct === 0
    ? inner
    : `<prosody rate="${pct > 0 ? '+' : ''}${pct}%">${inner}</prosody>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">`
    + `<voice name="${safeVoice}">${wrapped}</voice></speak>`;
}

export const esc = (s) =>
  String(s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const json = (o, status) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

/**
 * 只對自己這個網域回 CORS 標頭。
 *
 * 原本是 `*`，那是頁面和 API 還分在兩個 Worker 時的需要。現在同網域了，
 * 開放給任意來源只會多出一條路：別的網站的 JS 可以拿著外流的 token
 * 直接從瀏覽器打這個端點。curl 和 Postman 不受影響（它們本來就不看 CORS）。
 */
function cors(r, request) {
  const origin = request.headers.get('origin');
  if (origin && origin === new URL(request.url).origin) {
    r.headers.set('access-control-allow-origin', origin);
    r.headers.set('access-control-allow-methods', 'POST, OPTIONS');
    r.headers.set('access-control-allow-headers', 'content-type, x-token');
    r.headers.set('access-control-max-age', '86400');
    r.headers.set('vary', 'origin');
  }
  r.headers.set('x-content-type-options', 'nosniff');
  return r;
}
