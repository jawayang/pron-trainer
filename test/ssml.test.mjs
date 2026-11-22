import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSSML, esc } from '../src/worker.js';

test('<phoneme> 包住音素，文字當 fallback', () => {
  const ssml = buildSSML({ text: 'record', ipa: 'ɹəˈkɔɹd' });
  assert.match(ssml, /<phoneme alphabet="ipa" ph="ɹəˈkɔɹd">record<\/phoneme>/);
  assert.match(ssml, /<voice name="en-US-AvaNeural">/);
});

test('沒給音素就送純文字', () => {
  const ssml = buildSSML({ text: 'It took months.' });
  assert.ok(!ssml.includes('<phoneme'), '不該出現 phoneme 標籤');
  assert.match(ssml, />It took months\.</);
});

test('語速用百分比，而且會帶正負號', () => {
  assert.match(buildSSML({ text: 'x', ipa: 'ɛks', rate: 0.6 }), /<prosody rate="-40%">/);
  assert.match(buildSSML({ text: 'x', ipa: 'ɛks', rate: 1.2 }), /<prosody rate="\+20%">/);
  assert.ok(!buildSSML({ text: 'x', ipa: 'ɛks', rate: 1 }).includes('prosody'),
    '正常速不該多包一層 prosody（會多算字元）');
});

test('SSML 壓成一行，標籤之間沒有空白', () => {
  // Azure 把 <speak> 和 <voice> 以外的所有標記都算進計費字元，含空白與換行。
  const ssml = buildSSML({ text: 'record', ipa: 'ɹəˈkɔɹd' });
  assert.ok(!/\n|\r|>\s+</.test(ssml), `SSML 不該有換行或標籤間空白：\n${ssml}`);
});

test('XML 特殊字元有逃脫', () => {
  assert.equal(esc(`a<b>&"'`), 'a&lt;b&gt;&amp;&quot;&apos;');
  const ssml = buildSSML({ text: `Tom & Jerry's <show>` });
  assert.ok(!/<show>/.test(ssml), '使用者文字裡的標籤必須被逃脫');
  assert.match(ssml, /&amp;/);
});

test('不認得的聲音名稱會退回預設值', () => {
  const ssml = buildSSML({ text: 'x', voice: '"><script>alert(1)</script>' });
  assert.ok(!ssml.includes('<script>'), '聲音名稱不可以用來注入標記');
});
