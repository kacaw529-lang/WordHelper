/* 與 Apps Script 溝通：GET 讀資料、POST 用 text/plain 寫資料（避開跨網域預檢） */
const Api = (() => {
  const base = () => window.APP_CONFIG.API_URL;

  async function unwrap(promise) {
    let res;
    try {
      res = await promise;
    } catch (err) {
      throw new Error('連不上伺服器，請確認網路後再試一次');
    }
    if (!res.ok) throw new Error('伺服器回應異常（' + res.status + '），請稍後再試');
    let json;
    try { json = await res.json(); } catch (err) { throw new Error('伺服器回傳格式錯誤，請通知老師'); }
    if (!json.ok) throw new Error(json.error || '發生錯誤，請通知老師');
    return json.data;
  }

  function get(params) {
    const qs = new URLSearchParams(params).toString();
    return unwrap(fetch(base() + '?' + qs, { method: 'GET', redirect: 'follow' }));
  }

  function post(body) {
    return unwrap(fetch(base(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }));
  }

  return { get, post };
})();

/* 日期工具：一律輸出 yyyy-MM-dd（Asia/Taipei），寬容解析三種形態 */
const DateTW = (() => {
  const TZ = 'Asia/Taipei';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

  function fromDate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const p = {};
    fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  function ymd(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function normalize(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return fromDate(v);
    const s = String(v).trim();
    const m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    return fromDate(new Date(s.replace(/\s*\([^)]*\)\s*$/, '')));
  }

  function today() { return fromDate(new Date()); }

  function addDays(s, n) {
    const [y, m, d] = normalize(s).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  return { normalize, today, addDays, fromDate };
})();
