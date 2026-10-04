(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const HAN = /\p{Script=Han}/u;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (err) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { /* 無痕模式等情況 */ } }
  };
  const METHOD = { auto: '自動辨識', record: '錄音自評', self: '自評' };

  const S = {
    cred: null, student: null, settings: null, mode: 'auto',
    char: '', queue: [], round: 0, results: [],
    cur: null, step: 'word', tries: 0, best: 0,
    token: 0, listening: false, recording: false, micGranted: false,
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
    h.textContent = msg || '在格子裡打一個字';
    h.classList.toggle('is-error', !!isError);
  }

  function renderHome() {
    $('hello').textContent = S.student.name + '，你好！';
    $('char-input').value = '';
    $('btn-start').disabled = true;
    setHint('', false);
    const notes = [];
    if (S.mode === 'record') notes.push('這個瀏覽器不能自動聽你念，會改成「錄下來，自己聽聽看」。');
    if (S.mode === 'self') notes.push('這個瀏覽器不能使用麥克風，念完後請自己按「我念好了」。');
    if (!Speaker.hasVoice()) notes.push('這台裝置沒有台灣國語語音，請看注音自己念念看。');
    $('mode-note').textContent = notes.join('');
    $('mode-note').hidden = !notes.length;
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

  /* ───────── 練習流程 ───────── */

  async function startPractice(ch) {
    if (S.busy) return;
    S.busy = true;
    const btn = $('btn-start');
    btn.disabled = true;
    btn.textContent = '找詞語中…';
    Speaker.unlock();
    try {
      const data = await Api.get({ action: 'words', u: S.cred.u, k: S.cred.k, char: ch });
      if (!data.words.length) {
        setHint('找不到適合的「' + ch + '」詞語，換一個字試試看。', true);
        return;
      }
      S.char = ch;
      S.queue = arrange(data.words);
      S.round = 0;
      S.results = [];
      S.session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      S.seq = 0;
      $('char-input').blur();
      $('seed-char').textContent = ch;
      show('practice');
      nextWord();
    } catch (err) {
      setHint(err.message, true);
    } finally {
      S.busy = false;
      btn.textContent = '開始練習';
      btn.disabled = !currentChar();
    }
  }

  /* 伺服器已隨機抽樣，這裡再洗牌一次 */
  function arrange(words) {
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
    const w = S.cur.w;
    $('step-label').textContent = step === 'word' ? '第一關：念詞語' : '第二關：念解釋';
    renderWord($('word'), w.w, w.z);
    $('word').classList.toggle('is-small', step === 'def');
    $('definition').hidden = step !== 'def';
    $('definition').textContent = w.d;
    setHeard('');
    setFeedback(step === 'word' ? '先聽一聽，再跟著念。' : '聽聽看這個詞的意思，再跟著念。');
    renderRounds();
    playThenListen();
  }

  async function playThenListen() {
    const token = ++S.token;
    Listener.abort();
    Recorder.cancel();
    setControls('playing');
    try { await playCurrent(); } catch (err) { /* 播放失敗仍讓學生繼續 */ }
    if (token !== S.token) return;
    setControls('ready');
    if (S.mode === 'auto') startListening(true);
  }

  function playCurrent() {
    const w = S.cur.w;
    const rate = S.settings.rate;
    // 朗讀用文字：破音字換成同音字，確保念出詞語標示的讀音（畫面文字不變）
    const spokenWord = Matcher.ttsText(w.w, w.w, w.z);
    if (S.step === 'word' && w.audio) return Speaker.playUrl(w.audio).catch(() => Speaker.speak(spokenWord, rate));
    return Speaker.speak(S.step === 'word' ? spokenWord : Matcher.ttsText(w.d, w.w, w.z), rate);
  }

  const passLine = () => (S.step === 'word' ? S.settings.wordPass : S.settings.defPass);
  const scoreOf = list => (S.step === 'word'
    ? Matcher.scoreWord(list, S.cur.w.w, S.cur.w.z)
    : Matcher.scoreText(list, S.cur.w.d));

  async function startListening(isAuto) {
    if (S.listening) return;
    const token = S.token;
    const target = S.step === 'word' ? S.cur.w.w : S.cur.w.d;
    S.listening = true;
    setControls('listening');
    setHeard('');
    setFeedback(isAuto ? '換你念囉！' : '請開始念。');

    let list = [];
    try {
      list = await Listener.listen({
        continuous: S.step === 'def',
        maxMs: S.step === 'word' ? 7000 : Math.min(30000, 6000 + Array.from(target).length * 700),
        onUpdate: (cands, ctl) => {
          if (token !== S.token) return ctl.stop();
          setHeard('我聽到：' + cands[0]);
          if (scoreOf(cands) >= passLine()) ctl.stop();
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
    const score = list.length ? scoreOf(list) : 0;
    S.best = Math.max(S.best, score);
    if (score >= passLine()) return passStep(score);

    setControls('ready');
    if (!list.length) setFeedback('沒有聽到聲音，按麥克風再念一次。', 'warn');
    else setFeedback('這次 ' + score + ' 分，再念一次！' + (S.tries >= S.settings.skipAfter ? '也可以先跳過。' : ''), 'warn');
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
        await Recorder.start(S.step === 'word' ? 8000 : 25000);
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
      passStep('');
    }
  }

  function passStep(score) {
    const c = S.cur;
    if (S.step === 'word') { c.wordScore = score; c.wordTries = S.tries; }
    else { c.defScore = score; c.defTries = S.tries; }
    setControls('locked');
    setFeedback(S.step === 'word' ? '念對了！接下來念解釋。' : '太棒了！', 'good');
    stamp();
    const token = S.token;
    setTimeout(() => {
      if (token !== S.token) return;
      if (S.step === 'word') enterStep('def');
      else completeWord('完成');
    }, 1300);
  }

  function snapshotStep() {
    const v = S.mode === 'auto' && S.tries ? S.best : '';
    if (S.step === 'word') { S.cur.wordScore = v; S.cur.wordTries = S.tries; }
    else { S.cur.defScore = v; S.cur.defTries = S.tries; }
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
    show('done');
  }

  /* ───────── 紀錄上傳（失敗會留著，下次再送） ───────── */

  const pending = store.get('tutor.pending') || [];
  let flushing = false;

  function sendLog(rec) {
    pending.push(rec);
    if (pending.length > 100) pending.splice(0, pending.length - 100);
    store.set('tutor.pending', pending);
    flushPending();
  }

  async function flushPending() {
    if (flushing || !pending.length || !S.cred) return;
    flushing = true;
    const batch = pending.slice(0, 30);
    try {
      await Api.post({ action: 'log', u: S.cred.u, k: S.cred.k, records: batch });
      const sent = new Set(batch.map(r => r.session));
      for (let i = pending.length - 1; i >= 0; i--) if (sent.has(pending[i].session)) pending.splice(i, 1);
      store.set('tutor.pending', pending);
      flushing = false;
      if (pending.length) flushPending();
    } catch (err) {
      flushing = false;
    }
  }

  window.addEventListener('online', flushPending);

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
    $('btn-ok').addEventListener('click', () => { S.tries++; passStep(''); });
    $('btn-again').addEventListener('click', () => {
      S.tries++;
      setControls('ready');
      setFeedback('再錄一次看看。');
    });
    $('btn-again-char').addEventListener('click', () => {
      renderHome();
      show('home');
      $('char-input').focus();
    });
    $('btn-home').addEventListener('click', () => {
      stopAll();
      if (S.results.length) finish(false);
      else { renderHome(); show('home'); }
    });
  }

  boot();
})();
