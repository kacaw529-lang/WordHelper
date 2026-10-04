/* 跟讀比對：用注音比，不只比國字，避免同音字被判錯（例如「公式」被辨識成「公事」） */
const Matcher = (() => {
  let map = {};
  const DIGIT = { '0': '零', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九' };
  const HAN = /\p{Script=Han}/u;

  const normSyl = s => String(s || '').replace(/[\s\u3000]+/g, '').replace(/ˉ/g, '');
  const splitZhuyin = z => String(z || '').trim().split(/[\s\u3000]+/).map(normSyl).filter(Boolean);
  const chars = s => Array.from(String(s || '').replace(/[0-9]/g, d => DIGIT[d])).filter(c => HAN.test(c));
  const readings = c => map[c] || [];

  let mono = null; // 讀音 → 只有這一個讀音的常用字（字音表依字頻排序，先出現的較常用）
  const NO_SWAP = new Set(['一', '不']); // 變調由語音引擎自行處理，不替換

  function setCharmap(raw) {
    mono = null;
    map = {};
    Object.keys(raw || {}).forEach(c => {
      map[c] = String(raw[c]).split('|').map(normSyl).filter(Boolean);
    });
  }

  function sameSound(a, b) {
    if (a === b) return true;
    const ra = readings(a);
    if (!ra.length) return false;
    const rb = readings(b);
    return ra.some(r => rb.includes(r));
  }

  /* 有對齊的注音時，只接受「讀音相同」的字；破音字不會因為別的讀音而誤判通過 */
  function charOk(heard, target, syl) {
    if (heard === target) return true;
    if (syl) return readings(heard).includes(syl);
    return sameSound(heard, target);
  }

  /* 詞語讀音：0–100 */
  function scoreWord(list, word, zhuyin) {
    const t = Array.from(word);
    const syl = splitZhuyin(zhuyin);
    const aligned = syl.length === t.length;
    let best = 0;
    for (const raw of list || []) {
      const h = chars(raw);
      if (!h.length) continue;
      if (h.join('').includes(word)) return 100;
      const windows = Math.max(1, h.length - t.length + 1);
      for (let s = 0; s < windows; s++) {
        let hit = 0;
        for (let j = 0; j < t.length; j++) {
          const c = h[s + j];
          if (c && charOk(c, t[j], aligned ? syl[j] : null)) hit++;
        }
        best = Math.max(best, Math.round(hit / t.length * 100));
      }
    }
    return best;
  }

  /* 解釋跟讀：最長共同子序列（同音字視為相同）／原文字數 */
  function scoreText(list, text) {
    const t = chars(text);
    if (!t.length) return 100;
    let best = 0;
    for (const raw of list || []) {
      const h = chars(raw);
      if (!h.length) continue;
      best = Math.max(best, Math.round(lcs(h, t) / t.length * 100));
    }
    return Math.min(100, best);
  }

  function lcs(a, b) {
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        cur[j] = sameSound(a[i - 1], b[j - 1]) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function monoIndex() {
    if (mono) return mono;
    mono = {};
    Object.keys(map).forEach(c => {
      const r = map[c];
      if (r.length === 1 && !(r[0] in mono)) mono[r[0]] = c;
    });
    return mono;
  }

  /**
   * 產生朗讀用文字（只影響語音，畫面文字不變）。
   * 詞語中的破音字，換成讀音相同、且只有一個讀音的常用字；解釋裡出現的同一個字也照詞語的讀音念。
   * 例：行人（ㄒㄧㄥˊ ㄖㄣˊ）→ 朗讀「型人」；解釋「在路上行走的人」→ 朗讀「在路上型走的人」。
   */
  function ttsText(text, word, zhuyin) {
    const t = Array.from(word || '');
    const syl = splitZhuyin(zhuyin);
    if (!text || !t.length || syl.length !== t.length) return text;
    const idx = monoIndex();
    const swap = {};
    const conflict = new Set();
    t.forEach((c, i) => {
      const r = readings(c);
      if (NO_SWAP.has(c) || r.length < 2 || !r.includes(syl[i])) return;
      const alt = idx[syl[i]];
      if (!alt || alt === c) return;
      if (swap[c] && swap[c] !== alt) conflict.add(c); // 同一字在詞中讀音不同（極少見）
      swap[c] = alt;
    });
    if (!Object.keys(swap).length) return text;
    const spoken = t.map(c => swap[c] || c).join('');
    let out = String(text).split(word).join(spoken);          // 先換整個詞
    out = Array.from(out).map(c => (swap[c] && !conflict.has(c) ? swap[c] : c)).join(''); // 再換單獨出現的字
    return out;
  }

  return { setCharmap, ttsText, splitZhuyin, scoreWord, scoreText, chars, size: () => Object.keys(map).length };
})();
