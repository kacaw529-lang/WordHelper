/* 可在瀏覽器開 tests.html，也可用 node assets/tests.js 執行 */
(function (root) {
  const isNode = typeof window === 'undefined';
  const results = [];
  const check = (label, got, expect) => results.push({ ok: got === expect, label, got, expect });

  function run(DateTW, Matcher) {
    /* 日期：三種形態都要得到同一天 */
    const D = '2026-10-04';
    check('日期｜乾淨字串', DateTW.normalize('2026-10-04'), D);
    check('日期｜乾淨字串（斜線未補零）', DateTW.normalize('2026/10/4'), D);
    check('日期｜Date 物件（UTC 前一天 16:00 = 台北當天 0 點）', DateTW.normalize(new Date('2026-10-03T16:00:00Z')), D);
    check('日期｜Date 物件（台北 23:59）', DateTW.normalize(new Date('2026-10-04T15:59:00Z')), D);
    check('日期｜Date 長字串（中文註記）', DateTW.normalize('Sun Oct 04 2026 00:00:00 GMT+0800 (台北標準時間)'), D);
    check('日期｜Date 長字串（英文註記）', DateTW.normalize('Sun Oct 04 2026 08:30:00 GMT+0800 (Taipei Standard Time)'), D);
    check('日期｜不存在的日期', DateTW.normalize('2026-02-30'), '');
    check('日期｜空值', DateTW.normalize(''), '');
    check('日期｜往前 6 天', DateTW.addDays('2026-10-04', -6), '2026-09-28');
    check('日期｜跨月', DateTW.addDays('2026/10/1', -1), '2026-09-30');

    /* 跟讀比對 */
    Matcher.setCharmap({
      '學': 'ㄒㄩㄝˊ', '穴': 'ㄒㄩㄝˊ', '雪': 'ㄒㄩㄝˇ', '生': 'ㄕㄥ', '聲': 'ㄕㄥ',
      '公': 'ㄍㄨㄥ', '式': 'ㄕˋ', '事': 'ㄕˋ', '銀': 'ㄧㄣˊ', '行': 'ㄒㄧㄥˊ|ㄏㄤˊ', '形': 'ㄒㄧㄥˊ', '航': 'ㄏㄤˊ',
      '桌': 'ㄓㄨㄛ', '子': 'ㄗˇ|˙ㄗ'
    });
    check('詞語｜完全相同', Matcher.scoreWord(['學生'], '學生', 'ㄒㄩㄝˊ ㄕㄥ'), 100);
    check('詞語｜前後有多餘的字', Matcher.scoreWord(['我說學生啊'], '學生', 'ㄒㄩㄝˊ ㄕㄥ'), 100);
    check('詞語｜同音字（學聲）', Matcher.scoreWord(['學聲'], '學生', 'ㄒㄩㄝˊ ㄕㄥ'), 100);
    check('詞語｜同音字（公事→公式）', Matcher.scoreWord(['公事'], '公式', 'ㄍㄨㄥ ㄕˋ'), 100);
    check('詞語｜聲調不同（雪生）', Matcher.scoreWord(['雪生'], '學生', 'ㄒㄩㄝˊ ㄕㄥ'), 50);
    check('詞語｜破音字念錯（銀形）不通過', Matcher.scoreWord(['銀形'], '銀行', 'ㄧㄣˊ ㄏㄤˊ'), 50);
    check('詞語｜破音字同音（銀航）通過', Matcher.scoreWord(['銀航'], '銀行', 'ㄧㄣˊ ㄏㄤˊ'), 100);
    check('詞語｜輕聲', Matcher.scoreWord(['桌子'], '桌子', 'ㄓㄨㄛ ˙ㄗ'), 100);
    check('詞語｜多個候選取最高分', Matcher.scoreWord(['雪生', '學生'], '學生', 'ㄒㄩㄝˊ ㄕㄥ'), 100);
    check('詞語｜沒聽到', Matcher.scoreWord([], '學生', 'ㄒㄩㄝˊ ㄕㄥ'), 0);
    check('解釋｜完全相同（忽略標點）', Matcher.scoreText(['在學校讀書的人'], '在學校讀書的人。'), 100);
    check('解釋｜少兩個字', Matcher.scoreText(['在學校讀的人'], '在學校讀書的人。'), 86);
    check('解釋｜同音字視為正確', Matcher.scoreText(['在穴校讀書的人'], '在學校讀書的人。'), 100);
    check('解釋｜數字轉國字', Matcher.scoreText(['3個人'], '三個人'), 100);

    return results;
  }

  if (isNode) {
    const fs = require('fs');
    const path = require('path');
    const load = f => new Function(fs.readFileSync(path.join(__dirname, f), 'utf8') + '\nreturn { DateTW: typeof DateTW !== "undefined" ? DateTW : null, Matcher: typeof Matcher !== "undefined" ? Matcher : null };')();
    const { DateTW } = load('api.js');
    const { Matcher } = load('match.js');
    run(DateTW, Matcher).forEach(r => console.log((r.ok ? '✅' : '❌') + ' ' + r.label + '：' + JSON.stringify(r.got) + (r.ok ? '' : '（預期 ' + JSON.stringify(r.expect) + '）')));
    const bad = results.filter(r => !r.ok).length;
    console.log('通過 ' + (results.length - bad) + '，失敗 ' + bad);
    process.exitCode = bad ? 1 : 0;
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      run(DateTW, Matcher); // 全域 const 不會掛在 window 上，直接用名稱取用
      const tb = document.getElementById('out');
      results.forEach(r => {
        const tr = document.createElement('tr');
        [r.ok ? '✅' : '❌', r.label, JSON.stringify(r.got), JSON.stringify(r.expect)].forEach(t => {
          const td = document.createElement('td');
          td.textContent = t;
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      const bad = results.filter(r => !r.ok).length;
      document.getElementById('summary').textContent = '通過 ' + (results.length - bad) + ' 項，失敗 ' + bad + ' 項（瀏覽器時區：' + Intl.DateTimeFormat().resolvedOptions().timeZone + '）';
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
