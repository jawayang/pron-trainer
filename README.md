# 發音練習工具

貼上任何英文文章，自動標出**中文母語者會唸錯的字**，點一下聽發音、看音節與重音，把不熟的字存成複習清單。

> **English summary** — Paste English text; the tool flags words that Mandarin speakers
> typically mispronounce (θ/ð, /v/, final consonant clusters, misplaced stress), shows
> syllabified IPA from CMUdict, and speaks each word through Azure TTS with the exact
> phonemes supplied via SSML `<phoneme>` — so the synthesiser never guesses. Runs as a
> single Cloudflare Worker serving both the page and the speech proxy.

**線上版**：https://pron.jawa-yang.workers.dev

---

## 它解決什麼問題

學英文發音時有兩個不同的問題，大部分工具只解決後面那個：

| 問題 | 誰來回答 |
|---|---|
| **哪些字我該練？** | CMUdict（13 萬字的音素與重音資料） |
| **這個字怎麼唸？** | Azure TTS（SSML `<phoneme>` 指定音素）+ 真人錄音 |
| **這個字什麼意思？** | ECDICT 子集（中英雙解、考試標籤、詞頻、原形還原） |
| **這句在說什麼？** | Azure Translator |

第一個問題才是關鍵 —— 你不會知道自己哪裡不熟，所以要讓程式從音素結構推出來。
`months` 的 `/ˈmʌnθs/` 同時有 θ 和字尾三連子音，這是規則能判斷的，不需要你先知道。

## 技術上比較有意思的幾件事

### 一個字元讓 13,693 個字完全沒有聲音

ARPAbet 的 `G` 一開始被對應成 `ɡ`（U+0261，音標學常用的 script g）。
Azure 的 en-US IPA 集合只收 `g`（U+0067）。

兩個字元在畫面上看不出任何差別，但後果不是「那個音被忽略」——
**Azure 遇到無法識別的音素會拒絕整份 SSML 文件並回 400，完全不產生聲音。**

抓到它的方式不是檢查程式碼，是把整本字典（135,155 筆）跑過一遍、逐字元比對
Azure 官方文件列出的符號集。現在這是一條回歸測試：

```
test/azure-ipa.test.mjs  →  整本 CMUdict 產生的音素，Azure 全部收得下
```

### 上游文件寫錯，照著寫會靜默壞掉

`cmu-pronouncing-dictionary` 的 README 說多重發音的 key 是 `word(1)`、`word(2)`。
實際資料**從 `(2)` 開始，沒有 `(1)`**。

照 README 寫 `for (let i = 1; dict[`${key}(${i})`]; i++)` 的話，迴圈第一圈就結束 ——
8,444 個多重發音的字（`record`、`lead`、`present`）全部只拿到第一種唸法，
而且不會有任何錯誤訊息。

同一份資料還有 22 筆殘留了未清理的 CMUdict 註解：

```
"aalborg": "AO1 L B AO0 R G # place, danish"
```

不切掉的話 `#`、`place,`、`danish` 會被當成音素。

### 音節切分需要合法字首白名單

CMUdict 給音素和重音，但**不給音節邊界**。只用 maximal onset principle 會切錯：

| 字 | 只用 maximal onset | 加上合法字首白名單 |
|---|---|---|
| obsidian | `ə.bsɪd.i.ən` ❌ | `əbˈsɪd.i.ən` ✓ |
| unnecessary | `ə.nnɛs...` ❌ | `ənˈnɛs.əˌsɛɹ.i` ✓ |

`bs` 和 `nn` 都不是英語合法的字首組合。另外還要一條修正：
**重音的鬆母音必須閉合自己的音節**，所以 `happy` 是 `/ˈhæp.i/` 而不是 `/ˈhæ.pi/`。


### 詞典：77 萬筆裁到 5.9 萬筆

ECDICT 完整版 77 萬筆、66 MB，不可能整份進瀏覽器。但絕大多數是專有名詞和生僻變體，
讀一般文章永遠不會遇到。篩選條件用 ECDICT 自己的標註 —— 有語料庫詞頻排名、
有考試大綱標籤、或屬於牛津三千核心詞彙 —— 留下 **59,137 筆、8.7 MB（gzip 後約 3.6 MB）**。

**延遲載入。** 標色只需要 CMUdict，詞義是點開面板才用得到，所以詞典等第一次點字才抓。

**原形還原靠 `exchange` 欄位，不另外帶 lemma 檔。** `month` 的 `s:months`、
`run` 的 `p:ran/i:running` 反過來建索引就是 form → lemma，`months` 和 `ran` 因此查得到。
兩個邊界情況值得一提：

- `running` 在 ECDICT 裡**本來就是獨立詞條**（n. 賽跑），所以回它自己的釋義才對，
  不該強制還原成 `run`
- `best` 自己是動詞（勝過），但 `exchange` 的 `0:good` 標明形容詞用法的原形是 `good` ——
  兩邊都顯示

這兩條都是測試先假設錯、再被真實資料糾正的。

**build 時就轉繁體。** ECDICT 的中文是简体，用 OpenCC 的 `twp` 轉成台灣用語
（软件→軟體、计算机→計算機），不要丟到瀏覽器每次載入都轉一遍。

**釋義一律用 `textContent` 進 DOM。** 音素可以用 `^[A-Z0-9 ]+$` 把格式鎖死，
但釋義是任意中英文字，不能這樣限制 —— 所以改走「永遠不進 innerHTML」這條路。

### 用聲學驗收，不用耳朵

要確認 Azure 真的照 `<phoneme>` 指定的音素唸（而不是忽略它、用自己猜的），
第一次用音量和音高判斷，得到**錯誤**的結論 —— 被單字孤立發音時自然的音高下降騙了
（F0 從 262 Hz 掉到 203 Hz 是任何孤立單字都會有的現象，與重音無關）。

改看 formant 軌跡才確定。第二音節：

| 時間 | F2 | F3 | 判讀 |
|---|---|---|---|
| 0.825–0.875s | 669 → 872 | 2600 | 低 F2 = 後圓唇母音 **ɔ** |
| 0.900–0.975s | 1063 → 1499 | 2187 → **1904** | F3 驟降 = **ɹ** |

這是 `/ɔɹd/` 的長相。名詞的 `/ɚd/` 不會這樣 —— ɚ 的 F3 從母音一開始就低。
所以 `<phoneme>` 確實生效，唸的是動詞 re-CORD。

### 三層 fallback，因為每層的失敗模式不同

真人錄音的取得分三層疊加：

| 層 | 來源 | 為什麼需要它 |
|---|---|---|
| 1 | dictionaryapi.dev | 最快，但詞條常常沒連到音檔（`obsidian` 就是空的） |
| 2 | Commons 精確檔名探測 | 一個請求打十個 `En-us-xxx.ogg` 慣用檔名 |
| 3 | Commons 限定前綴搜尋 | Lingua Libre 檔名含錄音者姓名，猜不到 |

第三層不能用一般搜尋：`intitle:months filetype:audio` 的前 20 筆全是國會演講和配樂，
已知存在的 `En-us-months.ogg` 根本沒出現。要把語言前綴寫進查詢才撈得到。

過濾比抓取難 —— 錄音者名字可能含連字號、空白、括號、重音符號
（`Nattes à chat`、`Naomi Persephone Amethyst (NaomiAmethyst)`），
所以不能切最後一個連字號，要用「檔名結尾是不是 `-<目標字>`」判斷。

---

## 架構

```
pron-trainer/
├── public/
│   ├── index.html      標記（沒有任何 inline script / style）
│   ├── style.css       樣式
│   ├── app.js          UI：斷詞、標色、詳細面板、發音、複習清單
│   ├── phonology.js    純邏輯：ARPAbet→IPA、音節切分、難點規則（可直接測）
│   ├── dictionary.js    英漢詞典查詢與原形還原（可直接測）
│   ├── cmudict.txt     音素資料（3.45 MB，135,155 筆）
│   └── ecdict.txt      英漢詞典資料（8.7 MB，59,137 筆，繁體）
├── scripts/
│   ├── build-dict.mjs    產生 cmudict.txt
│   └── build-ecdict.mjs  裁切並轉繁體，產生 ecdict.txt
├── src/
│   └── worker.js       靜態檔 + POST /tts（Azure 代理）+ 安全標頭
├── test/               35 條回歸測試，含整本字典的音素、格式與查詢驗證
└── .github/workflows/  測試通過才部署，部署後跑煙霧測試
```

**頁面和 API 合在同一個 Worker**，是為了同網域 —— 沒有跨來源請求就沒有 CORS，
也不會被託管環境的 Content-Security-Policy 擋掉（這是實際踩到才改的架構）。

**零執行期第三方依賴。** 前端是原生 ES module，字典是自己託管的資料檔 ——
頁面不載入、也不執行任何外部來源的 JavaScript。

## 本機跑起來

```bash
npm install
npm run build:dict                 # 產生 public/cmudict.txt
# 詞典資料較大，原始檔不進 repo：
git clone --depth 1 https://github.com/skywind3000/ECDICT.git vendor/ECDICT
npm run build:ecdict               # 產生 public/ecdict.txt
cp .dev.vars.example .dev.vars     # 填進 Azure 的 key
npm run dev                        # http://localhost:8787
npm test
```

## 部署

需要在 GitHub repo 設五個 secret（Settings → Secrets and variables → Actions）：

| Secret | 哪裡拿 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens（Edit Workers 範本） |
| `CLOUDFLARE_ACCOUNT_ID` | Workers 總覽頁右側 |
| `AZURE_KEY` | Azure Speech 資源 → 金鑰與端點 → KEY 1 |
| `TTS_TOKEN` | 自己產生，例如 `crypto.randomUUID()` |
| `TRANSLATOR_KEY` | Azure Translator 資源的 key（選填，沒有就沒有整句翻譯） |
| `TRANSLATOR_REGION` | 例如 `japaneast`（選填） |
| `CLOUDFLARE_SUBDOMAIN` | 你的 workers.dev 子網域，例如 `jawa-yang`（煙霧測試要用） |

推到 `main` 之後 CI 會跑測試 → 部署 → 用真的請求確認回來的是 MP3（檢查
`FF Fx` 同步字與檔案大小），任何一步失敗就擋下來。

## 成本

| 項目 | 免費額度 | 實際用量 |
|---|---|---|
| Azure Speech F0 | 50 萬字元/月 | 每點一個字約 53 字元（`<phoneme>` 標記也計費） |
| Cloudflare Workers | 10 萬次請求/天 | 一天幾百次 |

F0 是硬上限，用完回 429 而不是轉成計費，所以不會有意外帳單。

> 註：Cache API 在 `*.workers.dev` 上是空操作，要接自訂網域才會生效。
> 目前靠前端的記憶體快取處理重複點擊。

## 安全性上的取捨

這是一個會把使用者貼上的文字放進 DOM、並且持有一支雲端 API 金鑰的頁面，
所以攻擊面值得寫清楚。

### 不從 CDN 執行第三方程式碼

字典原本是 `await import('https://cdn.jsdelivr.net/npm/...')` —— 那會在頁面裡
**執行**第三方 JavaScript，權限和自己的程式碼一樣大：能讀 `localStorage`
（裡面有 API token）、能改畫面、能把資料送到任何地方。套件被挾持或 CDN 被攻破就全滅。

改成由 build script 產生一份純文字資料檔自己託管。資料檔只會被 `split` 解析，
不會被執行 —— 最糟的情況從「跑別人的程式碼」降級成「音標顯示錯誤」。

### 字典資料的格式就是一條安全邊界

音素會以 `<code>${phone}</code> ` 的形式進 DOM。build script 強制每一筆音素
必須符合 `^[A-Z0-9 ]+$`，不合的直接排除（目前 135,155 筆全數通過），
所以字典資料不可能夾帶標記。`test/dict-file.test.mjs` 負責把關。

### 嚴格的 CSP

因為沒有 inline script、沒有 inline style、也不載入外部 JS，`script-src` 可以
只寫 `'self'` —— 就算哪裡有 XSS 缺口，注入的腳本也跑不起來。

```
default-src 'self'; script-src 'self'; style-src 'self';
connect-src 'self' https://api.dictionaryapi.dev https://commons.wikimedia.org;
media-src 'self' blob: https://upload.wikimedia.org https://api.dictionaryapi.dev;
base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'
```

### 外部字串一律用 DOM 組裝，不進 innerHTML

Azure 的錯誤訊息和 `e.message` 都是外部字串，改用 `textContent` 塞進
`createElement` 出來的節點，不走模板字串拼 HTML。

### 查字典用 `Object.create(null)`

字典裡若出現 `__proto__` 或 `constructor` 這類字，用一般物件查詢會拿到原型鏈上
的東西而不是 `undefined`，後面 `.split()` 就會炸掉。`lookup()` 另外加了
`typeof === 'string'` 檢查。

### SSML 注入

送進 `<phoneme ph="...">` 的音素、文字都經過 XML 逃脫；聲音名稱用白名單正則
驗過才進屬性值（而且在 `buildSSML()` 內部再驗一次，不倚賴呼叫端）；語速夾在
0.5–2 之間。Worker 對外只打一個固定的 Azure 網址，沒有使用者輸入參與組網址，
所以沒有 SSRF 面。

### Token 與金鑰

| 東西 | 放在哪 | 會不會外流 |
|---|---|---|
| Azure KEY | GitHub secret → Cloudflare Worker secret | 不進 repo、不進瀏覽器 |
| TTS token | 瀏覽器 localStorage；CI 用 `x-token` 標頭 | 不放在 CI 的網址裡，避免進 log |

`/tts` 的 CORS 只回給自己這個網域 —— 就算 token 外流，別的網站的 JS 也不能
從瀏覽器打這個端點。

### 已知、且刻意接受的風險

- **沒有速率限制。** token 外流的話，持有者可以把當月額度用完。但 Azure F0 是
  硬上限、超過回 429 而不是計費，所以損失是「服務暫停」而不是帳單。
  真的要處理就接 Cloudflare 的 Rate Limiting 規則。
- **GitHub Actions 用的是 `@v3` / `@v4` 標籤而不是 commit SHA。** 釘 SHA 更安全，
  代價是每次更新要手動改。個人專案接受這個取捨。
- **`*.workers.dev` 上 Cache API 是空操作**，所以目前只有前端的記憶體快取。

## 資料來源與授權

本專案程式碼採 **BSD-2-Clause**，與 CMUdict 本身相同。

| 來源 | 授權 | 使用方式 |
|---|---|---|
| [CMUdict](https://github.com/cmusphinx/cmudict) | BSD-2-Clause | 音素與重音，build 時轉成 `public/cmudict.txt` 自行託管 |
| [ECDICT](https://github.com/skywind3000/ECDICT) | MIT | 英漢雙解詞典，build 時裁切、轉繁體成 `public/ecdict.txt` 自行託管 |
| [OpenCC](https://github.com/BYVoid/OpenCC) | Apache-2.0 | build 時的简繁轉換（opencc-js） |
| Azure Translator | 商業服務 | 整句翻譯（選用） |
| [dictionaryapi.dev](https://dictionaryapi.dev/) / Wiktionary | CC BY-SA 3.0 | 音標與真人錄音，執行期取用 |
| [Wikimedia Commons](https://commons.wikimedia.org/) / Lingua Libre | CC BY-SA（逐檔不同） | 真人錄音，執行期取用、不重新散布 |
| Azure Speech | 商業服務 | 語音合成 |

音檔皆為執行期連結取用，本專案不重新散布任何第三方資料。
