/* eslint-disable no-irregular-whitespace -- 「　第 N 題」裡的全形空格是刻意的中文排版間距，
   沿用自 exportPracticePage.ts 同一處寫法，不是打字失誤 */

/**
 * exportFillBlankPracticePage.ts — 把一份 QuizFlow 測驗的填空題（short_answer，
 * body 含 ___ 標記）轉成獨立的靜態填空練習頁 HTML（免登入、不計時）。
 *
 * 跟 exportPracticePage.ts（單選/是非題）並列，但互動規則不同：
 * - 空格只能打字輸入，擋 paste
 * - 可以看參考答案，但每看一次扣該格分數 3%（HINT_PENALTY_PERCENT，可調整）
 * - 每格核對後立即顯示對錯
 * - 全部核對過才能按「確認送出」，送出後鎖定、顯示總分
 *
 * 線上分享版（/api/p/[id] 代理注入 submitEndpoint）按「確定送出」時，會把班級、姓名、
 * 每格最後一次核對的內容與看答案次數送回 QuizFlow，由 server 重算分數，成功後顯示
 * 「繳交到 Google Classroom」按鈕；下載的離線檔沒有 config，維持本機算分、不連網。
 *
 * 純函式：不碰 DB、不碰 Request，方便測試；由
 * export-fillblank-practice-page/route.ts 呼叫。
 */

import { PRACTICE_PAGE_CONFIG_MARKER } from './exportPracticePage';
import { PRACTICE_PAGE_SUBMIT_CLIENT_JS, PRACTICE_PAGE_SUBMIT_CSS } from './practicePageSubmitClient';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 把資料安全地內嵌進 <script> 標籤，理由同 exportPracticePage.ts 的 toEmbeddableJson
function toEmbeddableJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export type FillBlankPracticeQuestion = {
  groupLabel: string;
  before: string; // 空格前文字
  after: string; // 空格後文字
  answer: string; // 正確答案（已 trim）
  explanation?: string;
};

export type FillBlankPracticePageParams = {
  title: string;
  kick: string;
  enSubtitle?: string;
  questions: FillBlankPracticeQuestion[];
  hintPenaltyPercent?: number; // 看一次答案扣多少 %，預設 3
};

// 填空題只吃 short_answer 題型：AI「填空題」(fill) 生成時就是存成 short_answer，
// body 用 ___ 標記空格、correctAnswers[0] 存答案（見 src/lib/quiz/questionRows.ts）
const BLANK_MARKER = '___';

export type RawQuestionForFillBlankExport = {
  type: string;
  body: string;
  explanation?: string | null;
  correctAnswers?: string[] | null;
};

export type SelectFillBlankQuestionsParams = {
  groupLabel: string;
  questions: RawQuestionForFillBlankExport[];
};

export type SelectFillBlankQuestionsResult = {
  practiceQuestions: FillBlankPracticeQuestion[];
  skipped: number; // 非 short_answer，或沒有 ___ 標記／答案的題目數
};

// 把 DB 撈出來的原始題目資料篩選、轉換成靜態填空練習頁要用的格式。
// 純函式：不碰 DB，方便測試；route 只負責撈資料跟呼叫它。
export function selectFillBlankQuestions(
  params: SelectFillBlankQuestionsParams,
): SelectFillBlankQuestionsResult {
  const { groupLabel, questions } = params;
  const practiceQuestions: FillBlankPracticeQuestion[] = [];
  let skipped = 0;

  for (const q of questions) {
    if (q.type !== 'short_answer') {
      skipped++;
      continue;
    }
    const blankIndex = q.body.indexOf(BLANK_MARKER);
    const answer = q.correctAnswers?.[0]?.trim();
    if (blankIndex === -1 || !answer) {
      skipped++;
      continue;
    }

    practiceQuestions.push({
      groupLabel,
      before: q.body.slice(0, blankIndex),
      after: q.body.slice(blankIndex + BLANK_MARKER.length),
      answer,
      explanation: q.explanation ?? undefined,
    });
  }

  return { practiceQuestions, skipped };
}

export function buildFillBlankPracticePageHtml(params: FillBlankPracticePageParams): string {
  const { title, kick, enSubtitle, questions, hintPenaltyPercent = 3 } = params;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} | QuizFlow</title>
${PRACTICE_PAGE_CONFIG_MARKER}
<style>
  :root{
    --ink:#0f2540; --blue:#1e5a8a; --blue-dark:#17466b;
    --blue-soft:#dceaf5; --blue-line:#b9d3e8; --paper:#f4f7fb; --card:#fff;
    --ok:#15803d; --ok-soft:#e7f6ec; --err:#c62828; --err-soft:#fdecec;
    --warn:#946b1b; --warn-soft:#fff8e6; --muted:#5a6b7d; --hint:#8091a1; --radius:10px;
    --shadow:0 1px 2px rgba(15,37,64,.06),0 8px 24px rgba(15,37,64,.06);
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei","Noto Sans TC","Segoe UI",Roboto,sans-serif;color:var(--ink);background:radial-gradient(1200px 400px at 100% -10%,rgba(30,90,138,.10),transparent 60%),var(--paper);line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:760px;margin:0 auto;padding:24px 18px 60px}
  [hidden]{display:none!important}

  .masthead{background:linear-gradient(180deg,var(--blue),var(--blue-dark));color:#fff;border-radius:14px;padding:18px 22px 20px;box-shadow:var(--shadow);position:relative;overflow:hidden}
  .masthead::after{content:"";position:absolute;right:-40px;top:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,.14),transparent 70%)}
  .masthead .kick{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;font-weight:700}
  .masthead h1{margin:6px 0 4px;font-size:22px;font-weight:800}
  .masthead .en{opacity:.9;font-size:13px;font-weight:500}

${PRACTICE_PAGE_SUBMIT_CSS}

  .dock{position:sticky;top:0;z-index:30;margin:0 -18px;padding:10px 18px;background:rgba(244,247,251,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--blue-line)}
  .dock-inner{max-width:760px;margin:0 auto;display:flex;align-items:center;gap:14px}
  .bar{flex:1;height:9px;border-radius:99px;background:#e3ebf3;overflow:hidden}
  .bar>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f8fd6,var(--ok));transition:width .35s ease}
  .count{font-size:13px;font-weight:700;color:var(--blue-dark);white-space:nowrap}
  .count b{color:var(--ok);font-size:15px}

  .dock-nav{max-width:760px;margin:8px auto 0;display:flex;align-items:flex-start;gap:10px}

  .qcard{margin-top:18px;background:var(--card);border:1px solid var(--blue-line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;animation:pop .2s ease}
  @keyframes pop{from{transform:translateY(6px);opacity:0}to{transform:none;opacity:1}}
  .grouplabel{background:var(--blue-soft);border-bottom:1px solid var(--blue-line);padding:10px 18px;font-weight:700;color:var(--blue-dark);font-size:13.5px}
  .qbody{padding:22px 22px 20px}
  .sentence{font-size:17px;font-weight:700;line-height:2.1}
  .blank-input{display:inline-block;min-width:110px;max-width:220px;margin:0 4px;padding:4px 8px;font-size:16px;font-weight:700;font-family:inherit;border:none;border-bottom:2.5px solid var(--blue);background:var(--blue-soft);border-radius:6px 6px 0 0;color:var(--ink);text-align:center}
  .blank-input:focus{outline:none;border-color:var(--blue-dark);background:#fff}
  .blank-input.correct{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}
  .blank-input.wrong{border-color:var(--err);background:var(--err-soft);color:var(--err)}
  .blank-input:disabled{opacity:.85;cursor:default}

  .pastewarn{margin-top:8px;font-size:12.5px;color:var(--err);display:none}
  .pastewarn.show{display:block}

  .actions{margin-top:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .feedback{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:14px;font-weight:700;display:none}
  .feedback.show{display:block}
  .feedback.ok{background:var(--ok-soft);color:var(--ok)}
  .feedback.err{background:var(--err-soft);color:var(--err)}
  .hintbox{margin-top:10px;padding:10px 14px;border-radius:10px;background:var(--warn-soft);border:1.5px solid #e6c65b;color:var(--warn);font-size:13.5px;display:none}
  .hintbox.show{display:block}
  .explain{margin-top:10px;padding:12px 14px;border-radius:10px;background:#fff;border:1.5px solid var(--blue-line);color:var(--muted);font-size:13.5px;display:none}
  .explain.show{display:block}
  .explain b{color:var(--ink)}

  .btn{border:none;border-radius:var(--radius);font-weight:800;font-size:14.5px;padding:10px 20px;cursor:pointer;font-family:inherit;transition:.15s;flex:none}
  .btn.primary{background:linear-gradient(180deg,var(--blue),var(--blue-dark));color:#fff;box-shadow:0 4px 12px rgba(30,90,138,.3)}
  .btn.primary:hover{filter:brightness(1.06)}
  .btn.primary:disabled{opacity:.4;cursor:not-allowed;filter:none}
  .btn.sub{background:#eef4fa;color:var(--blue-dark);border:1.5px solid var(--blue-line)}
  .btn.sub:hover{background:var(--blue-soft)}
  .btn.sub:disabled{opacity:.4;cursor:not-allowed}
  .btn.warn{background:#fff;color:var(--warn);border:1.5px solid #e6c65b}
  .btn.warn:hover{background:var(--warn-soft)}
  .btn.warn:disabled{opacity:.4;cursor:not-allowed}
  .jump{display:flex;gap:6px;flex-wrap:wrap;flex:1;justify-content:center;max-height:104px;overflow-y:auto;padding:2px}
  .jbtn{width:30px;height:30px;flex:none;border-radius:8px;border:1.5px solid var(--blue-line);background:#fff;color:var(--blue-dark);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit}
  .jbtn.cur{border-color:var(--blue);background:var(--blue);color:#fff}
  .jbtn.done{border-color:var(--ok);color:var(--ok)}
  .jbtn.done.cur{background:var(--ok);border-color:var(--ok);color:#fff}

  .submitbar{margin-top:22px;text-align:center}
  .foot{margin-top:22px;text-align:center;font-size:12px;color:var(--hint)}

  .overlay{position:fixed;inset:0;background:rgba(15,37,64,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
  .overlay[hidden]{display:none}
  .modal{background:#fff;border-radius:14px;padding:22px;max-width:420px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:var(--shadow)}
  .modal h3{margin:0 0 10px;font-size:16px}
  .modal p{margin:0 0 16px;font-size:14px;color:var(--muted)}
  .modal .row{display:flex;gap:10px;justify-content:flex-end}
  .result-list{margin-top:14px;max-height:280px;overflow-y:auto;text-align:left}
  .result-item{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #eef2f6;font-size:13px}
  .result-score{font-weight:800;color:var(--ink)}
  .finalscore{font-size:34px;font-weight:900;color:var(--blue-dark);text-align:center;margin:4px 0 2px}

  @media (max-width:480px){
    .masthead h1{font-size:19px}
    .qbody{padding:18px 16px 16px}
    .sentence{font-size:15.5px}
    .dock-nav{flex-wrap:wrap;justify-content:center}
    .jump{order:3;flex-basis:100%}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div class="kick">${escHtml(kick)}</div>
    <h1>${escHtml(title)}</h1>
    ${enSubtitle ? `<div class="en">${escHtml(enSubtitle)}</div>` : ''}
  </header>

  <div class="studentinfo">
    <label>班級<input type="text" id="classInput" autocomplete="off" maxlength="40"></label>
    <label>姓名<input type="text" id="nameInput" autocomplete="off" maxlength="40"></label>
  </div>

  <div class="dock">
    <div class="dock-inner">
      <div class="bar"><span id="progressBar"></span></div>
      <div class="count">已核對 <b id="checkedNum">0</b> / <span id="totalNum">-</span> 格</div>
    </div>
    <div class="dock-nav">
      <button class="btn sub" id="prevBtn">← 上一題</button>
      <div class="jump" id="jump"></div>
      <button class="btn primary" id="nextBtn">下一題 →</button>
    </div>
  </div>

  <div class="qcard" id="qcard"></div>

  <div class="submitbar">
    <button class="btn primary" id="submitBtn" disabled>✅ 確認送出</button>
  </div>

  <div class="foot">📘 免登入、不計時。請先填寫班級、姓名才能送出；空格請自行輸入，不能貼上；看一次答案會扣該格 ${hintPenaltyPercent}% 分數。這份頁面是獨立檔案，離線也能開；把它放到任何網頁空間都能用。<br>由 QuizFlow 提供 · 從測驗匯出</div>
</div>

<div class="overlay" id="confirmOverlay" hidden>
  <div class="modal">
    <h3>確定要送出嗎？</h3>
    <p id="confirmText">送出後會鎖定所有空格，無法再修改。</p>
    <div class="qf-err" id="confirmErr"></div>
    <div class="row">
      <button class="btn sub" id="confirmCancelBtn">再檢查一下</button>
      <button class="btn primary" id="confirmOkBtn">確定送出</button>
    </div>
  </div>
</div>

<div class="overlay" id="resultOverlay" hidden>
  <div class="modal">
    <h3>作答結果</h3>
    <p id="resultStudentInfo" style="text-align:center;margin:-4px 0 10px;font-weight:700;color:var(--ink)"></p>
    <div class="finalscore" id="finalScore">0</div>
    <p style="text-align:center;margin-top:-6px">分（滿分 100）</p>
    <div class="result-list" id="resultList"></div>
    <div id="submitStatus"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="resultCloseBtn">關閉</button>
    </div>
  </div>
</div>

<script>
(function(){
  "use strict";
  function esc(s){return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  var QUESTIONS=${toEmbeddableJson(questions)};
  var HINT_PENALTY_PERCENT=${hintPenaltyPercent};
  var N=QUESTIONS.length;
${PRACTICE_PAGE_SUBMIT_CLIENT_JS}
  var ONLINE_SUBMIT=!!qfSubmitEndpoint(); /* 只有線上分享版才把成績送回 QuizFlow */
  var SID=qfUuid(); /* 每次開頁 = 一次作答 session，只存在記憶體；server 用它擋同一次作答重複送出 */
  var sending=false;

  /* ---------- state ---------- */
  var cur=0;
  // 每題一筆：typed（目前輸入框內容）、checked（是否按過「核對答案」至少一次）、
  // correct（最近一次核對是否正確）、checkedTyped（最近一次核對時的內容，送出給 server 重算用）、
  // hintUses（看答案次數，影響扣分）
  var state=QUESTIONS.map(function(){ return { typed:'', checked:false, correct:false, checkedTyped:'', hintUses:0 }; });
  var submitted=false;

  var qcard=document.getElementById('qcard');
  var jumpEl=document.getElementById('jump');
  var prevBtn=document.getElementById('prevBtn');
  var nextBtn=document.getElementById('nextBtn');
  var submitBtn=document.getElementById('submitBtn');
  var classInput=document.getElementById('classInput');
  var nameInput=document.getElementById('nameInput');

  function studentInfoFilled(){
    return classInput.value.trim()!==''&&nameInput.value.trim()!=='';
  }
  classInput.addEventListener('input', renderQuestion);
  nameInput.addEventListener('input', renderQuestion);

  document.getElementById('totalNum').textContent=N;

  /* 每題基礎配分：Math.floor(100/N)，最後一題補足餘數到 100（比照 QuizFlow 平均配分慣例） */
  function baseScore(i){
    var base=Math.floor(100/N);
    return i===N-1 ? 100-base*(N-1) : base;
  }

  function blankScore(i){
    if(!state[i].checked || !state[i].correct) return 0;
    var penalty=Math.min(1, HINT_PENALTY_PERCENT/100*state[i].hintUses);
    return baseScore(i)*(1-penalty);
  }

  function totalScore(){
    var sum=0;
    for(var i=0;i<N;i++){ sum+=blankScore(i); }
    return Math.round(sum);
  }

  function checkedCount(){
    var n=0;
    for(var i=0;i<N;i++){ if(state[i].checked) n++; }
    return n;
  }

  function renderJump(){
    jumpEl.innerHTML=QUESTIONS.map(function(_,i){
      var cls='jbtn'+(i===cur?' cur':'')+(state[i].checked?' done':'');
      return '<button type="button" class="'+cls+'" data-i="'+i+'">'+(i+1)+'</button>';
    }).join('');
  }

  function renderQuestion(){
    var q=QUESTIONS[cur];
    var s=state[cur];
    var disabled=submitted||(s.checked&&s.correct);
    var inputCls='blank-input'+(s.checked?(s.correct?' correct':' wrong'):'');

    qcard.className='qcard';
    qcard.innerHTML=
      '<div class="grouplabel">'+esc(q.groupLabel)+'　第 '+(cur+1)+' 題</div>'+
      '<div class="qbody">'+
        '<div class="sentence">'+esc(q.before)+
          '<input type="text" class="'+inputCls+'" id="blankInput" autocomplete="off" autocorrect="off" spellcheck="false" '+(disabled?'disabled':'')+' value="'+esc(s.typed)+'">'+
          esc(q.after)+
        '</div>'+
        '<div class="pastewarn" id="pasteWarn">請自行輸入答案，這裡不能貼上喔</div>'+
        '<div class="actions">'+
          '<button type="button" class="btn primary" id="checkBtn" '+(disabled?'disabled':'')+'>核對答案</button>'+
          '<button type="button" class="btn warn" id="hintBtn" '+(submitted?'disabled':'')+'>👀 看答案（扣 '+HINT_PENALTY_PERCENT+'%）</button>'+
        '</div>'+
        '<div class="feedback '+(s.checked?(s.correct?'ok show':'err show'):'')+'" id="feedback">'+
          (s.checked ? (s.correct?'✅ 答對了！':'❌ 還不對，再試一次') : '')+
        '</div>'+
        '<div class="hintbox" id="hintBox"></div>'+
        (q.explanation ? '<div class="explain" id="explainBox"><b>詳解：</b>'+esc(q.explanation)+'</div>' : '')+
      '</div>';

    var input=document.getElementById('blankInput');
    input.addEventListener('paste', function(e){
      e.preventDefault();
      var warn=document.getElementById('pasteWarn');
      warn.className='pastewarn show';
      setTimeout(function(){ warn.className='pastewarn'; },2000);
    });
    input.addEventListener('drop', function(e){ e.preventDefault(); });
    input.addEventListener('input', function(){ state[cur].typed=input.value; });
    input.addEventListener('keydown', function(e){
      if(e.key==='Enter'){ e.preventDefault(); document.getElementById('checkBtn').click(); }
    });

    document.getElementById('checkBtn').addEventListener('click', doCheck);
    document.getElementById('hintBtn').addEventListener('click', doHint);

    if(s.hintUses>0){
      var hintBox=document.getElementById('hintBox');
      hintBox.className='hintbox show';
      hintBox.textContent='正確答案是「'+q.answer+'」，已看答案 '+s.hintUses+' 次，這格扣 '+Math.min(100,HINT_PENALTY_PERCENT*s.hintUses)+'% 分數';
    }
    if(s.checked){
      var explainBox=document.getElementById('explainBox');
      if(explainBox) explainBox.className='explain show';
    }

    document.getElementById('checkedNum').textContent=checkedCount();
    document.getElementById('progressBar').style.width=(checkedCount()/N*100)+'%';
    prevBtn.disabled=(cur===0);
    nextBtn.disabled=(cur===N-1);
    submitBtn.disabled=submitted||checkedCount()<N||!studentInfoFilled();
    renderJump();
  }

  function doCheck(){
    if(submitted) return;
    var input=document.getElementById('blankInput');
    var typed=(input.value||'').trim();
    state[cur].typed=typed;
    state[cur].checkedTyped=typed;
    state[cur].checked=true;
    state[cur].correct=typed!==''&&typed.toLowerCase()===QUESTIONS[cur].answer.trim().toLowerCase();
    renderQuestion();
  }

  function doHint(){
    if(submitted) return;
    state[cur].hintUses++;
    renderQuestion();
  }

  function goTo(i){
    if(i<0||i>=N) return;
    cur=i;
    renderQuestion();
  }

  prevBtn.addEventListener('click',function(){ goTo(cur-1); });
  nextBtn.addEventListener('click',function(){ goTo(cur+1); });
  jumpEl.addEventListener('click',function(e){
    var b=e.target.closest('.jbtn');
    if(!b) return;
    goTo(+b.getAttribute('data-i'));
  });

  /* ---------- 送出 ---------- */
  var confirmOverlay=document.getElementById('confirmOverlay');
  var resultOverlay=document.getElementById('resultOverlay');

  submitBtn.addEventListener('click', function(){
    if(checkedCount()<N||!studentInfoFilled()) return; /* 防呆：按鈕理論上此時已 disabled */
    confirmOverlay.hidden=false;
  });
  var confirmOkBtn=document.getElementById('confirmOkBtn');
  var confirmCancelBtn=document.getElementById('confirmCancelBtn');
  var confirmErr=document.getElementById('confirmErr');
  confirmCancelBtn.addEventListener('click', function(){
    if(sending) return;
    confirmErr.textContent='';
    confirmOverlay.hidden=true;
  });
  confirmOkBtn.addEventListener('click', function(){
    if(submitted||sending) return;
    if(!ONLINE_SUBMIT){ finalizeSubmit(null); return; }
    /* 線上分享版：先送到 server，成功才鎖定；失敗留在確認視窗顯示錯誤，可以再按一次 */
    sending=true;
    confirmErr.textContent='';
    confirmOkBtn.disabled=true;
    confirmCancelBtn.disabled=true;
    confirmOkBtn.textContent='送出中…';
    qfSubmit({
      sessionId:SID,
      className:classInput.value.trim(),
      studentName:nameInput.value.trim(),
      answers:state.map(function(s){ return { typed:s.checkedTyped, hintUses:s.hintUses }; })
    }, function(err,data){
      sending=false;
      confirmOkBtn.disabled=false;
      confirmCancelBtn.disabled=false;
      confirmOkBtn.textContent='確定送出';
      if(err){ confirmErr.textContent=err; return; }
      finalizeSubmit(data);
    });
  });

  function finalizeSubmit(serverResult){
    submitted=true;
    classInput.disabled=true;
    nameInput.disabled=true;
    confirmOverlay.hidden=true;
    showResult(serverResult);
    renderQuestion();
  }
  document.getElementById('resultCloseBtn').addEventListener('click', function(){
    resultOverlay.hidden=true;
  });

  function showResult(serverResult){
    document.getElementById('resultStudentInfo').textContent=classInput.value.trim()+'　'+nameInput.value.trim();
    /* 線上版以 server 重算的分數為準（老師端看到的就是這個分數） */
    document.getElementById('finalScore').textContent=serverResult?serverResult.score:totalScore();
    document.getElementById('submitStatus').innerHTML=serverResult
      ?'<div class="qf-ok" style="margin-top:12px">✅ 已送出成績給老師</div>'+qfClassroomHtml(serverResult)
      :'';
    document.getElementById('resultList').innerHTML=QUESTIONS.map(function(q,i){
      var ok=state[i].correct;
      return '<div class="result-item"><span>'+(ok?'✅':'❌')+' 第 '+(i+1)+' 題：'+esc(q.answer)+'</span><span class="result-score">'+blankScore(i).toFixed(1)+' 分</span></div>';
    }).join('');
    resultOverlay.hidden=false;
  }

  renderQuestion();
})();
</script>
</body>
</html>
`;
}
