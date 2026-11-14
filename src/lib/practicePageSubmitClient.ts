/**
 * 練習頁（選擇題 / 填空）線上分享版「確認送出」的共用內嵌 JS 與 CSS 片段。
 *
 * 由 exportPracticePage.ts、exportFillBlankPracticePage.ts 直接嵌進產生的 HTML <script>/<style> 裡，
 * 兩種練習頁共用同一套送出 + 「繳交到 Google Classroom」按鈕邏輯，避免兩份各寫一套走鐘。
 *
 * 啟用條件：只有從 QuizFlow 分享連結（/api/p/[id] 代理）開啟、代理注入了
 * window.__QF_PRACTICE__.submitEndpoint 才會送出；下載的離線檔沒有 config → qfSubmitEndpoint() 回空字串，
 * 頁面維持原本行為、完全不連網。
 *
 * 依賴：嵌入處的 IIFE 內必須已定義 esc()（兩份練習頁都有）。
 * 注意：這段字串會原樣塞進 TS template literal 產生的 HTML，內容不可含反引號、錢字號加大括號、反斜線。
 */

/**
 * 送出請求本體（含逾時、成功後保證顯示結果）。單獨抽出來，讓 /api/p/[id] 代理也能把已寫進 Blob 的舊版換成這份。
 */
const QF_SUBMIT_JS = `  /* 送出逾時（毫秒）：教室 Wi-Fi / App 內建瀏覽器偶爾整個請求卡住不回應，沒有逾時的話按鈕會永遠停在「送出中…」。
     逾時後讓學生可以重送；server 以 sessionId 冪等，萬一第一次其實已寫入，重送會拿回同一筆結果 */
  function qfSubmitTimeoutMs(){
    try{ var c=window.__QF_PRACTICE__; var t=c&&Number(c.submitTimeoutMs); if(t>0) return t; }catch(e){}
    return 20000;
  }
  /* 把元素捲進畫面（手機上送出結果常在畫面外，學生會以為當掉） */
  function qfReveal(el){
    if(!el||!el.scrollIntoView) return;
    try{ el.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){ try{ el.scrollIntoView(); }catch(e2){} }
  }
  /* 頁面上「看得到」的送出成功訊息（不在 hidden 容器裡）；找不到代表頁面自己的結果畫面沒畫出來 */
  function qfVisibleOk(){
    try{
      var list=document.querySelectorAll('.qf-ok');
      for(var i=0;i<list.length;i++){ if(!list[i].closest('[hidden]')) return list[i]; }
    }catch(e){}
    return null;
  }
  /* 備援面板：頁面自己的結果畫面出錯或學生已離開結束畫面時，仍保證看得到成績與 Classroom 繳交按鈕（不用 alert，避免被 App 內建瀏覽器擋掉） */
  function qfShowFallback(innerHtml){
    try{
      var old=document.getElementById('qfFallbackResult');
      if(old&&old.parentNode) old.parentNode.removeChild(old);
      var box=document.createElement('div');
      box.id='qfFallbackResult';
      box.setAttribute('role','alert');
      box.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:460px;margin:0 auto;max-height:80vh;overflow-y:auto;background:#fff;border:2px solid #1e8e3e;border-radius:14px;padding:16px 18px;box-shadow:0 8px 28px rgba(15,37,64,.25);font-size:14px;color:#0f2540';
      box.innerHTML=innerHtml+'<div style="text-align:center;margin-top:12px"><button type="button" id="qfFallbackClose" style="font:inherit;padding:8px 18px;border-radius:8px;border:1.5px solid #b9d3e8;background:#fff;color:#0f2540;cursor:pointer">關閉</button></div>';
      document.body.appendChild(box);
      var close=document.getElementById('qfFallbackClose');
      if(close) close.addEventListener('click',function(){ if(box.parentNode) box.parentNode.removeChild(box); });
    }catch(e){}
  }
  function qfFallbackResultHtml(data){
    return '<div style="font-weight:800;color:#15803d;text-align:center">✅ 已送出成績給老師（'+esc(data&&data.score)+' / '+esc(data&&data.maxScore)+' 分）</div>'+qfClassroomHtml(data);
  }
  /* cb(錯誤訊息字串或 null, server 回傳資料)；保證 cb 只呼叫一次。
     成功後一定看得到結果：頁面自己畫的結果在畫面外就捲過去；沒畫出來（cb 丟例外、已離開結束畫面）就顯示備援面板 */
  function qfSubmit(payload,cb){
    var done=false, timer=null, ctrl=null;
    function finish(err,data){
      if(done) return;
      done=true;
      if(timer){ try{ clearTimeout(timer); }catch(e){} }
      var threw=false;
      try{ cb(err,data); }catch(e){ threw=true; }
      if(err){
        if(threw) qfShowFallback('<div style="color:#c62828;font-weight:700;text-align:center">'+esc(err)+'</div>');
        return;
      }
      var ok=threw?null:qfVisibleOk();
      if(!ok){ qfShowFallback(qfFallbackResultHtml(data)); return; }
      if(!ok.closest('.overlay')) qfReveal(ok.parentNode||ok);
    }
    /* 選擇題結束畫面在送出時會重繪，先把「送出中…」帶回畫面裡 */
    qfReveal(document.getElementById('submitScoreBtn'));
    var ep=qfSubmitEndpoint();
    if(!ep||!window.fetch){ finish('目前無法送出，請確認網路連線後再試'); return; }
    try{
      try{ if(window.AbortController) ctrl=new AbortController(); }catch(e){ ctrl=null; }
      timer=setTimeout(function(){
        try{ if(ctrl) ctrl.abort(); }catch(e){}
        finish('送出逾時（網路太慢或連線中斷），請確認網路後再按一次送出');
      },qfSubmitTimeoutMs());
      var opts={method:'POST',body:JSON.stringify(payload),credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'}};
      if(ctrl) opts.signal=ctrl.signal;
      fetch(ep,opts)
        .then(function(r){
          return r.json().catch(function(){ return null; }).then(function(d){ return {ok:r.ok,data:d}; });
        })
        .then(function(res){
          if(res.ok&&res.data&&res.data.ok){ finish(null,res.data); return; }
          var msg=(res.data&&typeof res.data.error==='string'&&res.data.error)?res.data.error:'送出失敗，請稍後再試';
          finish(msg);
        },function(){ finish('網路連線失敗，請檢查網路後再按一次送出'); })
        .catch(function(){});
    }catch(e){ finish('送出失敗，請稍後再試'); }
  }
`;

/**
 * PR #90–#99（2026-11-09 起）產生的每份練習頁分享連結，HTML 都把這段 qfSubmit 原樣寫進 Vercel Blob：
 * 沒有逾時、成功後的畫面更新若丟例外會被 promise 吞掉，也不會把結果捲進畫面。
 * 必須與當時產生的字串逐字相同，upgradeLegacyPracticePageSubmitJs 才找得到、換得掉；不要修改這段內容。
 */
export const LEGACY_QF_SUBMIT_JS = `  /* cb(錯誤訊息字串或 null, server 回傳資料) */
  function qfSubmit(payload,cb){
    var ep=qfSubmitEndpoint();
    if(!ep||!window.fetch){ cb('目前無法送出，請確認網路連線後再試'); return; }
    try{
      fetch(ep,{method:'POST',body:JSON.stringify(payload),credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'}})
        .then(function(r){
          return r.json().catch(function(){ return null; }).then(function(d){ return {ok:r.ok,data:d}; });
        })
        .then(function(res){
          if(res.ok&&res.data&&res.data.ok){ cb(null,res.data); return; }
          var msg=(res.data&&typeof res.data.error==='string'&&res.data.error)?res.data.error:'送出失敗，請稍後再試';
          cb(msg);
        },function(){ cb('網路連線失敗，請檢查網路後再按一次送出'); });
    }catch(e){ cb('送出失敗，請稍後再試'); }
  }
`;

/**
 * PR #90–#101 產生的 Classroom 提示行（qfClassroomHtml 裡的一行字串拼接）。
 * 必須與舊 HTML 逐字相同，upgradeLegacyPracticePageSubmitJs 才換得掉；不要修改。
 */
export const LEGACY_QF_CLASSROOM_TIP_LINE = `      '<div class="qf-tip">會開啟 Google Classroom，<b>請選老師出的那份作業 → 按「繳交」</b>，老師才會收到！</div>'+
`;

/** 目前版本的 Classroom 提示行（同樣是 qfClassroomHtml 裡的字串拼接一行） */
const QF_CLASSROOM_TIP_LINE = `      '<div class="qf-tip">會開啟 Google Classroom，<b>請選老師出的那份作業 → 按「繳交」</b>，老師才會收到！'+
      '<div style="margin-top:6px;font-size:12px;color:#8a5a00">⚠️ 需先由老師在 Classroom 建立作業。若 Classroom 顯示「請選取近期有作業的課程」、按鈕按不下去，代表這個課程還沒有作業，請告訴老師。</div></div>'+
`;

/**
 * /api/p/[id] 回傳練習頁時呼叫（經 injectPracticePageConfig）：把 Blob 裡舊版 qfSubmit 換成新版，
 * 已發出的連結不用老師重新匯出就吃到修正。找不到舊版片段（離線檔、加送出功能前的版本、已是新版）就原樣回傳。
 */
export function upgradeLegacyPracticePageSubmitJs(html: string): string {
  let out = html;
  const idx = out.indexOf(LEGACY_QF_SUBMIT_JS);
  if (idx !== -1) {
    out = out.slice(0, idx) + QF_SUBMIT_JS + out.slice(idx + LEGACY_QF_SUBMIT_JS.length);
  }
  // Classroom 繳交提示：舊版沒有「需先由老師建立作業」，學生在 Classroom 卡在「請選取近期有作業的課程」不知道為什麼
  const tipIdx = out.indexOf(LEGACY_QF_CLASSROOM_TIP_LINE);
  if (tipIdx !== -1) {
    out = out.slice(0, tipIdx) + QF_CLASSROOM_TIP_LINE + out.slice(tipIdx + LEGACY_QF_CLASSROOM_TIP_LINE.length);
  }
  return out;
}

export const PRACTICE_PAGE_SUBMIT_CLIENT_JS = `
  /* ---------- 線上分享版：成績送出 + 繳交到 Google Classroom（共用片段） ---------- */
  function qfSubmitEndpoint(){
    try{ var c=window.__QF_PRACTICE__; return (c&&typeof c.submitEndpoint==='string')?c.submitEndpoint:''; }catch(e){ return ''; }
  }
  function qfUuid(){
    try{ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
  }
${QF_SUBMIT_JS}  /* 送出成功後的 Classroom 分享按鈕：只接受 Classroom 網域，防止被竄改成任意網址 */
  function qfClassroomHtml(data){
    var href=String((data&&data.classroomShareUrl)||'');
    var resultUrl=String((data&&data.resultUrl)||'');
    if(href.indexOf('https://classroom.google.com/')!==0) return '';
    return '<div class="qf-classroom">'+
      '<a class="btn classroom" href="'+esc(href)+'" target="_blank" rel="noopener">📤 繳交到 Google Classroom</a>'+
${QF_CLASSROOM_TIP_LINE}      (resultUrl.indexOf('https://')===0||resultUrl.indexOf('http://')===0
        ?'<div class="qf-link">成績連結：<a href="'+esc(resultUrl)+'" target="_blank" rel="noopener">'+esc(resultUrl)+'</a></div>'
        :'')+
      '</div>';
  }
`;

export const PRACTICE_PAGE_SUBMIT_CSS = `
  .studentinfo{margin-top:14px;background:var(--card);border:1px solid var(--blue-line);border-radius:14px;box-shadow:var(--shadow);padding:14px 18px;display:flex;gap:12px;flex-wrap:wrap}
  .studentinfo label{flex:1;min-width:140px;display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:700;color:var(--muted)}
  .studentinfo input{padding:8px 10px;font-size:14.5px;font-family:inherit;border:1.5px solid var(--blue-line);border-radius:8px;color:var(--ink)}
  .studentinfo input:focus{outline:none;border-color:var(--blue)}
  .qf-classroom{margin-top:12px;text-align:center}
  .btn.classroom{display:inline-block;text-decoration:none;background:#1e8e3e;color:#fff;box-shadow:0 4px 12px rgba(30,142,62,.3)}
  .btn.classroom:hover{filter:brightness(1.06)}
  .qf-tip{margin-top:10px;padding:10px 14px;border-radius:10px;background:#fff8e6;border:1.5px solid #e6c65b;color:#6b551a;font-size:13px;text-align:left}
  .qf-tip b{color:#c62828}
  .qf-link{margin-top:8px;font-size:12px;color:var(--muted);word-break:break-all;text-align:left}
  .qf-ok{color:var(--ok);font-weight:800;text-align:center}
  .qf-err{color:var(--err);font-size:13px;margin-top:8px;min-height:1em}
`;
