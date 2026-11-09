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

export const PRACTICE_PAGE_SUBMIT_CLIENT_JS = `
  /* ---------- 線上分享版：成績送出 + 繳交到 Google Classroom（共用片段） ---------- */
  function qfSubmitEndpoint(){
    try{ var c=window.__QF_PRACTICE__; return (c&&typeof c.submitEndpoint==='string')?c.submitEndpoint:''; }catch(e){ return ''; }
  }
  function qfUuid(){
    try{ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
  }
  /* cb(錯誤訊息字串或 null, server 回傳資料) */
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
  /* 送出成功後的 Classroom 分享按鈕：只接受 Classroom 網域，防止被竄改成任意網址 */
  function qfClassroomHtml(data){
    var href=String((data&&data.classroomShareUrl)||'');
    var resultUrl=String((data&&data.resultUrl)||'');
    if(href.indexOf('https://classroom.google.com/')!==0) return '';
    return '<div class="qf-classroom">'+
      '<a class="btn classroom" href="'+esc(href)+'" target="_blank" rel="noopener">📤 繳交到 Google Classroom</a>'+
      '<div class="qf-tip">會開啟 Google Classroom，<b>請選老師出的那份作業 → 按「繳交」</b>，老師才會收到！</div>'+
      (resultUrl.indexOf('https://')===0||resultUrl.indexOf('http://')===0
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
