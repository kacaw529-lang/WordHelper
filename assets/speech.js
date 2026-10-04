/* 語音播放：只使用台灣國語語音，找不到就不播放，避免念成其他地區的讀音 */
const Speaker = (() => {
  const synth = window.speechSynthesis;
  let voice = null;
  let audio = null;
  let audioDone = null;

  const isTW = v => /^(zh|cmn)[-_](hant[-_])?tw/i.test(v.lang) || /台灣|臺灣|Taiwan|Mei-?Jia|美佳/i.test(v.name);

  function pick() {
    if (!synth) return null;
    const tw = synth.getVoices().filter(isTW);
    voice = tw.find(v => v.localService) || tw[0] || null;
    return voice;
  }

  function init() {
    return new Promise(resolve => {
      if (!synth) return resolve(false);
      if (pick()) return resolve(true);
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(!!pick()); } };
      synth.addEventListener('voiceschanged', () => { if (pick()) finish(); });
      setTimeout(finish, 2500);
    });
  }

  /* 必須在使用者第一次點按時呼叫，iOS 才允許之後自動播放 */
  function unlock() {
    if (!synth) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch (err) { /* 忽略 */ }
  }

  function speak(text, rate) {
    return new Promise(resolve => {
      if (!synth || !voice || !text) return resolve();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = rate || 0.8;
      let done = false;
      const end = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      u.onend = end;
      u.onerror = end;
      // 部分瀏覽器不觸發 onend，用字數估算保底
      const timer = setTimeout(end, 2500 + Array.from(text).length * 450 / u.rate);
      setTimeout(() => synth.speak(u), 60);
    });
  }

  function playUrl(url) {
    stopAudio();
    return new Promise((resolve, reject) => {
      audio = new Audio(url);
      audioDone = resolve;
      audio.onended = () => { audioDone = null; resolve(); };
      audio.onerror = () => { audioDone = null; reject(new Error('音檔無法播放')); };
      audio.play().catch(err => { audioDone = null; reject(err); });
    });
  }

  function stopAudio() {
    if (audio) { audio.pause(); audio = null; }
    if (audioDone) { const f = audioDone; audioDone = null; f(); }
  }

  function cancel() {
    if (synth) synth.cancel();
    stopAudio();
  }

  return { init, unlock, speak, playUrl, cancel, hasVoice: () => !!voice };
})();

/* 語音辨識：Chrome、Safari 的 Web Speech API */
const Listener = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let current = null;

  function supported() { return !!SR; }

  /**
   * onUpdate(候選文字陣列, 控制器)：每次聽到新內容就呼叫，可呼叫 ctl.stop() 提早結束
   * 回傳 Promise<候選文字陣列>；權限或裝置錯誤會 reject，err.code 為錯誤代碼
   */
  function listen(opts) {
    const o = Object.assign({ continuous: false, maxMs: 8000, onUpdate: null }, opts);
    abort();
    return new Promise((resolve, reject) => {
      const rec = new SR();
      rec.lang = 'zh-TW';
      rec.continuous = o.continuous;
      rec.interimResults = true;
      rec.maxAlternatives = 5;

      let finalTop = '';
      let finalAlts = [];
      let interim = '';
      let settled = false;
      let timer = null;

      const ctl = {
        stop() { try { rec.stop(); } catch (err) { /* 忽略 */ } },
        abort() { try { rec.abort(); } catch (err) { /* 忽略 */ } settle(resolve, []); }
      };

      const candidates = () => {
        if (o.continuous) {
          const t = (finalTop + interim).trim();
          return t ? [t] : [];
        }
        if (finalAlts.length) return finalAlts;
        return interim ? [interim] : [];
      };

      function settle(fn, v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current === ctl) current = null;
        fn(v);
      }

      rec.onresult = e => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            finalTop += r[0].transcript;
            if (!o.continuous) finalAlts = Array.from(r).map(a => a.transcript);
          } else {
            interim += r[0].transcript;
          }
        }
        const list = candidates();
        if (list.length && o.onUpdate) o.onUpdate(list, ctl);
      };
      rec.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return settle(resolve, candidates());
        settle(reject, Object.assign(new Error(e.error), { code: e.error }));
      };
      rec.onend = () => settle(resolve, candidates());

      current = ctl;
      timer = setTimeout(() => ctl.stop(), o.maxMs);
      try {
        rec.start();
      } catch (err) {
        settle(reject, Object.assign(new Error(err.message), { code: 'start-failed' }));
      }
    });
  }

  function abort() { if (current) current.abort(); }
  function stop() { if (current) current.stop(); }

  return { supported, listen, abort, stop, isActive: () => !!current };
})();

/* 錄音回放：給不支援語音辨識的瀏覽器使用 */
const Recorder = (() => {
  let mr = null;
  let stream = null;
  let chunks = [];
  let url = null;
  let timer = null;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async function start(maxMs) {
    cancel();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mr = new MediaRecorder(stream);
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.start();
    timer = setTimeout(() => { if (mr && mr.state === 'recording') mr.stop(); }, maxMs || 20000);
  }

  function stop() {
    return new Promise(resolve => {
      if (!mr) return resolve(null);
      const m = mr;
      const finish = () => {
        clearTimeout(timer);
        releaseStream();
        if (url) URL.revokeObjectURL(url);
        url = chunks.length ? URL.createObjectURL(new Blob(chunks, { type: m.mimeType || 'audio/webm' })) : null;
        mr = null;
        resolve(url);
      };
      if (m.state === 'inactive') return finish();
      m.onstop = finish;
      m.stop();
    });
  }

  function releaseStream() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  function cancel() {
    clearTimeout(timer);
    try { if (mr && mr.state !== 'inactive') { mr.onstop = null; mr.stop(); } } catch (err) { /* 忽略 */ }
    mr = null;
    releaseStream();
  }

  return { supported, start, stop, cancel, isRecording: () => !!mr };
})();
