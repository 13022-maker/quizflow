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

import {
  PRACTICE_PAGE_SUBMIT_CLIENT_JS,
  PRACTICE_PAGE_SUBMIT_CSS,
  upgradeLegacyPracticePageSubmitJs,
} from './practicePageSubmitClient';

export type PracticePageOption = string | { img: string; alt?: string };

export type PracticePageQuestion = {
  groupLabel: string;
  question: string;
  image?: string | false; // '<img src="...">' 字串,或 false 表示無圖
  diagramSvg?: string; // AI 出題附的圖解 SVG(完整 <svg>...</svg> 字串,無則不填)
  options: PracticePageOption[];
  correctIndex: number;
  explanation?: string; // 目前 QuizFlow 題目資料庫不存詳解，通常是空字串
  id?: number; // DB question.id：作答事件帶回去對應題目（舊版匯出沒有這欄）
};

export type PracticePageParams = {
  title: string; // <title> 與頁首大標題
  kick: string; // masthead 小標題（例如「QuizFlow 測驗匯出．丙級電腦硬體裝修」）
  enSubtitle?: string; // masthead 英文副標，可省略
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

// 匯出練習頁時支援的題型：只有「四選一、單一正解」撐得起靜態頁的互動邏輯，
// 排序題/簡答題/克漏字/聽力題/多選題不套用，遇到直接略過（見 route 檔案的說明）。
const SUPPORTED_TYPES = new Set(['single_choice', 'true_false']);

// 是非題在 DB 沒存 options 時，作答頁本來就會自動補上這組預設選項（見
// CLAUDE.md「是非題作答」bug fix 記錄），匯出時要對齊同一套預設，不然會漏題。
const DEFAULT_TF_OPTIONS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

export type RawQuestionForExport = {
  id?: number;
  type: string;
  body: string;
  imageUrl?: string | null;
  diagramSvg?: string | null;
  explanation?: string | null;
  options?: { id: string; text: string }[] | null;
  correctAnswers?: string[] | null;
};

export type SelectPracticeQuestionsParams = {
  groupLabel: string; // 每題顯示在卡片頂端的分組名稱（目前都帶 quiz 標題）
  questions: RawQuestionForExport[];
};

export type SelectPracticeQuestionsResult = {
  practiceQuestions: PracticePageQuestion[];
  skipped: number; // 不支援的題型，或 options/correctAnswers 資料不完整而略過的題數
};

// 把 DB 撈出來的原始題目資料篩選、轉換成靜態練習頁要用的格式。
// 純函式：不碰 DB，方便測試；route 只負責撈資料跟呼叫它。
export function selectPracticeQuestions(
  params: SelectPracticeQuestionsParams,
): SelectPracticeQuestionsResult {
  const { groupLabel, questions } = params;
  const practiceQuestions: PracticePageQuestion[] = [];
  let skipped = 0;

  for (const q of questions) {
    if (!SUPPORTED_TYPES.has(q.type)) {
      skipped++;
      continue;
    }
    const options = q.options?.length ? q.options : (q.type === 'true_false' ? DEFAULT_TF_OPTIONS : null);
    const correctId = q.correctAnswers?.[0];
    const correctIndex = options && correctId ? options.findIndex(o => o.id === correctId) : -1;
    if (!options || correctIndex === -1) {
      skipped++;
      continue;
    }

    practiceQuestions.push({
      groupLabel,
      question: q.body,
      image: q.imageUrl ? `<img src="${q.imageUrl.replace(/"/g, '&quot;')}">` : false,
      diagramSvg: q.diagramSvg || undefined,
      options: options.map(o => o.text),
      correctIndex,
      explanation: q.explanation ?? undefined,
      ...(q.id ? { id: q.id } : {}),
    });
  }

  return { practiceQuestions, skipped };
}

// 練習頁 <head> 裡的佔位註解：/api/p/[id] 代理回傳時把它換成 config <script>（含事件端點網址）。
// 下載的離線檔不經過代理，佔位註解原樣留著 → 沒有 config → 統計 hooks 全部 no-op。
// 舊版（加這功能前）上傳的 HTML 沒有這個 marker，代理就原樣回傳，不會壞。
export const PRACTICE_PAGE_CONFIG_MARKER = '<!--qf-practice-config-->';

export type PracticePageRuntimeConfig = {
  endpoint: string; // 作答事件 POST 網址
  signupUrl: string; // 身分選「老師」時顯示的 QuizFlow 註冊連結
  submitEndpoint?: string; // 「確認送出」成績回傳網址（/api/p/[id]/submit）；沒有就不顯示班級姓名欄與送出按鈕
  submitTimeoutMs?: number; // 送出逾時毫秒數；不帶就用練習頁內建預設值（測試用來縮短等待）
};

export function hasPracticePageAnalytics(html: string): boolean {
  return html.includes(PRACTICE_PAGE_CONFIG_MARKER);
}

export function injectPracticePageConfig(html: string, config: PracticePageRuntimeConfig): string {
  if (!hasPracticePageAnalytics(html)) {
    return html;
  }
  // 已寫進 Blob 的舊版頁面（PR #90–#99）：把送出程式換成新版（逾時 + 成功後保證顯示結果），老師不用重新匯出
  return upgradeLegacyPracticePageSubmitJs(html).replace(
    PRACTICE_PAGE_CONFIG_MARKER,
    `<script>window.__QF_PRACTICE__=${toEmbeddableJson(config)};</script>`,
  );
}

export function buildPracticePageHtml(params: PracticePageParams): string {
  const { title, kick, enSubtitle, questions } = params;

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
  .dock{position:sticky;top:0;z-index:30;margin:0 -18px;padding:10px 18px;background:rgba(244,247,251,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--blue-line)}
  .dock-inner{max-width:760px;margin:0 auto;display:flex;align-items:center;gap:14px}
  .bar{flex:1;height:9px;border-radius:99px;background:#e3ebf3;overflow:hidden}
  .bar>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f8fd6,var(--ok));transition:width .35s ease}
  .count{font-size:13px;font-weight:700;color:var(--blue-dark);white-space:nowrap}
  .count b{color:var(--ok);font-size:15px}
  .count b.ok{color:var(--ok)}

  /* 題號跳題列跟上一題/下一題合併固定在進度條下方，最多顯示 3 列，題數多時在這個小區塊內捲動，
     不會把整個導覽列撐高推擠到題目卡片 */
  .dock-nav{max-width:760px;margin:8px auto 0;display:flex;align-items:flex-start;gap:10px}

  .qcard{margin-top:18px;background:var(--card);border:1px solid var(--blue-line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;animation:pop .2s ease}
  @keyframes pop{from{transform:translateY(6px);opacity:0}to{transform:none;opacity:1}}
  .grouplabel{background:var(--blue-soft);border-bottom:1px solid var(--blue-line);padding:10px 18px;font-weight:700;color:var(--blue-dark);font-size:13.5px}
  .qbody{padding:20px 22px 6px}
  .qtext{font-size:16px;font-weight:700;margin:0 0 14px;white-space:pre-wrap}
  .qcode{margin:0 0 14px;padding:12px 14px;background:#f3f6fa;border:1px solid var(--blue-line);border-radius:8px;overflow-x:auto;white-space:pre;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;text-align:left}
  .qimg{margin:0 0 16px;display:flex;justify-content:center}
  .qimg svg{max-width:100%;height:auto}
  .qimg img{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--blue-line);background:#fff}

  .opts{padding:2px 22px 20px;display:flex;flex-direction:column;gap:8px}
  .opts.grid2{display:grid;grid-template-columns:1fr 1fr}
  .opt{display:flex;align-items:center;gap:10px;padding:8px 14px;border:1.5px solid var(--blue-line);border-radius:12px;background:#fff;cursor:pointer;font-size:14.5px;transition:.15s;text-align:left}
  .opt:hover{border-color:var(--blue);background:var(--blue-soft)}
  .opt .num{flex:none;width:22px;height:22px;border-radius:50%;background:#eef4fa;color:var(--blue-dark);font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
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

  .btn{border:none;border-radius:var(--radius);font-weight:800;font-size:14.5px;padding:10px 20px;cursor:pointer;font-family:inherit;transition:.15s;flex:none}
  .btn.primary{background:linear-gradient(180deg,var(--blue),var(--blue-dark));color:#fff;box-shadow:0 4px 12px rgba(30,90,138,.3)}
  .btn.primary:hover{filter:brightness(1.06)}
  .btn.primary:disabled{opacity:.4;cursor:not-allowed;filter:none}
  .btn.sub{background:#eef4fa;color:var(--blue-dark);border:1.5px solid var(--blue-line)}
  .btn.sub:hover{background:var(--blue-soft)}
  .btn.sub:disabled{opacity:.4;cursor:not-allowed}
  .jump{display:flex;gap:6px;flex-wrap:wrap;flex:1;justify-content:center;max-height:104px;overflow-y:auto;padding:2px}
  .jbtn{width:30px;height:30px;flex:none;border-radius:8px;border:1.5px solid var(--blue-line);background:#fff;color:var(--blue-dark);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit}
  .jbtn.cur{border-color:var(--blue);background:var(--blue);color:#fff}
  .jbtn.done{border-color:var(--ok);color:var(--ok)}
  .jbtn.done.cur{background:var(--ok);border-color:var(--ok);color:#fff}

  /* 作答結束畫面 */
  .endbody{padding:22px}
  .score{font-size:40px;font-weight:800;color:var(--blue-dark);text-align:center;line-height:1.2}
  .score b{color:var(--ok)}
  .scoresub{text-align:center;color:var(--muted);font-size:13.5px;margin-top:2px}
  .endsec{margin-top:20px;padding-top:16px;border-top:1px dashed var(--blue-line)}
  .endsec.allok{text-align:center;font-weight:700;color:var(--ok)}
  .endh{display:block;font-weight:800;font-size:14px;margin-bottom:10px}
  .wronglist{display:flex;flex-wrap:wrap;gap:6px}
  .jbtn.wrongj{border-color:var(--err);color:var(--err)}
  .jbtn.endj{width:auto;padding:0 8px;border-color:var(--ok);color:var(--ok)}
  .plabel{font-size:12.5px;color:var(--muted);font-weight:700;margin:10px 0 6px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{border:1.5px solid var(--blue-line);background:#fff;color:var(--blue-dark);border-radius:99px;padding:6px 12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
  .chip.on{background:var(--blue);border-color:var(--blue);color:#fff}
  .teacher{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--blue-soft);font-size:13.5px}
  .teacher a{color:var(--blue-dark);font-weight:800}
  .leadrow{display:flex;gap:8px}
  .leadrow input[type=email]{flex:1;min-width:0;padding:9px 12px;border:1.5px solid var(--blue-line);border-radius:var(--radius);font-size:16px;font-family:inherit;color:var(--ink)}
  .consent{display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;cursor:pointer}
  .consent input{margin-top:3px;flex:none}
  .leaderr{color:var(--err);font-size:12.5px;margin-top:6px;min-height:1em}
  .privacy{font-size:12px;color:var(--hint);margin-top:4px}
  .leadok{color:var(--ok);font-weight:700}
  .endgo{display:block;margin-top:12px}

${PRACTICE_PAGE_SUBMIT_CSS}
  .kbdhint{margin-top:14px;text-align:center;font-size:12px;color:var(--hint)}
  .kbdhint kbd{background:#fff;border:1px solid var(--blue-line);border-radius:5px;padding:1px 6px;font-family:inherit;font-size:11.5px;color:var(--blue-dark)}
  .foot{margin-top:22px;text-align:center;font-size:12px;color:var(--hint)}

  @media (max-width:480px){
    .masthead h1{font-size:19px}
    .qbody{padding:16px 16px 4px}
    .opts{padding:2px 16px 16px}
    .explain{margin:0 16px 16px}
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

  <!-- 班級/姓名：只有線上分享版（代理注入 submitEndpoint）才顯示，下載的離線檔維持原樣 -->
  <div class="studentinfo" id="studentInfo" hidden>
    <label>班級<input type="text" id="classInput" autocomplete="off" maxlength="40"></label>
    <label>姓名<input type="text" id="nameInput" autocomplete="off" maxlength="40"></label>
  </div>

  <div class="dock">
    <div class="dock-inner">
      <div class="bar"><span id="progressBar"></span></div>
      <div class="count">第 <b id="curNum">1</b> / <span id="totalNum">-</span> 題　答對 <b class="ok" id="correctNum">0</b></div>
    </div>
    <div class="dock-nav">
      <button class="btn sub" id="prevBtn">← 上一題</button>
      <div class="jump" id="jump"></div>
      <button class="btn primary" id="nextBtn">下一題 →</button>
    </div>
  </div>

  <div class="qcard" id="qcard"></div>

  <div class="kbdhint">鍵盤操作　<kbd>←</kbd>/<kbd>→</kbd> 或 <kbd>↑</kbd>/<kbd>↓</kbd> 切換題目　·　<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> 選擇選項</div>
  <div class="foot">📘 免登入、不計時，答題後立即顯示對錯。這份頁面是獨立檔案，離線也能開；把它放到任何網頁空間都能用。<br>由 QuizFlow 提供 · 從測驗匯出</div>
</div>

<script>
(function(){
  "use strict";
  function esc(s){return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  // 程式題：題目內 markdown 圍欄（三個反引號）包住的程式碼改用等寬 <pre> 顯示，保留縮排；內容一律 esc
  function qtextHtml(s){
    var F='\\x60\\x60\\x60';
    var parts=(''+s).replace(/\\r\\n?/g,'\\n').split(F);
    if(parts.length<3){return '<p class="qtext">'+esc(s)+'</p>';}
    var h='';
    for(var i=0;i<parts.length;i++){
      var p=parts[i];
      if(i%2===1){
        var nl=p.indexOf('\\n');
        var code=(nl===-1?p:p.slice(nl+1)).replace(/^\\n+|\\n+$/g,'');
        if(code){h+='<pre class="qcode"><code>'+esc(code)+'</code></pre>';}
      }else{
        p=p.replace(/^\\n+|\\n+$/g,'');
        if(p){h+='<p class="qtext">'+esc(p)+'</p>';}
      }
    }
    return h;
  }

  var QUESTIONS=${toEmbeddableJson(questions)};

  /* ---------- state ---------- */
  var cur=0;
  var answered=new Array(QUESTIONS.length).fill(-1); /* -1=未作答,否則為選擇的 index */
  var completed=false; /* 所有題目都作答完 */
  var showEnd=false; /* 目前是否顯示作答結束畫面 */

  /* ---------- 作答統計：只有從 QuizFlow 分享連結開啟（代理注入 config）才會送出；
     下載的離線檔沒有 config，send() 直接 no-op。任何錯誤都吞掉，絕不影響作答 ---------- */
  var CFG=window.__QF_PRACTICE__||null;
  function uuid(){
    try{ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
  }
  var SID=uuid(); /* 每次開頁 = 一次作答 session，只存在記憶體，不用 cookie */
${PRACTICE_PAGE_SUBMIT_CLIENT_JS}
  /* 線上分享版才啟用班級姓名欄與「確認送出」；離線檔 ONLINE_SUBMIT=false，結束畫面維持原樣 */
  var ONLINE_SUBMIT=!!qfSubmitEndpoint();
  var classInput=document.getElementById('classInput');
  var nameInput=document.getElementById('nameInput');
  if(ONLINE_SUBMIT) document.getElementById('studentInfo').hidden=false;
  var submitState={sending:false,result:null,error:''};
  function send(payload){
    if(!CFG||!CFG.endpoint) return;
    try{
      payload.sessionId=SID;
      var body=JSON.stringify(payload);
      var sent=false;
      if(navigator.sendBeacon){
        try{ sent=navigator.sendBeacon(CFG.endpoint,new Blob([body],{type:'text/plain;charset=UTF-8'})); }catch(e){ sent=false; }
      }
      if(!sent&&window.fetch){
        fetch(CFG.endpoint,{method:'POST',body:body,keepalive:true,credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'}}).catch(function(){});
      }
    }catch(e){}
  }
  (function(){
    var sp=null; try{ sp=new URLSearchParams(location.search); }catch(e){}
    var ref=null; try{ if(document.referrer) ref=new URL(document.referrer).hostname; }catch(e){}
    var mobile=false; try{ mobile=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'')||(!!window.matchMedia&&matchMedia('(pointer:coarse)').matches); }catch(e){}
    send({
      type:'session_start',
      utmSource:sp?sp.get('utm_source'):null,
      utmContent:sp?sp.get('utm_content'):null,
      utmCampaign:sp?sp.get('utm_campaign'):null,
      referrerHost:ref,
      deviceType:mobile?'mobile':'desktop'
    });
  })();

  /* 每題累積停留時間（切到別題或切走分頁時暫停） */
  var spent=new Array(QUESTIONS.length).fill(0);
  var enterIdx=0, enterAt=Date.now();
  function leaveCurrent(){ if(enterIdx!==-1){ spent[enterIdx]+=Date.now()-enterAt; enterIdx=-1; } }
  function enterQuestion(i){ leaveCurrent(); enterIdx=i; enterAt=Date.now(); }
  document.addEventListener('visibilitychange',function(){
    if(document.hidden) leaveCurrent();
    else if(!showEnd) enterQuestion(cur);
  });

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
    }).join('')+(completed?'<button type="button" class="jbtn endj'+(showEnd?' cur':'')+'" data-end="1" title="查看成績">🏁 成績</button>':'');
  }

  function imageHtml(q){
    if(!q.image) return ''; /* false 或沒填都視為沒有圖 */
    return '<div class="qimg">'+q.image+'</div>';
  }

  function diagramHtml(q){
    if(!q.diagramSvg) return ''; /* 沒有圖解就不顯示 */
    return '<div class="qimg">'+q.diagramSvg+'</div>';
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

  /* 選項都是短文字(非圖片、長度在 6 字以內)才排成 2 欄,文字一長排 2 欄容易換行、高度不一反而亂 */
  function isShortOptions(options){
    return options.every(function(opt){
      return typeof opt==='string' && opt.length<=6;
    });
  }

  function renderQuestion(){
    var q=QUESTIONS[cur];
    var picked=answered[cur];
    var isAnswered=picked!==-1;
    var imgHtml=imageHtml(q)+diagramHtml(q);
    var optsHtml=q.options.map(function(opt,i){
      var cls='opt';
      if(isAnswered){
        if(i===q.correctIndex) cls+=' correct';
        else if(i===picked) cls+=' wrong';
      }
      return '<button type="button" class="'+cls+'" data-i="'+i+'"><span class="num">'+(i+1)+'</span>'+optionContent(opt)+'</button>';
    }).join('');
    var explainText=q.explanation?('<br><b>詳解:</b>'+q.explanation):'';
    var endGoHtml=completed?'<button type="button" class="btn primary endgo" id="toEnd">全部作答完畢，查看成績 →</button>':'';
    var explainHtml=isAnswered?('<div class="explain show">'+(picked===q.correctIndex?'✅ 答對了!':'❌ 答錯了,正確答案是「'+optionLabel(q.options[q.correctIndex],q.correctIndex)+'」。')+explainText+endGoHtml+'</div>'):'<div class="explain"></div>';

    qcard.className='qcard'+(isAnswered?' answered':'');
    qcard.innerHTML=
      '<div class="grouplabel">'+esc(q.groupLabel)+'　第 '+(cur+1)+' 題</div>'+
      '<div class="qbody">'+qtextHtml(q.question)+imgHtml+'</div>'+
      '<div class="opts'+(isShortOptions(q.options)?' grid2':'')+'">'+optsHtml+'</div>'+
      explainHtml;

    qcard.querySelectorAll('.opt').forEach(function(btn){
      btn.addEventListener('click',function(){
        selectOption(cur,+btn.getAttribute('data-i'));
      });
    });
    var toEnd=document.getElementById('toEnd');
    if(toEnd) toEnd.addEventListener('click',renderEnd);

    document.getElementById('curNum').textContent=cur+1;
    document.getElementById('correctNum').textContent=correctCount();
    document.getElementById('progressBar').style.width=(answeredCount()/QUESTIONS.length*100)+'%';
    prevBtn.disabled=(cur===0);
    var isLast=(cur===QUESTIONS.length-1);
    nextBtn.disabled=isLast&&!completed;
    nextBtn.textContent=(isLast&&completed)?'看成績 →':'下一題 →';
    renderJump();
  }

  function selectOption(qi,oi){
    if(answered[qi]!==-1) return; /* 已作答過就不能再改,維持第一次作答的結果 */
    answered[qi]=oi;
    var q=QUESTIONS[qi];
    send({
      type:'answer',
      questionIndex:qi,
      questionId:q.id||null,
      chosenOption:oi,
      isCorrect:oi===q.correctIndex,
      msOnQuestion:spent[qi]+(enterIdx===qi?Date.now()-enterAt:0)
    });
    if(!completed&&answeredCount()===QUESTIONS.length){
      completed=true;
      send({type:'complete',answeredCount:answeredCount(),correctCount:correctCount()});
    }
    if(qi===cur) renderQuestion();
    else renderJump();
  }

  function goTo(i){
    if(i===QUESTIONS.length&&completed&&!showEnd){ renderEnd(); return; }
    if(i<0||i>=QUESTIONS.length) return;
    showEnd=false;
    cur=i;
    enterQuestion(i);
    renderQuestion();
  }
  function goPrev(){ if(showEnd) goTo(cur); else goTo(cur-1); }
  function goNext(){ goTo(cur+1); }

  /* ---------- 作答結束畫面：分數、錯題跳轉；線上版另有選填的自我回報與 email ---------- */
  var profile={role:null,language:null,examPlan:null};
  var leadSent=false;
  var PROFILE_GROUPS=[
    ['role','身分',[['junior_high','國中'],['senior_high','高中'],['college','大學'],['teacher','老師'],['parent','家長'],['other','其他']]],
    ['language','題本語言',[['cpp','C++'],['python','Python']]],
    ['examPlan','預計應考',[['soon','近期一場'],['later','之後'],['none','不考'],['taken','已考過']]]
  ];
  function isTypingTarget(t){ return !!t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable); }

  function profileHtml(){
    var h='<div class="endsec"><div class="endh">讓出題老師更了解你（選填，點一下就好，不收個人資料）</div>';
    PROFILE_GROUPS.forEach(function(g){
      h+='<div class="plabel">'+g[1]+'</div><div class="chips" data-g="'+g[0]+'">'+g[2].map(function(o){
        return '<button type="button" class="chip'+(profile[g[0]]===o[0]?' on':'')+'" data-v="'+o[0]+'">'+o[1]+'</button>';
      }).join('')+'</div>';
    });
    if(CFG.signupUrl){
      h+='<div class="teacher" id="teacherInvite"'+(profile.role==='teacher'?'':' hidden')+'>👩‍🏫 您是老師嗎？這份練習頁就是用 QuizFlow 做的，上傳講義就能自動出題、產生同樣的練習頁。<br><a href="'+esc(CFG.signupUrl)+'" target="_blank" rel="noopener">免費用 QuizFlow 出自己的題目 →</a></div>';
    }
    return h+'</div>';
  }

  function leadHtml(){
    if(leadSent) return '<div class="endsec"><div class="leadok">✅ 收到了！下一份練習題準備好會寄給你。</div></div>';
    return '<div class="endsec"><form id="leadForm" novalidate>'+
      '<label class="endh" for="leadEmail">想收到下一份 20 題和考前提醒？留 email（選填）</label>'+
      '<div class="leadrow"><input id="leadEmail" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com"><button type="submit" class="btn primary">送出</button></div>'+
      '<label class="consent"><input id="leadConsent" type="checkbox"><span>我同意 QuizFlow 用此 email 寄送練習題與考試提醒，可隨時取消</span></label>'+
      '<div class="leaderr" id="leadErr"></div>'+
      '<div class="privacy">🔒 只保存 email、同意時間與這次作答的匿名代碼，不公開、不轉售，每封信都能一鍵取消。未滿 18 歲請先徵得家長同意。</div>'+
      '</form></div>';
  }

  /* ---------- 線上分享版：把成績送給老師 ---------- */
  function submitHtml(){
    if(submitState.result){
      return '<div class="endsec"><div class="qf-ok">✅ 已送出成績給老師（'+esc(submitState.result.score)+' / '+esc(submitState.result.maxScore)+' 分）</div>'+qfClassroomHtml(submitState.result)+'</div>';
    }
    return '<div class="endsec"><div class="endh">把這次成績送給老師（送出後不能修改）</div>'+
      '<button type="button" class="btn primary" id="submitScoreBtn"'+(submitState.sending?' disabled':'')+'>'+(submitState.sending?'送出中…':'✅ 確認送出')+'</button>'+
      '<div class="qf-err" id="submitErr"></div></div>';
  }

  function doSubmitScore(){
    if(submitState.sending||submitState.result) return;
    var cls=classInput.value.trim(), nm=nameInput.value.trim();
    if(!cls||!nm){
      submitState.error='請先在頁面最上方填寫班級、姓名再送出';
      renderEnd(true);
      try{ classInput.focus(); }catch(e){}
      return;
    }
    submitState.sending=true;
    submitState.error='';
    renderEnd(true);
    qfSubmit({sessionId:SID,className:cls,studentName:nm,answers:answered.slice()},function(err,data){
      submitState.sending=false;
      if(err){ submitState.error=err; }
      else{ submitState.result=data; classInput.disabled=true; nameInput.disabled=true; }
      if(showEnd) renderEnd(true);
    });
  }

  /* keepScroll===true：送出流程的重繪不捲回頂端（手機上送出中／結果／錯誤訊息會被推到畫面外，學生以為當掉）；
     注意 addEventListener 會傳 event 物件進來，所以用嚴格等於判斷 */
  function renderEnd(keepScroll){
    showEnd=true;
    leaveCurrent();
    var n=QUESTIONS.length, c=correctCount(), wrong=[];
    for(var i=0;i<n;i++){ if(answered[i]!==-1&&answered[i]!==QUESTIONS[i].correctIndex) wrong.push(i); }
    var h='<div class="grouplabel">作答結果</div><div class="endbody">'+
      '<div class="score"><b>'+c+'</b> / '+n+'</div>'+
      '<div class="scoresub">答對率 '+Math.round(c/n*100)+'%</div>'+
      (wrong.length
        ?'<div class="endsec"><div class="endh">答錯的題目（點題號回去看詳解）</div><div class="wronglist">'+wrong.map(function(i){
          return '<button type="button" class="jbtn wrongj" data-i="'+i+'">'+(i+1)+'</button>';
        }).join('')+'</div></div>'
        :'<div class="endsec allok">🎉 全部答對！</div>');
    if(ONLINE_SUBMIT){ h+=submitHtml(); }
    if(CFG&&CFG.endpoint){ h+=profileHtml()+leadHtml(); }
    h+='</div>';

    qcard.className='qcard';
    qcard.innerHTML=h;

    qcard.querySelectorAll('.wrongj').forEach(function(b){
      b.addEventListener('click',function(){ goTo(+b.getAttribute('data-i')); });
    });
    qcard.querySelectorAll('.chips').forEach(function(group){
      group.addEventListener('click',function(e){
        var chip=e.target.closest('.chip');
        if(!chip) return;
        var key=group.getAttribute('data-g');
        profile[key]=chip.getAttribute('data-v');
        group.querySelectorAll('.chip').forEach(function(x){ x.classList.toggle('on',x===chip); });
        var invite=document.getElementById('teacherInvite');
        if(invite) invite.hidden=profile.role!=='teacher';
        send({type:'profile',role:profile.role,language:profile.language,examPlan:profile.examPlan});
      });
    });
    var submitScoreBtn=document.getElementById('submitScoreBtn');
    if(submitScoreBtn) submitScoreBtn.addEventListener('click',doSubmitScore);
    var submitErr=document.getElementById('submitErr');
    if(submitErr) submitErr.textContent=submitState.error;
    var form=document.getElementById('leadForm');
    if(form){
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var email=(document.getElementById('leadEmail').value||'').trim();
        var err=document.getElementById('leadErr');
        if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ err.textContent='email 格式看起來不太對，再檢查一下'; return; }
        if(!document.getElementById('leadConsent').checked){ err.textContent='請先勾選同意，我們才能寄信給你'; return; }
        send({type:'lead',email:email,consent:true});
        leadSent=true;
        renderEnd();
      });
    }

    document.getElementById('progressBar').style.width='100%';
    document.getElementById('correctNum').textContent=c;
    prevBtn.disabled=false;
    nextBtn.disabled=true;
    nextBtn.textContent='下一題 →';
    renderJump();
    if(keepScroll!==true){ try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){} }
  }

  prevBtn.addEventListener('click',goPrev);
  nextBtn.addEventListener('click',goNext);
  jumpEl.addEventListener('click',function(e){
    var b=e.target.closest('.jbtn');
    if(!b) return;
    if(b.hasAttribute('data-end')){ renderEnd(); return; }
    goTo(+b.getAttribute('data-i'));
  });

  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    if(isTypingTarget(e.target)) return; /* 在 email 欄位打字時不要觸發快捷鍵 */
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){ e.preventDefault(); goNext(); }
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ e.preventDefault(); goPrev(); }
    else if(showEnd){ return; }
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
