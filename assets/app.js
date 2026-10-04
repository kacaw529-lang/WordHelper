(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const HAN = /\p{Script=Han}/u;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { /* 無痕模式等情況 */ } }
  };
  const METHOD = { auto: '自動辨識', record: '錄音自評', self: '自評' };
  const PRAISE = ['好棒！', '念對了！', '很棒喔！', '太厲害了！'];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const S = {
    cred: null, student: null, settings: null, mode: 'auto', assignments: [],
    char: '', queue: [], round: 0, results: [],
    cur: null, step: 'word',
    segs: [], segIdx: 0, segScores: [],   // 第二關：分句跟讀
    tries: 0, best: 0,                     // tries：這一關累計嘗試；best：目前這一句（或詞語）的最高分
    token: 0, listening: false, recording: false, micGranted: false, prompted: false,
    session: '', seq: 0, busy: false, composing: false
  };

  /* ───────── 啟動 ───────── */

  async function boot() {
    $('source').textContent = window.APP_CONFIG.SOURCE_NOTE;
    if (handleInAppBrowser()) return;
    setupViewport();
    setupInput();
    bindButtons();

    S.cred = readCred();
    if (!S.cred) return fail('請用老師給你的專屬連結打開這個網頁。');

    try {
      const [info] = await Promise.all([
        Api.get({ action: 'init', u: S.cred.u, k: S.cred.k }),
        Speaker.init()
      ]);
      S.student = info;
      S.settings = info.settings;
      S.assignments = info.assignments || [];
      await loadCharmap(info.charmapVersion);
      S.mode = Listener.supported() ? 'auto' : (Recorder.supported() ? 'record' : 'self');
      renderHome();
      show('home');
      flushPending();
    } catch (err) {
      fail(err.message);
    }
  }

  function readCred() {
    const q = new URLSearchParams(location.search);
    const u = q.get('u');
    const k = q.get('k');
    if (u && k) {
      store.set('tutor.cred', { u, k });
      return { u, k };
    }
    const saved = store.get('tutor.cred');
    return saved && saved.u && saved.k ? saved : null;
  }

  async function loadCharmap(ver) {
    const cached = store.get('tutor.charmap');
    if (cached && cached.v === ver && cached.map) {
      Matcher.setCharmap(cached.map);
      return;
    }
    try {
      const data = await Api.get({ action: 'charmap', u: S.cred.u, k: S.cred.k });
      Matcher.setCharmap(data.map);
      store.set('tutor.charmap', { v: ver, map: data.map });
    } catch (err) {
      // 沒有字音表仍可運作，只是同音字容錯會變差
    }
  }

  function handleInAppBrowser() {
    const ua = navigator.userAgent || '';
    if (/\bLine\/\d/i.test(ua)) {
      const url = new URL(location.href);
      if (url.searchParams.get('openExternalBrowser') !== '1') {
        url.searchParams.set('openExternalBrowser', '1');
        location.replace(url.href);
        return true;
      }
      showBanner('如果還在 LINE 裡面，請點右下角「⋯」，選「用預設瀏覽器開啟」。');
    } else if (/FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(ua)) {
      showBanner('請點右上角「⋯」，選「用瀏覽器開啟」，才能使用麥克風。');
    }
    return false;
  }

  /* 鍵盤避讓：用可視區域高度排版，輸入框聚焦時捲到畫面中間 */
  function setupViewport() {
    const vv = window.visualViewport;
    const apply = () => document.documentElement.style.setProperty('--vvh', (vv ? vv.height : window.innerHeight) + 'px');
    apply();
    (vv || window).addEventListener('resize', apply);
    $('char-input').addEventListener('focus', () => {
      setTimeout(() => $('char-input').scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
    });
  }

  /* 注音輸入法：選字（組字）期間不能改動輸入框，也不要設定 maxlength */
  function setupInput() {
    const input = $('char-input');
    input.addEventListener('compositionstart', () => { S.composing = true; });
    input.addEventListener('compositionend', () => { S.composing = false; keepOneChar(); });
    input.addEventListener('input', () => { if (!S.composing) keepOneChar(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.isComposing || S.composing || e.keyCode === 229)) e.preventDefault();
    });
    $('char-form').addEventListener('submit', e => {
      e.preventDefault();
      if (S.composing) return;
      const ch = currentChar();
      if (ch) startPractice(ch);
    });
  }

  function keepOneChar() {
    const input = $('char-input');
    const hans = Array.from(input.value).filter(c => HAN.test(c));
    const next = hans.length ? hans[hans.length - 1] : '';
    if (input.value !== next) input.value = next;
    $('btn-start').disabled = !next || S.busy;
    setHint('', false);
  }

  const currentChar = () => {
    const v = Array.from($('char-input').value).filter(c => HAN.test(c));
    return v.length === 1 ? v[0] : '';
  };

  /* ───────── 畫面 ───────── */

  function show(name) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + name; });
    window.scrollTo(0, 0);
  }

  function fail(msg) {
    $('error-text').textContent = msg;
    show('error');
  }

  function showBanner(msg) {
    const b = $('banner');
    b.textContent = msg;
    b.hidden = false;
  }

  function setHint(msg, isError) {
    const h = $('char-hint');
    h.textContent = msg || '';
    h.classList.toggle('is-error', !!isError);
  }

  function renderHome() {
    $('hello').textContent = S.student.name + '，你好！';
    $('char-input').value = '';
    $('btn-start').disabled = true;
    setHint('', false);
    renderAssignments();
    const notes = [];
    if (S.mode === 'record') notes.push('這個瀏覽器不能自動聽你念，會改成「錄下來，自己聽聽看」。');
    if (S.mode === 'self') notes.push('這個瀏覽器不能使用麥克風，念完後請自己按「我念好了」。');
    if (!Speaker.hasVoice()) notes.push('這台裝置沒有台灣國語語音，請看注音自己念念看。');
    $('mode-note').textContent = notes.join('');
    $('mode-note').hidden = !notes.length;
  }

  const monthDay = ymd => {
    const m = DateTW.normalize(ymd).split('-');
    return m.length === 3 ? Number(m[1]) + '/' + Number(m[2]) : '';
  };

  /* 老師指派的生字：點一下就開始練 */
  function renderAssignments() {
    const list = S.assignments || [];
    const box = $('assign-list');
    box.innerHTML = '';
    $('assign').hidden = !list.length;
    $('screen-home').classList.toggle('has-assign', list.length > 0);
    $('free-label').textContent = list.length ? '想練其他字？在格子裡打一個字' : '在格子裡打一個字';

    list.forEach(a => {
      const done = a.items.filter(x => x.done).length;
      const group = document.createElement('div');
      group.className = 'assign-group';
      const head = document.createElement('p');
      head.className = 'assign-name';
      head.textContent = a.title;
      const meta = document.createElement('p');
      meta.className = 'assign-meta';
      meta.textContent = done === a.items.length
        ? '全部完成了！'
        : monthDay(a.end) + ' 前完成，已完成 ' + done + '／' + a.items.length + ' 個';
      const row = document.createElement('div');
      row.className = 'assign-chars';
      a.items.forEach(it => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'assign-char' + (it.done ? ' is-done' : '');
        b.textContent = it.char;
        b.setAttribute('aria-label', it.char + (it.done ? '，已完成' : '，還沒完成'));
        b.addEventListener('click', () => startPractice(it.char));
        row.appendChild(b);
      });
      group.append(head, meta, row);
      box.appendChild(group);
    });
  }

  async function refreshAssignments() {
    try {
      await flushPending();
      const data = await Api.get({ action: 'assignments', u: S.cred.u, k: S.cred.k });
      S.assignments = data.assignments || [];
      if (!$('screen-home').hidden) renderAssignments();
    } catch (err) { /* 保留畫面上的資料 */ }
  }

  /* 練習結束時先在畫面上更新指派進度，不必等伺服器 */
  function bumpAssignments(ch, completed) {
    (S.assignments || []).forEach(a => a.items.forEach(it => {
      if (it.char !== ch) return;
      it.count += completed;
      it.done = it.count >= a.need;
    }));
  }

  function nextAssignedChar(exclude) {
    for (const a of S.assignments || []) {
      for (const it of a.items) if (!it.done && it.char !== exclude) return it.char;
    }
    return '';
  }

  function renderRounds() {
    const ol = $('rounds');
    ol.innerHTML = '';
    for (let i = 0; i < S.settings.rounds; i++) {
      const li = document.createElement('li');
      const r = S.results[i];
      li.className = r ? (r.result === '完成' ? 'is-done' : 'is-skipped') : (i === S.round ? 'is-current' : '');
      li.setAttribute('aria-label', '第 ' + (i + 1) + ' 個詞' + (r ? '：' + r.result : (i === S.round ? '：進行中' : '')));
      ol.appendChild(li);
    }
  }

  function renderWord(el, word, zhuyin) {
    const chars = Array.from(word);
    const syl = Matcher.splitZhuyin(zhuyin);
    const aligned = syl.length === chars.length;
    el.innerHTML = '';
    el.setAttribute('aria-label', word + (zhuyin ? '，注音 ' + zhuyin : ''));
    chars.forEach((c, i) => {
      const cell = document.createElement('span');
      cell.className = 'cell';
      const han = document.createElement('span');
      han.className = 'han';
      han.textContent = c;
      cell.appendChild(han);
      if (aligned) cell.appendChild(zhuyinEl(syl[i]));
      el.appendChild(cell);
    });
    if (!aligned && zhuyin) {
      const line = document.createElement('span');
      line.className = 'zy-line';
      line.textContent = zhuyin;
      el.appendChild(line);
    }
  }

  /* 直式注音：聲調符號在右側，輕聲點在上方 */
  function zhuyinEl(s) {
    const box = document.createElement('span');
    box.className = 'zy';
    box.setAttribute('aria-hidden', 'true');
    let light = false;
    let tone = '';
    if (s.startsWith('˙')) { light = true; s = s.slice(1); }
    const last = s.slice(-1);
    if ('ˊˇˋ'.includes(last)) { tone = last; s = s.slice(0, -1); }
    if (light) {
      const d = document.createElement('span');
      d.className = 'zy-light';
      d.textContent = '˙';
      box.appendChild(d);
    }
    const body = document.createElement('span');
    body.className = 'zy-body';
    Array.from(s).forEach(c => {
      const b = document.createElement('span');
      b.textContent = c;
      body.appendChild(b);
    });
    if (tone) {
      const t = document.createElement('span');
      t.className = 'zy-tone';
      t.textContent = tone;
      body.appendChild(t);
    }
    box.appendChild(body);
    return box;
  }

  /* 第二關：解釋／例句，切成短句，每個字可加注音 */
  function buildStageTwo(w) {
    const mode = S.settings.stage2;
    const hasEx = !!(w.ex && w.ex.trim());
    const blocks = [];
    if (mode === 'def' || mode === 'both' || !hasEx) blocks.push({ label: w.own ? '老師的解釋' : '解釋', text: w.d, zy: w.dz });
    if ((mode === 'ex' || mode === 'both') && hasEx) blocks.push({ label: '例句', text: w.ex, zy: w.exz });

    const wrap = $('reading');
    wrap.innerHTML = '';
    wrap.classList.toggle('zy-tap', S.settings.defZhuyin === 'tap');
    S.segs = [];
    blocks.forEach(b => {
      const block = document.createElement('div');
      block.className = 'read-block';
      const label = document.createElement('p');
      label.className = 'read-label';
      label.textContent = b.label;
      const p = document.createElement('p');
      p.className = 'read-text';
      p.lang = 'zh-Hant-TW';
      Matcher.segments(Matcher.tokens(b.text, b.zy)).forEach(toks => {
        const seg = document.createElement('span');
        seg.className = 'seg';
        const hanEls = [];
        toks.forEach(t => {
          if (!t.han) {
            const pu = document.createElement('span');
            pu.className = 'punct';
            pu.textContent = t.ch;
            // 標點和前一個字綁在一起，避免標點單獨換到下一行開頭
            const prev = seg.lastElementChild;
            if (prev && prev.classList.contains('rc')) {
              const keep = document.createElement('span');
              keep.className = 'keep';
              seg.replaceChild(keep, prev);
              keep.append(prev, pu);
            } else if (prev && prev.classList.contains('keep')) {
              prev.appendChild(pu);
            } else {
              seg.appendChild(pu);
            }
            return;
          }
          const rc = document.createElement('span');
          rc.className = 'rc';
          const h = document.createElement('span');
          h.className = 'rc-han';
          h.textContent = t.ch;
          rc.appendChild(h);
          if (S.settings.defZhuyin !== 'none' && t.zy) rc.appendChild(zhuyinEl(t.zy));
          seg.appendChild(rc);
          hanEls.push(rc);
        });
        p.appendChild(seg);
        S.segs.push({ el: seg, hanEls, text: toks.map(t => t.ch).join('') });
      });
      block.append(label, p);
      wrap.appendChild(block);
    });
    return blocks.map(b => b.label).join('和');
  }

  function renderSegments() {
    S.segs.forEach((s, i) => {
      s.el.classList.toggle('is-done', i < S.segIdx);
      s.el.classList.toggle('is-current', i === S.segIdx);
      s.el.classList.toggle('is-later', i > S.segIdx);
      s.hanEls.forEach(el => el.classList.remove('is-miss'));
    });
    const cur = S.segs[S.segIdx];
    if (cur) cur.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const total = S.segs.length;
    $('step-label').textContent = '第二關：念' + S.stageTwoName + (total > 1 ? '（第 ' + (S.segIdx + 1) + '／' + total + ' 句）' : '');
  }

  /* 標出沒念對的字 */
  function markMisses(hits) {
    if (S.step === 'word') {
      document.querySelectorAll('#word .han').forEach((el, i) => el.classList.toggle('is-miss', hits[i] === false));
      return;
    }
    const seg = S.segs[S.segIdx];
    if (seg) seg.hanEls.forEach((el, i) => el.classList.toggle('is-miss', hits[i] === false));
  }

  function clearMisses() {
    document.querySelectorAll('.is-miss').forEach(el => el.classList.remove('is-miss'));
  }

  function setHeard(t) { $('heard').textContent = t; }
  function setFeedback(t, tone) {
    const f = $('feedback');
    f.textContent = t;
    f.dataset.tone = tone || '';
  }

  function micLabel(state) {
    if (S.mode === 'auto') return state === 'listening' ? '念完了' : '換我念';
    if (S.mode === 'record') return state === 'recording' ? '停止錄音' : '錄下我念的';
    return '我念好了';
  }

  /* state：playing 播放中｜ready 等學生｜listening 收音中｜recording 錄音中｜checking 自評中｜locked 過關動畫 */
  function setControls(state) {
    const mic = $('btn-mic');
    mic.disabled = state === 'playing' || state === 'locked' || state === 'checking';
    mic.classList.toggle('is-live', state === 'listening' || state === 'recording');
    $('mic-label').textContent = micLabel(state);
    $('btn-listen').disabled = state !== 'ready' && state !== 'checking';
    $('btn-swap').disabled = state === 'locked' || S.queue.length === 0;
    $('self-check').hidden = state !== 'checking';
    $('btn-skip').classList.toggle('is-hidden', !(S.tries >= S.settings.skipAfter && (state === 'ready' || state === 'checking')));
    $('screen-practice').dataset.state = state;
  }

  function stamp() {
    const el = $('stamp');
    el.hidden = false;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
    setTimeout(() => { el.hidden = true; el.classList.remove('is-on'); }, 1200);
  }

  /* 簡短語音提示（老師可在設定關閉） */
  function say(text) {
    if (S.settings.voicePrompt !== 'on' || !Speaker.hasVoice()) return Promise.resolve();
    return Speaker.speak(text, 1);
  }

  /* ───────── 練習流程 ───────── */

  async function startPractice(ch) {
    if (S.busy) return;
    S.busy = true;
    const btn = $('btn-start');
    btn.disabled = true;
    btn.textContent = '找詞語中…';
    document.querySelectorAll('.assign-char').forEach(b => { b.disabled = true; });
    Speaker.unlock();
    Cue.unlock();
    try {
      const data = await Api.get({ action: 'words', u: S.cred.u, k: S.cred.k, char: ch });
      if (!data.words.length) {
        backHome();
        setHint('找不到適合的「' + ch + '」詞語，換一個字試試看。', true);
        return;
      }
      S.char = ch;
      S.queue = shuffle(data.words);
      S.round = 0;
      S.results = [];
      S.prompted = false;
      S.session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      S.seq = 0;
      $('char-input').blur();
      $('seed-char').textContent = ch;
      show('practice');
      nextWord();
    } catch (err) {
      backHome();
      setHint(err.message, true);
    } finally {
      S.busy = false;
      btn.textContent = '開始練習';
      btn.disabled = !currentChar();
      document.querySelectorAll('.assign-char').forEach(b => { b.disabled = false; });
    }
  }

  /* 從完成頁直接開始時若失敗，回到首頁顯示原因 */
  function backHome() {
    if (!$('screen-home').hidden) return;
    renderHome();
    show('home');
  }

  function shuffle(words) {
    const a = words.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function stopAll() {
    S.token++;
    Speaker.cancel();
    Listener.abort();
    Recorder.cancel();
    S.listening = false;
    S.recording = false;
  }

  function nextWord() {
    stopAll();
    if (S.round >= S.settings.rounds) return finish(false);
    const w = S.queue.shift();
    if (!w) return finish(true);
    S.cur = { w, wordScore: '', wordTries: 0, defScore: '', defTries: 0 };
    enterStep('word');
  }

  function enterStep(step) {
    stopAll();
    S.step = step;
    S.tries = 0;
    S.best = 0;
    S.segIdx = 0;
    S.segScores = [];
    const w = S.cur.w;
    renderWord($('word'), w.w, w.z);
    $('word').classList.toggle('is-small', step === 'def');
    $('reading').hidden = step !== 'def';
    if (step === 'word') {
      $('step-label').textContent = '第一關：念詞語';
      S.segs = [];
    } else {
      S.stageTwoName = buildStageTwo(w);
      renderSegments();
    }
    setHeard('');
    setFeedback(step === 'word' ? '先聽一聽，再跟著念。' : '一句一句跟著念。');
    renderRounds();
    playThenListen();
  }

  /* 目前要念的內容：第一關是詞語，第二關是目前這一句 */
  const targetText = () => (S.step === 'word' ? S.cur.w.w : (S.segs[S.segIdx] || {}).text || '');

  async function playThenListen() {
    const token = ++S.token;
    Listener.abort();
    Recorder.cancel();
    clearMisses();
    setControls('playing');
    try { await playCurrent(); } catch (err) { /* 播放失敗仍讓學生繼續 */ }
    if (token !== S.token) return;
    if (S.mode === 'auto' && !S.prompted) {
      S.prompted = true;
      await say('換你念囉');
      if (token !== S.token) return;
    }
    setControls('ready');
    if (S.mode === 'auto') startListening(true);
  }

  function playCurrent() {
    const w = S.cur.w;
    const rate = S.settings.rate;
    // 朗讀用文字：破音字換成同音字，確保念出詞語標示的讀音（畫面文字不變）
    if (S.step === 'word') {
      const spoken = Matcher.ttsText(w.w, w.w, w.z);
      if (w.audio) return Speaker.playUrl(w.audio).catch(() => Speaker.speak(spoken, rate));
      return Speaker.speak(spoken, rate);
    }
    return Speaker.speak(Matcher.ttsText(targetText(), w.w, w.z), rate);
  }

  const passLine = () => (S.step === 'word' ? S.settings.wordPass : S.settings.defPass);
  const detailOf = list => (S.step === 'word'
    ? Matcher.detailWord(list, S.cur.w.w, S.cur.w.z)
    : Matcher.detailText(list, targetText()));

  async function startListening(isAuto) {
    if (S.listening) return;
    const token = S.token;
    const target = targetText();
    Speaker.cancel(); // 停掉還在播的語音提示，避免被麥克風收進去
    S.listening = true;
    setControls('listening');
    setHeard('');
    clearMisses();
    setFeedback('換你念囉！');
    await Cue.beep();
    if (token !== S.token) { S.listening = false; return; }

    let list = [];
    try {
      list = await Listener.listen({
        continuous: S.step === 'def',
        maxMs: S.step === 'word' ? 7000 : Math.min(20000, 5000 + Array.from(target).length * 700),
        onUpdate: (cands, ctl) => {
          if (token !== S.token) return ctl.stop();
          setHeard('我聽到：' + cands[0]);
          if (detailOf(cands).score >= passLine()) ctl.stop();
        }
      });
      S.micGranted = true;
    } catch (err) {
      S.listening = false;
      if (token !== S.token) return;
      return handleListenError(err, isAuto);
    }
    S.listening = false;
    if (token !== S.token) return;

    S.tries++;
    const d = list.length ? detailOf(list) : { score: 0, hits: [] };
    S.best = Math.max(S.best, d.score);
    if (d.score >= passLine()) return passTarget(d.score);

    setControls('ready');
    const canSkip = S.tries >= S.settings.skipAfter ? '也可以先跳過。' : '';
    if (!list.length) {
      setFeedback('沒有聽到聲音，按麥克風再念一次。' + canSkip, 'warn');
      say('沒有聽到，再試一次');
    } else {
      markMisses(d.hits);
      const missed = d.hits.some(h => h === false);
      setFeedback((missed ? '注意紅色的字，再念一次。' : '這次 ' + d.score + ' 分，再念一次。') + canSkip, 'warn');
      say(missed ? '注意紅色的字，再試一次' : '再試一次');
    }
  }

  function handleListenError(err, isAuto) {
    const code = err.code || '';
    // 自動開始收音被瀏覽器擋下（還沒按過麥克風）：改成等學生按按鈕
    if (isAuto && !S.micGranted && (code === 'not-allowed' || code === 'start-failed')) {
      setControls('ready');
      setFeedback('按下麥克風，開始念。');
      return;
    }
    if (code === 'network') {
      setControls('ready');
      setFeedback('語音辨識需要網路，請確認網路後再按一次麥克風。', 'warn');
      return;
    }
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'start-failed') {
      S.mode = (code !== 'audio-capture' && Recorder.supported()) ? 'record' : 'self';
      setControls('ready');
      setFeedback(S.mode === 'record'
        ? '麥克風沒辦法自動聽，改成錄下來自己聽。請先允許使用麥克風。'
        : '沒辦法使用麥克風，念完後請按「我念好了」。', 'warn');
      return;
    }
    setControls('ready');
    setFeedback('出了點狀況，請再按一次麥克風。', 'warn');
  }

  async function toggleRecord() {
    const token = S.token;
    if (!S.recording) {
      try {
        await Recorder.start(S.step === 'word' ? 8000 : 20000);
        if (token !== S.token) return Recorder.cancel();
        S.recording = true;
        setControls('recording');
        setFeedback('錄音中，念完按「停止錄音」。');
      } catch (err) {
        S.mode = 'self';
        setControls('ready');
        setFeedback('沒辦法使用麥克風，念完後請按「我念好了」。', 'warn');
      }
      return;
    }
    S.recording = false;
    setControls('playing');
    const url = await Recorder.stop();
    if (token !== S.token) return;
    setFeedback('聽聽看自己念的，和剛剛一樣嗎？');
    if (url) { try { await Speaker.playUrl(url); } catch (err) { /* 忽略 */ } }
    if (token !== S.token) return;
    setControls('checking');
  }

  function onMic() {
    if (S.mode === 'auto') {
      if (S.listening) Listener.stop();
      else startListening(false);
    } else if (S.mode === 'record') {
      toggleRecord();
    } else {
      S.tries++;
      passTarget('');
    }
  }

  /* 念對一個目標：第一關直接過關；第二關念對一句就接下一句 */
  async function passTarget(score) {
    if (S.step === 'def' && S.segIdx < S.segs.length - 1) {
      const token = S.token;
      S.segScores[S.segIdx] = score;
      setControls('locked');
      setFeedback('這句念對了！', 'good');
      await Cue.chime();
      if (token !== S.token) return;
      S.segIdx++;
      S.best = 0;
      renderSegments();
      setHeard('');
      return playThenListen();
    }
    if (S.step === 'def') S.segScores[S.segIdx] = score;
    passStage(score);
  }

  async function passStage(score) {
    const c = S.cur;
    if (S.step === 'word') { c.wordScore = score; c.wordTries = S.tries; }
    else { c.defScore = averageScore(S.segScores); c.defTries = S.tries; }
    setControls('locked');
    if (S.step === 'def') S.segs.forEach(s => { s.el.classList.add('is-done'); s.el.classList.remove('is-current'); });
    setFeedback(S.step === 'word' ? '念對了！接下來念' + stageTwoLabel() + '。' : '太棒了！', 'good');
    stamp();
    const token = S.token;
    await Promise.all([say(pick(PRAISE)), wait(1300)]);
    if (token !== S.token) return;
    if (S.step === 'word') enterStep('def');
    else completeWord('完成');
  }

  function stageTwoLabel() {
    const w = S.cur.w;
    const hasEx = !!(w.ex && w.ex.trim());
    if (S.settings.stage2 === 'ex' && hasEx) return '例句';
    if (S.settings.stage2 === 'both' && hasEx) return '解釋和例句';
    return '解釋';
  }

  function averageScore(arr) {
    const nums = arr.filter(v => typeof v === 'number');
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : '';
  }

  function snapshotStep() {
    const auto = S.mode === 'auto' && S.tries > 0;
    if (S.step === 'word') {
      S.cur.wordScore = auto ? S.best : '';
      S.cur.wordTries = S.tries;
    } else {
      S.cur.defScore = auto ? averageScore(S.segScores.concat([S.best])) : '';
      S.cur.defTries = S.tries;
    }
  }

  function completeWord(result) {
    const c = S.cur;
    const rec = {
      char: S.char, word: c.w.w, result,
      wordScore: c.wordScore, defScore: c.defScore,
      wordTries: c.wordTries, defTries: c.defTries,
      method: METHOD[S.mode], session: S.session + '-' + (++S.seq), at: Date.now()
    };
    sendLog(rec);
    if (result !== '換詞') {
      S.results.push(Object.assign({ w: c.w }, rec));
      S.round++;
    }
    nextWord();
  }

  function finish(ranOut) {
    stopAll();
    const done = S.results.filter(r => r.result === '完成').length;
    bumpAssignments(S.char, done);
    $('done-title').textContent = done ? '完成了！' : '今天先到這裡';
    $('done-sub').textContent = ranOut && S.round < S.settings.rounds
      ? '「' + S.char + '」適合你的詞語都練過了，你完成了 ' + done + ' 個。'
      : '你練完了 ' + done + ' 個「' + S.char + '」的詞語。';
    const ol = $('done-list');
    ol.innerHTML = '';
    S.results.forEach(r => {
      const li = document.createElement('li');
      li.className = r.result === '完成' ? 'is-done' : 'is-skipped';
      const word = document.createElement('div');
      word.className = 'done-word';
      renderWord(word, r.w.w, r.w.z);
      const meta = document.createElement('p');
      meta.className = 'done-meta';
      meta.textContent = r.result === '完成' ? '完成' : '下次再挑戰';
      li.append(word, meta);
      if (r.w.ex) {
        const ex = document.createElement('p');
        ex.className = 'done-example';
        ex.textContent = '例句：' + r.w.ex;
        li.appendChild(ex);
      }
      ol.appendChild(li);
    });
    const next = nextAssignedChar(S.char);
    const nb = $('btn-next-assign');
    nb.hidden = !next;
    nb.dataset.char = next;
    nb.textContent = next ? '練下一個指派的字「' + next + '」' : '';
    $('btn-again-char').className = 'btn btn-wide ' + (next ? 'btn-ghost' : 'btn-primary');
    $('btn-again-char').textContent = next ? '回到首頁' : '再練一個生字';
    show('done');
    refreshAssignments();
  }

  /* ───────── 紀錄上傳（失敗會留著，下次再送） ───────── */

  const pending = store.get('tutor.pending') || [];
  let flushing = null;

  function sendLog(rec) {
    pending.push(rec);
    if (pending.length > 100) pending.splice(0, pending.length - 100);
    store.set('tutor.pending', pending);
    flushPending();
  }

  function flushPending() {
    if (flushing) return flushing;
    if (!pending.length || !S.cred) return Promise.resolve();
    flushing = (async () => {
      try {
        while (pending.length) {
          const batch = pending.slice(0, 30);
          await Api.post({ action: 'log', u: S.cred.u, k: S.cred.k, records: batch });
          const sent = new Set(batch.map(r => r.session));
          for (let i = pending.length - 1; i >= 0; i--) if (sent.has(pending[i].session)) pending.splice(i, 1);
          store.set('tutor.pending', pending);
        }
      } catch (err) {
        // 下次再送
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  window.addEventListener('online', () => flushPending());

  /* ───────── 按鈕 ───────── */

  function bindButtons() {
    $('btn-retry').addEventListener('click', () => location.reload());
    $('btn-mic').addEventListener('click', onMic);
    $('btn-listen').addEventListener('click', () => {
      if (S.listening || S.recording) return;
      playThenListen();
    });
    $('btn-swap').addEventListener('click', () => {
      if (!S.queue.length) return;
      stopAll();
      snapshotStep();
      completeWord('換詞');
    });
    $('btn-skip').addEventListener('click', () => {
      stopAll();
      snapshotStep();
      completeWord('跳過');
    });
    $('btn-ok').addEventListener('click', () => { S.tries++; passTarget(''); });
    $('btn-again').addEventListener('click', () => {
      S.tries++;
      setControls('ready');
      setFeedback('再錄一次看看。');
    });
    $('btn-next-assign').addEventListener('click', e => {
      const ch = e.currentTarget.dataset.char;
      if (ch) startPractice(ch);
    });
    $('btn-again-char').addEventListener('click', () => {
      renderHome();
      show('home');
      if (!(S.assignments || []).length) $('char-input').focus();
    });
    $('btn-home').addEventListener('click', () => {
      stopAll();
      if (S.results.length) finish(false);
      else { renderHome(); show('home'); }
    });
    // 「點字才顯示注音」模式：點一下國字顯示或隱藏注音
    $('reading').addEventListener('click', e => {
      const rc = e.target.closest('.rc');
      if (rc && $('reading').classList.contains('zy-tap')) rc.classList.toggle('show-zy');
    });
  }

  boot();
})();
