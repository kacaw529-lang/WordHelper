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

  /* 詞語讀音：回傳分數（0–100）與每個字是否念對 */
  function detailWord(list, word, zhuyin) {
    const t = Array.from(word);
    const syl = splitZhuyin(zhuyin);
    const aligned = syl.length === t.length;
    let best = { score: 0, hits: t.map(() => false) };
    for (const raw of list || []) {
      const h = chars(raw);
      if (!h.length) continue;
      if (h.join('').includes(word)) return { score: 100, hits: t.map(() => true) };
      const windows = Math.max(1, h.length - t.length + 1);
      for (let s = 0; s < windows; s++) {
        const hits = t.map((c, j) => !!(h[s + j] && charOk(h[s + j], c, aligned ? syl[j] : null)));
        const score = Math.round(hits.filter(Boolean).length / t.length * 100);
        if (score > best.score) best = { score, hits };
      }
    }
    return best;
  }

  /* 解釋跟讀：最長共同子序列（同音字視為相同）；hits 對應文字中的每個國字 */
  function detailText(list, text) {
    const t = chars(text);
    if (!t.length) return { score: 100, hits: [] };
    let best = { score: 0, hits: t.map(() => false) };
    for (const raw of list || []) {
      const h = chars(raw);
      if (!h.length) continue;
      const r = lcsHits(h, t);
      const score = Math.min(100, Math.round(r.len / t.length * 100));
      if (score > best.score) best = { score, hits: r.hits };
    }
    return best;
  }

  const scoreWord = (list, word, zhuyin) => detailWord(list, word, zhuyin).score;
  const scoreText = (list, text) => detailText(list, text).score;

  function lcsHits(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = sameSound(a[i - 1], b[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const hits = new Array(m).fill(false);
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (sameSound(a[i - 1], b[j - 1]) && dp[i][j] === dp[i - 1][j - 1] + 1) { hits[j - 1] = true; i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
      else j--;
    }
    return { len: dp[n][m], hits };
  }

  /**
   * 把文字拆成字元，標記哪些是要念的國字（數字也算），並對上注音。
   * zy：以 | 分隔、依序對應每個國字的注音（後端產生）。
   */
  function tokens(text, zy) {
    const z = String(zy || '').split('|');
    let k = 0;
    return Array.from(String(text || '')).map(ch => {
      const h = DIGIT[ch] || ch;
      if (HAN.test(h)) return { ch, han: true, i: k, zy: z[k++] || '' };
      return { ch, han: false };
    });
  }

  /**
   * 依標點切成適合三年級一次跟讀的短句：在 ，。；！？： 後切開，
   * 太短的句子（少於 4 個字）併入下一句，最後一句太短則併回上一句。
   */
  function segments(toks) {
    const BREAK = '，。；！？：,;!?:';
    const segs = [];
    let cur = [];
    toks.forEach(t => {
      cur.push(t);
      if (BREAK.includes(t.ch)) { segs.push(cur); cur = []; }
    });
    if (cur.some(t => t.han)) segs.push(cur);
    else if (cur.length && segs.length) segs[segs.length - 1].push(...cur);
    const count = seg => seg.filter(t => t.han).length;
    const merged = [];
    segs.forEach(seg => {
      const last = merged[merged.length - 1];
      if (last && count(last) < 4) last.push(...seg);
      else merged.push(seg);
    });
    if (merged.length > 1 && count(merged[merged.length - 1]) < 4) {
      const tail = merged.pop();
      merged[merged.length - 1].push(...tail);
    }
    return merged.filter(seg => count(seg) > 0);
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

  return { setCharmap, ttsText, splitZhuyin, scoreWord, scoreText, detailWord, detailText, tokens, segments, chars, size: () => Object.keys(map).length };
})();
