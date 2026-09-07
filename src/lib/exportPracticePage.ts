/* eslint-disable no-irregular-whitespace -- 版面裡幾處全形空格（　）是刻意的中文排版間距，
   逐字沿用自 public/practice/circuit-diagram.html（純 HTML 檔不會被這條規則掃到），
   不是打字失誤，不要被 autofix 拿掉 */

/**
 * exportPracticePage.ts — 把一份 QuizFlow 測驗（或其中一段題號範圍）轉成獨立的
 * 靜態練習頁 HTML（免登入、不計時、答題立即顯示對錯），格式跟手動做的
 * public/practice/circuit-diagram.html 一致——這支是把那份頁面的殼（CSS/JS）
 * 抽成可重用的產生器，資料換成呼叫端傳進來的真實題目。
 *
 * 純函式：不碰 DB、不碰 Request，方便測試；由 export-practice-page/route.ts 呼叫。
 */

export type PracticePageOption = string | { img: string; alt?: string };

export type PracticePageQuestion = {
  groupLabel: string;
  question: string;
  image?: string | false; // '<img src="...">' 字串,或 false 表示無圖
  options: PracticePageOption[];
  correctIndex: number;
  explanation?: string; // 目前 QuizFlow 題目資料庫不存詳解，通常是空字串
};

export type PracticePageParams = {
  title: string; // <title> 與頁首大標題
  kick: string; // masthead 小標題（例如「QuizFlow 測驗匯出．丙級電腦硬體裝修」）
  enSubtitle?: string; // masthead 英文副標，可省略
  noteHtml: string; // 免登入說明區塊內容，可含簡單 <b> 標籤
  questions: PracticePageQuestion[];
};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 把資料安全地內嵌進 <script> 標籤：JSON.stringify 本身不會跳脫 "</script>"，
// 題目內容如果剛好出現這個字串會提前把 <script> 標籤截斷，統一把 "<" 轉成 < 防呆。
function toEmbeddableJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildPracticePageHtml(params: PracticePageParams): string {
  const { title, kick, enSubtitle, noteHtml, questions } = params;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} | QuizFlow</title>
<style>
  :root{
    --ink:#0f2540; --blue:#1e5a8a; --blue-dark:#17466b;
    --blue-soft:#dceaf5; --blue-line:#b9d3e8; --paper:#f4f7fb; --card:#fff;
    --ok:#15803d; --ok-soft:#e7f6ec; --err:#c62828; --err-soft:#fdecec;
    --muted:#5a6b7d; --hint:#8091a1; --radius:10px;
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
  .note{margin-top:14px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:12px 14px;font-size:13.5px;display:flex;gap:10px;align-items:flex-start;position:relative;z-index:2}
  .note b{color:#fff}
  .note .src{opacity:.85;font-size:12px;margin-top:6px}

  .dock{position:sticky;top:0;z-index:30;margin:0 -18px;padding:10px 18px;background:rgba(244,247,251,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--blue-line)}
  .dock-inner{max-width:760px;margin:0 auto;display:flex;align-items:center;gap:14px}
  .bar{flex:1;height:9px;border-radius:99px;background:#e3ebf3;overflow:hidden}
  .bar>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f8fd6,var(--ok));transition:width .35s ease}
  .count{font-size:13px;font-weight:700;color:var(--blue-dark);white-space:nowrap}
  .count b{color:var(--ok);font-size:15px}
  .count b.ok{color:var(--ok)}

  .qcard{margin-top:18px;background:var(--card);border:1px solid var(--blue-line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;animation:pop .2s ease}
  @keyframes pop{from{transform:translateY(6px);opacity:0}to{transform:none;opacity:1}}
  .grouplabel{background:var(--blue-soft);border-bottom:1px solid var(--blue-line);padding:10px 18px;font-weight:700;color:var(--blue-dark);font-size:13.5px}
  .qbody{padding:20px 22px 6px}
  .qtext{font-size:16px;font-weight:700;margin:0 0 14px}
  .qimg{margin:0 0 16px;display:flex;justify-content:center}
  .qimg svg{max-width:100%;height:auto}
  .qimg img{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--blue-line);background:#fff}

  .opts{padding:2px 22px 20px;display:flex;flex-direction:column;gap:10px}
  .opt{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid var(--blue-line);border-radius:12px;background:#fff;cursor:pointer;font-size:14.5px;transition:.15s;text-align:left}
  .opt:hover{border-color:var(--blue);background:var(--blue-soft)}
  .opt .num{flex:none;width:26px;height:26px;border-radius:50%;background:#eef4fa;color:var(--blue-dark);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
  .opt img{max-height:64px;width:auto;max-width:150px;background:#fff}
  .opt.correct{border-color:var(--ok);background:var(--ok-soft)}
  .opt.correct .num{background:var(--ok);color:#fff}
  .opt.wrong{border-color:var(--err);background:var(--err-soft)}
  .opt.wrong .num{background:var(--err);color:#fff}
  .qcard.answered .opt:not(.correct):not(.wrong){opacity:.55}
  .qcard.answered .opt{cursor:default}
  .qcard.answered .opt:hover{background:#fff}
  .qcard.answered .opt.correct:hover,.qcard.answered .opt.wrong:hover{background:inherit}

  .explain{margin:0 22px 20px;padding:14px 16px;border-radius:12px;background:#fff8e6;border:1.5px solid #e6c65b;color:#6b551a;font-size:13.5px;display:none}
  .explain.show{display:block;animation:pop .2s ease}
  .explain b{color:var(--ink)}

  .navbar{margin-top:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .btn{border:none;border-radius:var(--radius);font-weight:800;font-size:14.5px;padding:10px 20px;cursor:pointer;font-family:inherit;transition:.15s}
  .btn.primary{background:linear-gradient(180deg,var(--blue),var(--blue-dark));color:#fff;box-shadow:0 4px 12px rgba(30,90,138,.3)}
  .btn.primary:hover{filter:brightness(1.06)}
  .btn.primary:disabled{opacity:.4;cursor:not-allowed;filter:none}
  .btn.sub{background:#eef4fa;color:var(--blue-dark);border:1.5px solid var(--blue-line)}
  .btn.sub:hover{background:var(--blue-soft)}
  .btn.sub:disabled{opacity:.4;cursor:not-allowed}
  .jump{display:flex;gap:6px;flex-wrap:wrap;flex:1;justify-content:center}
  .jbtn{width:30px;height:30px;border-radius:8px;border:1.5px solid var(--blue-line);background:#fff;color:var(--blue-dark);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit}
  .jbtn.cur{border-color:var(--blue);background:var(--blue);color:#fff}
  .jbtn.done{border-color:var(--ok);color:var(--ok)}
  .jbtn.done.cur{background:var(--ok);border-color:var(--ok);color:#fff}

  .kbdhint{margin-top:14px;text-align:center;font-size:12px;color:var(--hint)}
  .kbdhint kbd{background:#fff;border:1px solid var(--blue-line);border-radius:5px;padding:1px 6px;font-family:inherit;font-size:11.5px;color:var(--blue-dark)}
  .foot{margin-top:22px;text-align:center;font-size:12px;color:var(--hint)}

  @media (max-width:480px){
    .masthead h1{font-size:19px}
    .qbody{padding:16px 16px 4px}
    .opts{padding:2px 16px 16px}
    .explain{margin:0 16px 16px}
    .navbar{justify-content:center}
    .jump{order:3;width:100%}
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
    <div class="note">
      <span>📘</span>
      <div>${noteHtml}</div>
    </div>
  </header>

  <div class="dock">
    <div class="dock-inner">
      <div class="bar"><span id="progressBar"></span></div>
      <div class="count">第 <b id="curNum">1</b> / <span id="totalNum">-</span> 題　答對 <b class="ok" id="correctNum">0</b></div>
    </div>
  </div>

  <div class="qcard" id="qcard"></div>

  <div class="navbar">
    <button class="btn sub" id="prevBtn">← 上一題</button>
    <div class="jump" id="jump"></div>
    <button class="btn primary" id="nextBtn">下一題 →</button>
  </div>

  <div class="kbdhint">鍵盤操作　<kbd>←</kbd>/<kbd>→</kbd> 或 <kbd>↑</kbd>/<kbd>↓</kbd> 切換題目　·　<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> 選擇選項</div>
  <div class="foot">由 QuizFlow 提供 · 從測驗匯出</div>
</div>

<script>
(function(){
  "use strict";
  function esc(s){return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  var QUESTIONS=${toEmbeddableJson(questions)};

  /* ---------- state ---------- */
  var cur=0;
  var answered=new Array(QUESTIONS.length).fill(-1); /* -1=未作答,否則為選擇的 index */

  var qcard=document.getElementById('qcard');
  var jumpEl=document.getElementById('jump');
  var prevBtn=document.getElementById('prevBtn');
  var nextBtn=document.getElementById('nextBtn');

  document.getElementById('totalNum').textContent=QUESTIONS.length;

  function correctCount(){
    var n=0;
    for(var i=0;i<QUESTIONS.length;i++){ if(answered[i]===QUESTIONS[i].correctIndex) n++; }
    return n;
  }
  function answeredCount(){
    var n=0;
    for(var i=0;i<answered.length;i++){ if(answered[i]!==-1) n++; }
    return n;
  }

  function renderJump(){
    jumpEl.innerHTML=QUESTIONS.map(function(_,i){
      var cls='jbtn'+(i===cur?' cur':'')+(answered[i]!==-1?' done':'');
      return '<button type="button" class="'+cls+'" data-i="'+i+'">'+(i+1)+'</button>';
    }).join('');
  }

  function imageHtml(q){
    if(!q.image) return ''; /* false 或沒填都視為沒有圖 */
    return '<div class="qimg">'+q.image+'</div>';
  }

  /* 選項可以是純文字字串,也可以是 {img,alt} 圖片選項 */
  function optionContent(opt){
    if(opt && typeof opt==='object'){
      return '<img src="'+esc(opt.img)+'" alt="'+esc(opt.alt||'')+'">';
    }
    return '<span>'+esc(opt)+'</span>';
  }
  function optionLabel(opt,i){
    if(opt && typeof opt==='object') return '選項 '+(i+1)+'(如圖)';
    return esc(opt);
  }

  function renderQuestion(){
    var q=QUESTIONS[cur];
    var picked=answered[cur];
    var isAnswered=picked!==-1;
    var imgHtml=imageHtml(q);
    var optsHtml=q.options.map(function(opt,i){
      var cls='opt';
      if(isAnswered){
        if(i===q.correctIndex) cls+=' correct';
        else if(i===picked) cls+=' wrong';
      }
      return '<button type="button" class="'+cls+'" data-i="'+i+'"><span class="num">'+(i+1)+'</span>'+optionContent(opt)+'</button>';
    }).join('');
    var explainText=q.explanation?('<br><b>詳解:</b>'+q.explanation):'';
    var explainHtml=isAnswered?('<div class="explain show">'+(picked===q.correctIndex?'✅ 答對了!':'❌ 答錯了,正確答案是「'+optionLabel(q.options[q.correctIndex],q.correctIndex)+'」。')+explainText+'</div>'):'<div class="explain"></div>';

    qcard.className='qcard'+(isAnswered?' answered':'');
    qcard.innerHTML=
      '<div class="grouplabel">'+esc(q.groupLabel)+'　第 '+(cur+1)+' 題</div>'+
      '<div class="qbody"><p class="qtext">'+esc(q.question)+'</p>'+imgHtml+'</div>'+
      '<div class="opts">'+optsHtml+'</div>'+
      explainHtml;

    qcard.querySelectorAll('.opt').forEach(function(btn){
      btn.addEventListener('click',function(){
        selectOption(cur,+btn.getAttribute('data-i'));
      });
    });

    document.getElementById('curNum').textContent=cur+1;
    document.getElementById('correctNum').textContent=correctCount();
    document.getElementById('progressBar').style.width=(answeredCount()/QUESTIONS.length*100)+'%';
    prevBtn.disabled=(cur===0);
    nextBtn.disabled=(cur===QUESTIONS.length-1);
    renderJump();
  }

  function selectOption(qi,oi){
    if(answered[qi]!==-1) return; /* 已作答過就不能再改,維持第一次作答的結果 */
    answered[qi]=oi;
    if(qi===cur) renderQuestion();
    else renderJump();
  }

  function goTo(i){
    if(i<0||i>=QUESTIONS.length) return;
    cur=i;
    renderQuestion();
    qcard.scrollIntoView({block:'nearest',behavior:'smooth'});
  }

  prevBtn.addEventListener('click',function(){ goTo(cur-1); });
  nextBtn.addEventListener('click',function(){ goTo(cur+1); });
  jumpEl.addEventListener('click',function(e){
    var b=e.target.closest('.jbtn');
    if(!b) return;
    goTo(+b.getAttribute('data-i'));
  });

  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){ e.preventDefault(); goTo(cur+1); }
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ e.preventDefault(); goTo(cur-1); }
    else if(e.key>='1'&&e.key<='9'){
      var idx=+e.key-1;
      if(idx<QUESTIONS[cur].options.length){ selectOption(cur,idx); }
    }
  });

  renderQuestion();
})();
</script>
</body>
</html>
`;
}
