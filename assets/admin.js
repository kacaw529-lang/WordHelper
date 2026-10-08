(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const HAN = /\p{Script=Han}/u;
  let PIN = '';
  let students = [];
  let settings = [];

  try { PIN = sessionStorage.getItem('tutor.pin') || ''; } catch (err) { /* 忽略 */ }

  const call = (action, extra) => Api.post(Object.assign({ action, pin: PIN }, extra || {}));

  function msg(id, text, isError) {
    const el = $(id);
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    (children || []).forEach(c => n.append(c));
    return n;
  }

  /* ───────── 登入 ───────── */

  async function login(pin) {
    PIN = pin;
    const data = await call('adminData');
    try { sessionStorage.setItem('tutor.pin', pin); } catch (err) { /* 忽略 */ }
    students = data.students;
    settings = data.settings;
    $('login').hidden = true;
    $('panel').hidden = false;
    renderStudents();
    renderSettings();
    fillStudentSelect();
    $('log-to').value = DateTW.today();
    $('log-from').value = DateTW.addDays(DateTW.today(), -6);
    resetAssignForm();
    await loadAssignments();
    fillScope(true);
    loadLogs();
  }

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    msg('login-msg', '登入中…');
    try {
      await login($('pin').value.trim());
    } catch (err) {
      msg('login-msg', err.message, true);
    }
  });

  $('logout').addEventListener('click', () => {
    try { sessionStorage.removeItem('tutor.pin'); } catch (err) { /* 忽略 */ }
    location.reload();
  });

  /* ───────── 分頁 ───────── */

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + btn.dataset.tab; });
    });
  });

  /* ───────── 學生 ───────── */

  const studentLink = s => {
    const url = new URL('index.html', location.href);
    url.search = new URLSearchParams({ u: s.id, k: s.key }).toString();
    return url.href;
  };

  function renderStudents() {
    const body = $('stu-body');
    body.innerHTML = '';
    students.forEach((s, i) => {
      const id = el('input', { className: 'input', value: s.id, readOnly: !s.isNew, ariaLabel: '代號' });
      id.addEventListener('input', () => { s.id = id.value.trim(); });
      const name = el('input', { className: 'input', value: s.name, ariaLabel: '暱稱' });
      name.addEventListener('input', () => { s.name = name.value.trim(); });
      const grade = el('select', { className: 'input', ariaLabel: '年級' });
      for (let g = 1; g <= 6; g++) grade.append(el('option', { value: g, textContent: g + ' 年級', selected: Number(s.grade) === g }));
      grade.addEventListener('change', () => { s.grade = Number(grade.value); });
      const on = el('input', { type: 'checkbox', checked: s.enabled !== false, ariaLabel: '啟用' });
      on.addEventListener('change', () => { s.enabled = on.checked; });

      let linkCell;
      if (s.key && !s.isNew) {
        const link = el('input', { className: 'input', value: studentLink(s), readOnly: true, ariaLabel: s.name + ' 的專屬連結' });
        const copy = el('button', { className: 'btn btn-text', type: 'button', textContent: '複製' });
        copy.addEventListener('click', () => copyText(link, copy));
        const reset = el('button', { className: 'btn btn-text', type: 'button', textContent: '換新連結' });
        reset.addEventListener('click', () => {
          s.key = '';
          msg('stu-msg', '按「儲存學生」後產生新連結，舊連結會失效。');
          renderStudents();
        });
        linkCell = el('div', { className: 'link-cell' }, [link, copy, reset]);
      } else {
        linkCell = el('span', { className: 'tag', textContent: '儲存後產生' });
      }
      body.append(el('tr', {}, [
        el('td', {}, [id]), el('td', {}, [name]), el('td', {}, [grade]), el('td', {}, [on]), el('td', {}, [linkCell])
      ]));
    });
  }

  async function copyText(input, btn) {
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (err) {
      input.select();
      document.execCommand('copy');
    }
    btn.textContent = '已複製';
    setTimeout(() => { btn.textContent = '複製'; }, 1500);
  }

  $('stu-add').addEventListener('click', () => {
    let n = students.length + 1;
    const ids = new Set(students.map(s => s.id));
    while (ids.has('S' + String(n).padStart(2, '0'))) n++;
    students.push({ id: 'S' + String(n).padStart(2, '0'), name: '', grade: 3, key: '', enabled: true, isNew: true });
    renderStudents();
  });

  $('stu-save').addEventListener('click', async () => {
    msg('stu-msg', '儲存中…');
    try {
      const data = await call('adminSaveStudents', { students });
      students = data.students;
      renderStudents();
      fillStudentSelect();
      if (!$('as-id').value) renderTargets(['全部']);
      msg('stu-msg', '已儲存學生');
    } catch (err) {
      msg('stu-msg', err.message, true);
    }
  });

  function fillStudentSelect() {
    const sel = $('log-student');
    const keep = sel.value;
    sel.innerHTML = '';
    sel.append(el('option', { value: '', textContent: '全部' }));
    students.forEach(s => sel.append(el('option', { value: s.id, textContent: s.name ? s.name + '（' + s.id + '）' : s.id })));
    sel.value = keep;
  }

  /* ───────── 設定 ───────── */

  function renderSettings() {
    const form = $('set-form');
    form.innerHTML = '';
    settings.forEach(d => {
      let input;
      let note = d.desc;
      if (d.type === 'select') {
        input = el('select', { className: 'input', name: d.key });
        d.options.forEach(o => input.append(el('option', { value: o[0], textContent: o[1], selected: o[0] === d.value })));
      } else {
        input = el('input', {
          className: 'input', type: 'number', name: d.key, value: d.value,
          min: d.min, max: d.max, step: d.key === 'rate' ? 0.1 : 1
        });
        note += '（' + d.min + '～' + d.max + '）';
      }
      form.append(el('label', {}, [el('span', { textContent: d.name }), input, el('small', { textContent: note })]));
    });
  }

  $('set-save').addEventListener('click', async () => {
    const out = {};
    $('set-form').querySelectorAll('input, select').forEach(i => { out[i.name] = i.tagName === 'SELECT' ? i.value : Number(i.value); });
    msg('set-msg', '儲存中…');
    try {
      const data = await call('adminSaveSettings', { settings: out });
      settings = data.settings;
      renderSettings();
      msg('set-msg', '已儲存設定，學生下次開啟時生效');
    } catch (err) {
      msg('set-msg', err.message, true);
    }
  });

  /* ───────── 詞語 ───────── */

  $('word-form').addEventListener('submit', async e => {
    e.preventDefault();
    const ch = Array.from($('word-char').value.trim()).filter(c => HAN.test(c)).slice(-1).join('');
    if (!ch) return msg('word-msg', '請輸入一個國字', true);
    $('word-char').value = ch;
    msg('word-msg', '查詢中…');
    try {
      const data = await call('adminWords', { char: ch });
      renderWords(data.words);
      msg('word-msg', '共 ' + data.words.length + ' 個詞語');
    } catch (err) {
      msg('word-msg', err.message, true);
    }
  });

  function renderWords(list) {
    const body = $('word-body');
    body.innerHTML = '';
    list.forEach(w => {
      const lv = el('select', { className: 'input', ariaLabel: w.w + ' 的難度' });
      for (let g = 1; g <= 6; g++) lv.append(el('option', { value: g, textContent: g + ' 年級起', selected: w.lv === g }));
      const blocked = el('input', { type: 'checkbox', checked: !!w.blocked, ariaLabel: '封鎖 ' + w.w });
      const te = el('textarea', { className: 'input te-input', value: w.te || '', rows: 2, maxLength: 80,
        placeholder: '可留白', ariaLabel: w.w + ' 的老師解釋' });
      const status = el('span', { className: 'form-msg' });
      const save = async () => {
        status.textContent = '儲存中…';
        try {
          await call('adminUpdateWord', { row: w.row, word: w.w, lv: Number(lv.value), blocked: blocked.checked, te: te.value.trim() });
          status.textContent = '已儲存';
        } catch (err) {
          status.textContent = err.message;
        }
      };
      lv.addEventListener('change', save);
      blocked.addEventListener('change', save);
      te.addEventListener('change', save);
      body.append(el('tr', {}, [
        el('td', { className: 'kai', textContent: w.w }),
        el('td', { textContent: w.z }),
        el('td', { className: 'wrap', textContent: w.d }),
        el('td', { className: 'wrap' }, [te]),
        el('td', {}, [lv]),
        el('td', {}, [el('div', { className: 'link-cell' }, [blocked, status])])
      ]));
    });
  }

  /* ───────── 指派生字 ───────── */

  let assignments = [];
  const HANS = v => {
    const seen = new Set();
    return Array.from(String(v || '')).filter(c => HAN.test(c) && !seen.has(c) && seen.add(c));
  };

  function renderTargets(selected) {
    const box = $('as-targets');
    box.innerHTML = '';
    const all = !selected || !selected.length || selected.includes('全部');
    const allBox = el('input', { type: 'checkbox', value: '全部', checked: all });
    box.append(el('label', { className: 'check' }, [allBox, '全部學生']));
    const boxes = students.filter(s => s.enabled !== false).map(s => {
      const cb = el('input', { type: 'checkbox', value: s.id, checked: !all && selected.includes(s.id), disabled: all });
      box.append(el('label', { className: 'check' }, [cb, s.name || s.id]));
      return cb;
    });
    allBox.addEventListener('change', () => boxes.forEach(cb => { cb.disabled = allBox.checked; if (allBox.checked) cb.checked = false; }));
  }

  function selectedTargets() {
    const boxes = Array.from($('as-targets').querySelectorAll('input[type=checkbox]'));
    if (boxes[0] && boxes[0].checked) return ['全部'];
    return boxes.slice(1).filter(cb => cb.checked).map(cb => cb.value);
  }

  function resetAssignForm() {
    $('as-id').value = '';
    $('as-title').value = '';
    $('as-chars').value = '';
    $('as-start').value = DateTW.today();
    $('as-end').value = DateTW.addDays(DateTW.today(), 6);
    $('as-save').textContent = '新增指派';
    $('as-cancel').hidden = true;
    renderTargets(['全部']);
  }

  function editAssignment(a) {
    $('as-id').value = a.id;
    $('as-title').value = a.title;
    $('as-chars').value = a.chars;
    $('as-start').value = DateTW.normalize(a.start);
    $('as-end').value = DateTW.normalize(a.end);
    $('as-save').textContent = '儲存修改';
    $('as-cancel').hidden = false;
    renderTargets(a.targets);
    $('as-title').focus();
    msg('as-msg', '修改後按「儲存修改」');
  }

  $('as-cancel').addEventListener('click', () => { resetAssignForm(); msg('as-msg', ''); });

  $('as-form').addEventListener('submit', async e => {
    e.preventDefault();
    const chars = HANS($('as-chars').value);
    if (!chars.length) return msg('as-msg', '請輸入至少一個生字', true);
    const start = DateTW.normalize($('as-start').value);
    const end = DateTW.normalize($('as-end').value);
    if (!start || !end) return msg('as-msg', '請選擇開始與結束日期', true);
    if (end < start) return msg('as-msg', '結束日期不能早於開始日期', true);
    const targets = selectedTargets();
    if (!targets.length) return msg('as-msg', '請選擇指派對象', true);
    msg('as-msg', '儲存中…');
    try {
      const data = await call('adminSaveAssignment', {
        assignment: { id: $('as-id').value, title: $('as-title').value.trim(), chars: chars.join(''), start, end, targets }
      });
      assignments = data.assignments;
      renderAssignments();
      fillScope(false);
      resetAssignForm();
      msg('as-msg', '已儲存指派');
    } catch (err) {
      msg('as-msg', err.message, true);
    }
  });

  async function loadAssignments() {
    try {
      const data = await call('adminAssignments');
      assignments = data.assignments;
      renderAssignments();
    } catch (err) {
      msg('as-msg', err.message, true);
    }
  }

  const md = ymd => {
    const p = DateTW.normalize(ymd).split('-');
    return p.length === 3 ? Number(p[1]) + '/' + Number(p[2]) : '';
  };

  function renderAssignments() {
    const body = $('as-body');
    body.innerHTML = '';
    if (!assignments.length) {
      body.append(el('tr', {}, [el('td', { colSpan: 6, textContent: '還沒有指派' })]));
      return;
    }
    assignments.forEach(a => {
      const progress = el('div', { className: 'progress-list' }, a.progress.map(p =>
        el('span', { className: 'tag' + (p.total && p.done === p.total ? ' tag-done' : ''), textContent: nameOf(p.id) + ' ' + p.done + '／' + p.total })));
      const edit = el('button', { className: 'btn btn-text', type: 'button', textContent: '編輯' });
      edit.addEventListener('click', () => editAssignment(a));
      const del = el('button', { className: 'btn btn-text', type: 'button', textContent: '刪除' });
      del.addEventListener('click', async () => {
        if (!confirm('確定刪除「' + a.title + '」？練習紀錄不會被刪除。')) return;
        try {
          const data = await call('adminDeleteAssignment', { id: a.id });
          assignments = data.assignments;
          renderAssignments();
          fillScope(false);
        } catch (err) {
          msg('as-msg', err.message, true);
        }
      });
      body.append(el('tr', {}, [
        el('td', {}, [el('span', { className: 'tag' + (a.status === '進行中' ? ' tag-live' : ''), textContent: a.status })]),
        el('td', { textContent: a.title }),
        el('td', { className: 'kai', textContent: a.chars }),
        el('td', { textContent: md(a.start) + '～' + md(a.end) }),
        el('td', { className: 'wrap' }, [progress]),
        el('td', {}, [el('div', { className: 'link-cell' }, [edit, del])])
      ]));
    });
  }

  /* ───────── 紀錄 ───────── */

  const setting = (k, def) => {
    const d = settings.find(x => x.key === k);
    return d && d.value !== undefined && d.value !== '' ? d.value : def;
  };
  let report = null;
  let range = { from: '', to: '', title: '' };

  /* 範圍：進行中的指派排最前面，最後是「依日期查詢」 */
  function fillScope(pickDefault) {
    const sel = $('log-scope');
    const keep = sel.value;
    const rank = { '進行中': 0, '尚未開始': 1, '已結束': 2 };
    const list = assignments.slice().sort((x, y) => (rank[x.status] - rank[y.status]) || DateTW.normalize(y.start).localeCompare(DateTW.normalize(x.start)));
    sel.innerHTML = '';
    list.forEach(a => sel.append(el('option', { value: a.id, textContent: a.title + '（' + md(a.start) + '～' + md(a.end) + '，' + a.status + '）' })));
    sel.append(el('option', { value: 'date', textContent: '依日期查詢' }));
    const live = list.find(a => a.status === '進行中');
    if (!pickDefault && Array.from(sel.options).some(o => o.value === keep)) sel.value = keep;
    else sel.value = live ? live.id : 'date';
    $('log-dates').hidden = sel.value !== 'date';
  }

  $('log-scope').addEventListener('change', () => {
    $('log-dates').hidden = $('log-scope').value !== 'date';
    loadLogs();
  });
  $('log-student').addEventListener('change', () => loadLogs());
  $('log-form').addEventListener('submit', e => { e.preventDefault(); loadLogs(); });

  async function loadLogs() {
    const a = assignments.find(x => x.id === $('log-scope').value);
    let from, to;
    if (a) {
      from = DateTW.normalize(a.start);
      to = DateTW.normalize(a.end);
    } else {
      from = DateTW.normalize($('log-from').value);
      to = DateTW.normalize($('log-to').value);
      if (from && to && from > to) return msg('log-msg', '開始日期不能晚於結束日期', true);
    }
    const who = $('log-student').value;
    msg('log-msg', '查詢中…');
    try {
      const data = await call('adminLogs', { from, to, student: who });
      const targets = a ? a.targets : null;
      const roster = students
        .filter(s => s.enabled !== false)
        .filter(s => !targets || targets.includes('全部') || targets.includes(s.id))
        .filter(s => !who || s.id === who)
        .map(s => ({ id: s.id, name: s.name || s.id }));
      report = Report.build(data.rows, {
        students: roster,
        chars: a ? Array.from(a.chars) : null,
        mode: a ? 'assign' : 'date',
        need: Number(setting('rounds', 3)),
        defPass: Number(setting('defPass', 80)),
        skipAfter: Number(setting('skipAfter', 3)),
        includeOthers: !a
      });
      range = { from, to, title: a ? a.title : '' };
      closeCellDetail();
      renderMatrix();
      renderAttention();
      renderSummary(report.records);
      renderDetails();
      const cut = data.rows.length >= 3000 ? '（只顯示最近 3000 筆，請縮小範圍）' : '';
      msg('log-msg', (a ? '' : md(from) + '～' + md(to) + '，') + '共 ' + report.records.length + ' 筆' + cut, !!cut);
    } catch (err) {
      msg('log-msg', err.message, true);
    }
  }

  const nameOf = id => {
    const s = students.find(x => x.id === id);
    return s && s.name ? s.name : id;
  };
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const show = v => (v === null || v === undefined || v === '' ? '—' : String(v));
  const shortStamp = st => {
    const [d, t] = String(st || '').split(' ');
    return d ? md(d) + ' ' + String(t || '').slice(0, 5) : '';
  };

  /* ── 第一層：進度矩陣 ── */

  function renderMatrix() {
    const table = $('matrix');
    table.innerHTML = '';
    const rp = report;
    const need = Number(setting('rounds', 3));
    if (!rp.cols.length || !rp.matrix.length) {
      table.append(el('tbody', {}, [el('tr', {}, [el('td', { className: 'empty', textContent: rp.matrix.length ? '這段期間沒有練習紀錄' : '沒有符合的學生' })])]));
      return;
    }
    const head = el('tr', {}, [el('th', { className: 'mx-name', textContent: '學生' })]);
    rp.cols.forEach(c => head.append(el('th', { className: 'mx-col' + (c === Report.OTHER ? ' mx-other' : ' kai'), textContent: c === Report.OTHER ? '自選' : c, title: c === Report.OTHER ? '不在這次指派裡的生字' : '' })));
    head.append(el('th', { className: 'num mx-total', textContent: '完成' }));
    table.append(el('thead', {}, [head]));

    const body = el('tbody');
    rp.matrix.forEach(m => {
      const tr = el('tr', {}, [el('th', { className: 'mx-name', scope: 'row', textContent: m.name })]);
      rp.cols.forEach(c => {
        const cell = m.cells[c];
        const isOther = c === Report.OTHER;
        let main;
        let sub = '';
        if (cell.status === 'done') main = isOther ? cell.done + ' 詞' : '✔';
        else if (cell.status === 'partial') main = isOther ? cell.done + ' 詞' : cell.done + '／' + need;
        else main = '·';
        if (cell.status !== 'none') sub = cell.selfOnly ? '自評' : (cell.def !== null ? String(cell.def) : '');
        const label = m.name + '，' + (isOther ? '自選生字' : '「' + c + '」') + '：' +
          (cell.status === 'done' ? '完成' : cell.status === 'partial' ? '完成 ' + cell.done + ' 個詞' : '還沒練習') +
          (cell.def !== null ? '，解釋平均 ' + cell.def + ' 分' : '') +
          (cell.skip ? '，跳過 ' + cell.skip + ' 次' : '') + (cell.selfOnly ? '，未經辨識' : '');
        const btn = el('button', {
          type: 'button',
          className: 'mx-cell is-' + cell.status + (cell.warn ? ' is-warn' : '') + (cell.low ? ' is-low' : '') + (cell.selfOnly ? ' is-self' : ''),
          disabled: !cell.records.length,
          title: label
        }, [el('span', { className: 'm', textContent: main }), el('span', { className: 's', textContent: sub })]);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => toggleCellDetail(btn, m.name + '・' + (isOther ? '自選生字' : '「' + c + '」'), cell.records, false));
        tr.append(el('td', { className: 'mx' }, [btn]));
      });
      tr.append(el('td', { className: 'num mx-total', textContent: m.charsDone + '／' + rp.chars.length + ' 字' }));
      body.append(tr);
    });
    table.append(body);

    const foot = el('tr', {}, [el('th', { className: 'mx-name', scope: 'row', textContent: '全班' })]);
    rp.cols.forEach(c => {
      const k = rp.classRow[c];
      const isOther = c === Report.OTHER;
      const main = isOther ? k.records.filter(r => r.result === '完成').length + ' 詞' : k.done + '／' + k.total;
      const sub = k.def !== null ? String(k.def) : '';
      const label = '全班' + (isOther ? '自選生字' : '「' + c + '」') + '：' + (isOther ? main : k.done + ' 人完成') +
        (k.def !== null ? '，解釋平均 ' + k.def + ' 分' : '') + (k.skip ? '，跳過 ' + k.skip + ' 次' : '');
      const btn = el('button', {
        type: 'button',
        className: 'mx-cell mx-class' + (k.warn ? ' is-warn' : '') + (k.low ? ' is-low' : '') + (!isOther && k.total && k.done === k.total ? ' is-all' : ''),
        disabled: !k.records.length,
        title: label
      }, [el('span', { className: 'm', textContent: main }), el('span', { className: 's', textContent: sub })]);
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => toggleCellDetail(btn, '全班・' + (isOther ? '自選生字' : '「' + c + '」'), k.records, true));
      foot.append(el('td', { className: 'mx' }, [btn]));
    });
    const allDone = rp.matrix.filter(m => rp.chars.length && m.charsDone === rp.chars.length).length;
    foot.append(el('td', { className: 'num mx-total', textContent: allDone + '／' + rp.matrix.length + ' 人' }));
    table.append(el('tfoot', {}, [foot]));
  }

  let openCell = null;

  function closeCellDetail() {
    if (openCell) openCell.setAttribute('aria-expanded', 'false');
    openCell = null;
    $('cell-detail').hidden = true;
    $('cell-detail').innerHTML = '';
  }

  function toggleCellDetail(btn, title, records, withStudent) {
    if (openCell === btn) return closeCellDetail();
    closeCellDetail();
    openCell = btn;
    btn.setAttribute('aria-expanded', 'true');
    const box = $('cell-detail');
    const close = el('button', { className: 'btn btn-text', type: 'button', textContent: '收起' });
    close.addEventListener('click', closeCellDetail);
    const head = ['日期', '時間'].concat(withStudent ? ['學生'] : [], ['生字', '詞語', '結果', '讀音', '解釋', '嘗試', '驗證方式']);
    const tbody = el('tbody');
    records.forEach(r => tbody.append(recordRow(r, withStudent)));
    box.append(
      el('div', { className: 'cd-head' }, [el('h3', { textContent: title }), close]),
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table' }, [
        el('thead', {}, [el('tr', {}, head.map(h => el('th', { className: ['讀音', '解釋', '嘗試'].includes(h) ? 'num' : '', textContent: h })))]),
        tbody
      ])])
    );
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function resultTag(r) {
    return el('span', { className: 'tag' + (r.result === '跳過' ? ' tag-red' : r.result === '換詞' ? ' tag-muted' : ''), textContent: r.result });
  }

  function recordRow(r, withStudent) {
    const cells = [el('td', { textContent: r.date }), el('td', { textContent: r.time })];
    if (withStudent) cells.push(el('td', { textContent: nameOf(r.student) }));
    cells.push(
      el('td', { className: 'kai', textContent: r.char }),
      el('td', { className: 'kai', textContent: r.word }),
      el('td', {}, [resultTag(r)]),
      el('td', { className: 'num', textContent: show(r.wordScore) }),
      el('td', { className: 'num', textContent: show(r.defScore) }),
      el('td', { className: 'num', textContent: show(r.wordTries) + '／' + show(r.defTries) }),
      el('td', { className: r.method === '自動辨識' ? '' : 'warn-text', textContent: r.method })
    );
    return el('tr', {}, cells);
  }

  /* ── 第二層：需要注意 ── */

  function renderAttention() {
    const body = $('att-body');
    body.innerHTML = '';
    const list = report.attention;
    $('att-count').textContent = list.length ? list.length + ' 項' : '';
    if (!list.length) {
      body.append(el('tr', {}, [el('td', { colSpan: 6, className: 'empty', textContent: '目前沒有需要注意的紀錄' })]));
      return;
    }
    const tone = { skip: ' tag-red', device: ' tag-red', start: ' tag-muted', tries: '', swap: '' };
    list.slice(0, 200).forEach(it => {
      body.append(el('tr', {}, [
        el('td', { textContent: it.name }),
        el('td', {}, [el('span', { className: 'tag' + (tone[it.kind] || ''), textContent: it.label })]),
        el('td', { className: 'kai', textContent: it.char || '' }),
        el('td', { className: 'kai', textContent: it.word || '' }),
        el('td', { className: 'wrap' }, attText(it)),
        el('td', { textContent: shortStamp(it.last) })
      ]));
    });
  }

  function attText(it) {
    if (!it.records || !it.records.length) return [it.text];
    const btn = el('button', { className: 'btn btn-text btn-inline', type: 'button', textContent: '查看' });
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => toggleCellDetail(btn, it.name + '・念了較多次的詞', it.records, false));
    return [it.text + ' ', btn];
  }

  /* ── 學生摘要 ── */

  function renderSummary(rows) {
    const by = {};
    rows.forEach(r => {
      const g = by[r.student] || (by[r.student] = { done: 0, skip: 0, swap: 0, ws: [], ds: [], auto: 0, total: 0, last: '' });
      if (r.result === '完成') g.done++;
      else if (r.result === '跳過') g.skip++;
      else if (r.result === '換詞') g.swap++;
      if (r.result !== '換詞') {
        g.total++;
        if (r.method === '自動辨識') {
          g.auto++;
          if (typeof r.wordScore === 'number') g.ws.push(r.wordScore);
          if (typeof r.defScore === 'number') g.ds.push(r.defScore);
        }
      }
      const stamp = r.date + ' ' + r.time;
      if (stamp > g.last) g.last = stamp;
    });
    const body = $('sum-body');
    body.innerHTML = '';
    const ids = report.matrix.map(m => m.id).filter(id => by[id]);
    if (!ids.length) {
      body.append(el('tr', {}, [el('td', { colSpan: 8, className: 'empty', textContent: '這段期間沒有練習紀錄' })]));
      return;
    }
    ids.forEach(id => {
      const g = by[id];
      const w = avg(g.ws);
      const d = avg(g.ds);
      const autoRate = g.total ? Math.round(g.auto / g.total * 100) : null;
      body.append(el('tr', {}, [
        el('td', { textContent: nameOf(id) }),
        el('td', { className: 'num', textContent: g.done }),
        el('td', { className: 'num' + (g.skip ? ' warn-text' : ''), textContent: g.skip }),
        el('td', { className: 'num', textContent: g.swap }),
        el('td', { className: 'num', textContent: w === null ? '—' : w + ' 分' }),
        el('td', { className: 'num', textContent: d === null ? '—' : d + ' 分' }),
        el('td', { className: 'num' + (autoRate !== null && autoRate < 50 ? ' warn-text' : ''), textContent: autoRate === null ? '—' : autoRate + '%' }),
        el('td', { textContent: g.last.slice(0, 16) })
      ]));
    });
  }

  /* ── 第三層：依學生分組的明細 ── */

  function renderDetails() {
    const box = $('det-list');
    box.innerHTML = '';
    const gs = report.groups;
    $('det-toggle').textContent = '全部展開';
    $('det-toggle').hidden = !gs.length;
    $('det-csv').disabled = !report.records.length;
    if (!gs.length) {
      box.append(el('p', { className: 'tab-note', textContent: '這段期間沒有練習紀錄' }));
      return;
    }
    gs.forEach(g => {
      const m = report.matrix.find(x => x.id === g.id);
      const meta = g.rows.length + ' 筆・完成 ' + g.done + ' 個詞' +
        (m && report.chars.length ? '、' + m.charsDone + '／' + report.chars.length + ' 個字' : '') +
        '・最近 ' + shortStamp(g.last);
      const tbody = el('tbody');
      g.rows.forEach(r => {
        tbody.append(el('tr', { className: (r.newDate ? 'grp-date' : r.newChar ? 'grp-char' : '') }, [
          el('td', { className: 'muted-cell', textContent: r.newDate ? md(r.date) : '' }),
          el('td', { className: 'kai', textContent: r.newChar ? r.char : '' }),
          el('td', { className: 'kai', textContent: r.word }),
          el('td', {}, [resultTag(r)]),
          el('td', { className: 'num', textContent: show(r.wordScore) }),
          el('td', { className: 'num', textContent: show(r.defScore) }),
          el('td', { className: 'num', textContent: show(r.wordTries) + '／' + show(r.defTries) }),
          el('td', { className: r.method === '自動辨識' ? '' : 'warn-text', textContent: r.method }),
          el('td', { className: 'muted-cell', textContent: r.time.slice(0, 5) })
        ]));
      });
      const table = el('table', { className: 'table det-table' }, [
        el('thead', {}, [el('tr', {}, ['日期', '生字', '詞語', '結果', '讀音', '解釋', '嘗試', '驗證方式', '時間']
          .map(h => el('th', { className: ['讀音', '解釋', '嘗試'].includes(h) ? 'num' : '', textContent: h })))]),
        tbody
      ]);
      box.append(el('details', { className: 'det' }, [
        el('summary', {}, [el('span', { className: 'det-name', textContent: g.name }), el('span', { className: 'det-meta', textContent: meta })]),
        el('div', { className: 'table-wrap' }, [table])
      ]));
    });
  }

  $('det-toggle').addEventListener('click', () => {
    const all = Array.from(document.querySelectorAll('#det-list details'));
    const open = !all.every(d => d.open);
    all.forEach(d => { d.open = open; });
    $('det-toggle').textContent = open ? '全部收合' : '全部展開';
  });

  $('det-csv').addEventListener('click', () => {
    if (!report || !report.records.length) return;
    const csv = Report.toCSV(report.records, nameOf);
    const name = '練習紀錄_' + (range.title ? range.title + '_' : '') + (range.from || '') + '_' + (range.to || '') + '.csv';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = el('a', { href: url, download: name.replace(/[\\/:*?"<>|]/g, '') });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* 重新整理時自動登入 */
  if (PIN) login(PIN).catch(() => { PIN = ''; });
})();
