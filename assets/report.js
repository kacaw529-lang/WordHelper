/* 練習紀錄彙整：進度矩陣、需要注意清單、明細分組、CSV（純資料處理，可在 node 測試） */
const Report = (() => {
  const OTHER = '其他';
  const AUTO = '自動辨識';
  const isNum = v => typeof v === 'number' && isFinite(v);
  const mean = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  /* 日期一律寬容解析成 yyyy-MM-dd，依「日期＋時間」由新到舊排序 */
  function prepare(rows) {
    return (rows || [])
      .map(r => {
        const date = DateTW.normalize(r.date);
        const time = String(r.time || '');
        return Object.assign({}, r, { date, time, stamp: date + ' ' + time });
      })
      .filter(r => r.date && r.student)
      .sort((a, b) => b.stamp.localeCompare(a.stamp));
  }

  /* 依第一次練習的時間排列生字（像課本的順序） */
  function charsByFirstPractice(recs) {
    const first = {};
    recs.forEach(r => { if (r.char && (!(r.char in first) || r.stamp < first[r.char])) first[r.char] = r.stamp; });
    return Object.keys(first).sort((a, b) => first[a].localeCompare(first[b]) || a.localeCompare(b));
  }

  function newCell() {
    return { records: [], done: 0, skip: 0, swap: 0, maxTries: 0, defs: [], auto: 0, self: 0 };
  }

  function addRecord(c, r) {
    c.records.push(r);
    if (r.result === '換詞') { c.swap++; return; }
    if (r.result === '完成') c.done++;
    else if (r.result === '跳過') c.skip++;
    if (r.method === AUTO) {
      c.auto++;
      if (isNum(r.defScore)) c.defs.push(r.defScore);
    } else {
      c.self++;
    }
    const t = Math.max(Number(r.wordTries) || 0, Number(r.defTries) || 0);
    if (r.result === '完成' && t > c.maxTries) c.maxTries = t;
  }

  function finishCell(c, o, isOther) {
    c.def = mean(c.defs);
    delete c.defs;
    if (c.done >= (isOther ? 1 : o.need)) c.status = 'done';
    else c.status = c.records.length ? 'partial' : 'none';
    c.warn = c.skip > 0;                    // 紅點只標跳過；多次嘗試列在「需要注意」
    c.hard = c.maxTries >= o.skipAfter;
    c.low = c.def !== null && c.def < o.defPass;
    c.selfOnly = c.self > 0 && c.auto === 0;
    return c;
  }

  /**
   * rows：紀錄（date, time, student, char, word, result, wordScore, defScore, wordTries, defTries, method）
   * opts：students [{id, name}]、chars（指派的生字；不給就依練習紀錄產生）、mode 'assign'|'date'、
   *       need 每個字要完成幾個詞、defPass 解釋門檻、skipAfter 幾次算多次嘗試、includeOthers 是否列出名單外的學生
   */
  function build(rows, opts) {
    const o = Object.assign({ need: 3, defPass: 80, skipAfter: 3, chars: null, students: [], mode: 'date', includeOthers: true }, opts);
    const recs = prepare(rows);
    const fixed = Array.isArray(o.chars) && o.chars.length > 0;
    const chars = fixed ? o.chars.slice() : charsByFirstPractice(recs);
    const inCols = new Set(chars);
    const colOf = r => (inCols.has(r.char) ? r.char : OTHER);

    const students = (o.students || []).map(s => ({ id: s.id, name: s.name || s.id }));
    const known = new Set(students.map(s => s.id));
    if (o.includeOthers) {
      recs.forEach(r => {
        if (!known.has(r.student)) { known.add(r.student); students.push({ id: r.student, name: r.student }); }
      });
    }
    const byStudent = {};
    students.forEach(s => { byStudent[s.id] = []; });
    recs.forEach(r => { if (byStudent[r.student]) byStudent[r.student].push(r); });
    const shown = students.reduce((a, s) => a.concat(byStudent[s.id]), []).sort((a, b) => b.stamp.localeCompare(a.stamp));

    const hasOther = fixed && shown.some(r => !inCols.has(r.char));
    const cols = hasOther ? chars.concat(OTHER) : chars;

    const matrix = students.map(s => {
      const cells = {};
      cols.forEach(c => { cells[c] = newCell(); });
      byStudent[s.id].forEach(r => addRecord(cells[colOf(r)], r));
      cols.forEach(c => finishCell(cells[c], o, c === OTHER));
      return {
        id: s.id, name: s.name, cells, total: byStudent[s.id].length,
        charsDone: chars.filter(c => cells[c].status === 'done').length
      };
    });

    const classRow = {};
    cols.forEach(c => {
      const cs = matrix.map(m => m.cells[c]);
      const records = [].concat(...cs.map(x => x.records)).sort((a, b) => b.stamp.localeCompare(a.stamp));
      const defs = records.filter(r => r.result !== '換詞' && r.method === AUTO && isNum(r.defScore)).map(r => r.defScore);
      const def = mean(defs);
      const skip = cs.reduce((a, x) => a + x.skip, 0);
      classRow[c] = {
        done: cs.filter(x => x.status === 'done').length, total: matrix.length,
        def, skip, records, warn: skip > 0, low: def !== null && def < o.defPass
      };
    });

    return {
      chars, cols, hasOther, matrix, classRow, records: shown,
      attention: attention(students, byStudent, o),
      groups: groups(students, byStudent)
    };
  }

  /* 卡在哪一關：解釋有分數或有嘗試，就是卡在解釋 */
  const stageOf = r => ((Number(r.defTries) > 0 || isNum(r.defScore)) ? 'def' : 'word');

  /* 嚴重程度：未開始 → 未經辨識 → 跳過 → 常換詞 → 多次嘗試 */
  const SEVERITY = { start: 0, device: 1, skip: 2, swap: 3, tries: 4 };

  function attention(students, byStudent, o) {
    const out = [];
    students.forEach((s, order) => {
      const list = byStudent[s.id];
      const push = it => out.push(Object.assign({ student: s.id, name: s.name, char: '', word: '', last: '', order }, it));
      if (o.mode === 'assign' && !list.length) {
        push({ kind: 'start', label: '未開始', text: '指派期間內還沒有練習紀錄。' });
      }
      const self = list.filter(r => r.result !== '換詞' && r.method !== AUTO);
      if (self.length) {
        const ms = Array.from(new Set(self.map(r => r.method || '自評'))).join('、');
        push({
          kind: 'device', label: '未經辨識', last: self[0].stamp,
          text: self.length + ' 個詞以「' + ms + '」完成，沒有經過語音辨識。請確認是否用 Chrome 或 Safari 開啟，並允許使用麥克風。'
        });
      }
      list.filter(r => r.result === '跳過').forEach(r => {
        const st = stageOf(r);
        const sc = st === 'def' ? r.defScore : r.wordScore;
        push({
          kind: 'skip', label: '跳過', char: r.char, word: r.word, last: r.stamp,
          text: '卡在' + (st === 'def' ? '念解釋' : '念詞語') + (isNum(sc) ? '，最高 ' + sc + ' 分' : '') + '。'
        });
      });
      const swaps = list.filter(r => r.result === '換詞');
      if (swaps.length >= 3) {
        push({ kind: 'swap', label: '常換詞', last: swaps[0].stamp, text: '換了 ' + swaps.length + ' 次詞，留意是否在避開較難的詞。' });
      }
      // 多次嘗試：每位學生合併成一列，避免清單被洗版
      const hard = list.filter(r => r.result === '完成' && r.method === AUTO &&
        Math.max(Number(r.wordTries) || 0, Number(r.defTries) || 0) >= o.skipAfter);
      if (hard.length) {
        const names = hard.map(r => r.word);
        push({
          kind: 'tries', label: '多次嘗試', last: hard[0].stamp, records: hard,
          text: hard.length + ' 個詞念了 ' + o.skipAfter + ' 次以上才通過：' + names.slice(0, 8).join('、') + (names.length > 8 ? ' 等' : '') + '。'
        });
      }
    });
    return out.sort((a, b) => (SEVERITY[a.kind] - SEVERITY[b.kind]) || (a.order - b.order) || b.last.localeCompare(a.last));
  }

  /* 明細：依學生分組，日期、生字相同的列只在第一列顯示 */
  function groups(students, byStudent) {
    return students.filter(s => byStudent[s.id].length).map(s => {
      const list = byStudent[s.id];
      const rows = list.map((r, i) => {
        const prev = list[i - 1];
        const newDate = !prev || prev.date !== r.date;
        return Object.assign({ newDate, newChar: newDate || prev.char !== r.char }, r);
      });
      return {
        id: s.id, name: s.name, rows, last: list[0].stamp,
        done: list.filter(r => r.result === '完成').length
      };
    });
  }

  /* CSV：由舊到新，加 BOM 讓 Excel 正確顯示中文；開頭是 = + - @ 的文字加上 ' 避免被當成公式 */
  function toCSV(records, nameOf) {
    const head = ['日期', '時間', '學生代號', '學生', '生字', '詞語', '結果', '讀音正確率', '釋義正確率', '讀音嘗試', '釋義嘗試', '驗證方式'];
    const esc = v => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const asc = records.slice().sort((a, b) => a.stamp.localeCompare(b.stamp));
    const lines = [head].concat(asc.map(r => [
      r.date, r.time, r.student, nameOf ? nameOf(r.student) : r.student, r.char, r.word, r.result,
      r.wordScore, r.defScore, r.wordTries, r.defTries, r.method
    ]));
    return '﻿' + lines.map(l => l.map(esc).join(',')).join('\r\n');
  }

  return { build, toCSV, OTHER };
})();
