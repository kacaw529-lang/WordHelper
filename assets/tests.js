/* 可在瀏覽器開 tests.html，也可用 node assets/tests.js 執行 */
(function (root) {
  const isNode = typeof window === 'undefined';
  const results = [];
  const check = (label, got, expect) => results.push({ ok: got === expect, label, got, expect });

  function run(DateTW, Matcher, Report) {
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

    /* 逐字標記沒念對的字 */
    Matcher.setCharmap({ '學': 'ㄒㄩㄝˊ', '雪': 'ㄒㄩㄝˇ', '生': 'ㄕㄥ', '校': 'ㄒㄧㄠˋ', '穴': 'ㄒㄩㄝˊ' });
    check('逐字｜詞語第一字念錯', JSON.stringify(Matcher.detailWord(['雪生'], '學生', 'ㄒㄩㄝˊ ㄕㄥ').hits), '[false,true]');
    check('逐字｜解釋漏念「讀書」', JSON.stringify(Matcher.detailText(['在學校的人'], '在學校讀書的人。').hits), '[true,true,true,false,false,true,true]');
    check('逐字｜同音字不算錯', JSON.stringify(Matcher.detailText(['在穴校'], '在學校').hits), '[true,true,true]');

    /* 分句：依標點切開，太短的併入下一句 */
    const segText = t => Matcher.segments(Matcher.tokens(t, '')).map(sg => sg.map(x => x.ch).join(''));
    check('分句｜兩句', JSON.stringify(segText('學校結束一日課程後，放學生回家。')), JSON.stringify(['學校結束一日課程後，', '放學生回家。']));
    check('分句｜太短併入下一句', JSON.stringify(segText('連詞。表示事情的原因。')), JSON.stringify(['連詞。表示事情的原因。']));
    check('分句｜最後一句太短併回上一句', JSON.stringify(segText('他每天早上都去跑步，很好。')), JSON.stringify(['他每天早上都去跑步，很好。']));
    check('分句｜沒有標點', JSON.stringify(segText('四維八德')), JSON.stringify(['四維八德']));
    const tk = Matcher.tokens('8個人。', 'ㄅㄚ|ㄍㄜˋ|ㄖㄣˊ');
    check('注音對位｜數字也有注音、標點沒有', tk.map(t => t.han ? t.zy : '-').join(','), 'ㄅㄚ,ㄍㄜˋ,ㄖㄣˊ,-');

    /* 朗讀用文字：破音字依詞語讀音代換 */
    Matcher.setCharmap({ '行': 'ㄏㄤˊ|ㄒㄧㄥˊ', '航': 'ㄏㄤˊ', '型': 'ㄒㄧㄥˊ', '銀': 'ㄧㄣˊ', '人': 'ㄖㄣˊ',
      '一': 'ㄧ|ㄧˊ|ㄧˋ', '衣': 'ㄧ', '學': 'ㄒㄩㄝˊ', '生': 'ㄕㄥ' });
    check('朗讀｜銀行', Matcher.ttsText('銀行', '銀行', 'ㄧㄣˊ ㄏㄤˊ'), '銀航');
    check('朗讀｜行人的解釋', Matcher.ttsText('在路上行走的人。', '行人', 'ㄒㄧㄥˊ ㄖㄣˊ'), '在路上型走的人。');
    check('朗讀｜沒有破音字不變', Matcher.ttsText('在學校讀書的學生。', '學生', 'ㄒㄩㄝˊ ㄕㄥ'), '在學校讀書的學生。');
    check('朗讀｜一、不交給語音引擎變調', Matcher.ttsText('一行', '一行', 'ㄧ ㄏㄤˊ'), '一航');

    /* 紀錄彙整：進度矩陣、需要注意、明細分組（日期混用三種形態） */
    const A = '自動辨識';
    const rec = (student, char, word, result, extra) => Object.assign({
      date: '2026-10-08', time: '09:00:00', student, char, word, result,
      wordScore: 100, defScore: 90, wordTries: 1, defTries: 1, method: A
    }, extra || {});
    const rows = [
      rec('S01', '利', '權利', '完成', { date: '2026/10/8', time: '09:01:00', defScore: 80 }),
      rec('S01', '利', '紅利', '完成', { date: new Date('2026-10-08T01:02:00Z'), time: '09:02:00', defScore: 100 }),
      rec('S01', '利', '有利', '完成', { date: 'Thu Oct 08 2026 09:03:00 GMT+0800 (台北標準時間)', time: '09:03:00', defScore: 90 }),
      rec('S01', '努', '努力', '完成', { time: '09:10:00', wordTries: 4 }),
      rec('S01', '努', '努嘴', '跳過', { time: '09:11:00', wordScore: 50, defScore: '', wordTries: 3, defTries: 0 }),
      rec('S03', '利', '利用', '完成', { time: '10:00:00', wordScore: '', defScore: '', method: '自評' }),
      rec('S03', '段', '時段', '完成', { time: '10:05:00', date: '2026-10-07' })
    ];
    const rp = Report.build(rows, {
      students: [{ id: 'S01', name: '小明' }, { id: 'S02', name: '小華' }, { id: 'S03', name: '小美' }],
      chars: ['利', '努'], mode: 'assign', need: 3, defPass: 80, skipAfter: 3, includeOthers: false
    });
    const m1 = rp.matrix[0];
    check('彙整｜三種日期形態都歸到同一天', rp.records.filter(r => r.student === 'S01' && r.char === '利').map(r => r.date).join(','), '2026-10-08,2026-10-08,2026-10-08');
    check('彙整｜完成 3 個詞＝這個字完成', m1.cells['利'].status, 'done');
    check('彙整｜解釋平均（只算自動辨識）', m1.cells['利'].def, 90);
    check('彙整｜有跳過＝進行中且標記注意', m1.cells['努'].status + '/' + m1.cells['努'].warn, 'partial/true');
    check('彙整｜完成字數', m1.charsDone, 1);
    check('彙整｜沒練習的格子', rp.matrix[1].cells['利'].status, 'none');
    check('彙整｜指派外的生字放在「其他」欄', rp.cols.join(''), '利努其他');
    check('彙整｜只用自評完成', rp.matrix[2].cells['利'].selfOnly, true);
    check('彙整｜全班：利 完成人數', rp.classRow['利'].done + '／' + rp.classRow['利'].total, '1／3');
    const kinds = rp.attention.map(a => a.student + ':' + a.kind).join(',');
    check('需要注意｜依嚴重程度排序', kinds, 'S02:start,S03:device,S01:skip,S01:tries');
    check('需要注意｜跳過卡在哪一關', rp.attention.find(a => a.kind === 'skip').text, '卡在念詞語，最高 50 分。');
    check('需要注意｜多次嘗試合併成一列', rp.attention.find(a => a.kind === 'tries').text, '1 個詞念了 3 次以上才通過：努力。');
    const g = rp.groups[0].rows;
    check('明細｜同一天、同一字只標第一列', g.map(r => (r.newDate ? 'D' : '-') + (r.newChar ? 'C' : '-')).join(' '), 'DC -- -C -- --');
    const rp2 = Report.build(rows, { students: [], mode: 'date' });
    check('依日期｜生字依第一次練習排序', rp2.chars.join(''), '段利努');
    check('依日期｜名單外的學生也列出', rp2.matrix.map(m => m.id).sort().join(','), 'S01,S03');
    const csv = Report.toCSV([rec('S01', '利', '權利', '完成', { stamp: '2026-10-08 09:00:00' })], () => '=小明');
    check('CSV｜BOM 與標題', csv.slice(0, 3), '\uFEFF日期');
    check('CSV｜日期為純文字、名稱防公式', csv.split('\r\n')[1].split(',').slice(0, 4).join(','), "2026-10-08,09:00:00,S01,'=小明");

    return results;
  }

  if (isNode) {
    const fs = require('fs');
    const path = require('path');
    const load = f => new Function(fs.readFileSync(path.join(__dirname, f), 'utf8') + '\nreturn { DateTW: typeof DateTW !== "undefined" ? DateTW : null, Matcher: typeof Matcher !== "undefined" ? Matcher : null };')();
    const { DateTW } = load('api.js');
    const { Matcher } = load('match.js');
    const Report = new Function(['api.js', 'report.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n') + '\nreturn Report;')();
    run(DateTW, Matcher, Report).forEach(r => console.log((r.ok ? '✅' : '❌') + ' ' + r.label + '：' + JSON.stringify(r.got) + (r.ok ? '' : '（預期 ' + JSON.stringify(r.expect) + '）')));
    const bad = results.filter(r => !r.ok).length;
    console.log('通過 ' + (results.length - bad) + '，失敗 ' + bad);
    process.exitCode = bad ? 1 : 0;
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      run(DateTW, Matcher, Report); // 全域 const 不會掛在 window 上，直接用名稱取用
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
