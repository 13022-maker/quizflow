# QuizFlow 流程圖（三層）

> 用 Figma / FigJam 的「Mermaid」外掛可直接貼上渲染（例：`Mermaid to Figma`、`FigJam Mermaid`）。

---

## Layer 1 — 使用者旅程（User Journey）

```mermaid
flowchart TB
  %% 老師流程
  subgraph Teacher["👩‍🏫 老師端"]
    T1([訪問首頁]) --> T2[註冊 / 登入<br/>Clerk]
    T2 --> T3[建立 Organization<br/>onboarding]
    T3 --> T4[Dashboard 首頁<br/>統計 + 最近測驗]
    T4 --> T5{建立新測驗}
    T5 -->|手動| T6[QuizEditor<br/>手動新增題目]
    T5 -->|AI 文字出題| T7[AIQuizModal<br/>輸入主題 + 選題型]
    T5 -->|AI 檔案出題| T8[FileQuizGenerator<br/>PDF / 圖片 / 音檔]
    T5 -->|YouTube / Docs| T9[URL 出題<br/>抓字幕 / 文件]
    T7 --> T10[生成題目 + 配分]
    T8 --> T10
    T9 --> T10
    T6 --> T10
    T10 --> T11[編輯 / 排序 / 插圖<br/>平均配分總分 100]
    T11 --> T12[ShareModal<br/>房間碼 + LINE + Classroom + QR]
    T12 --> T13[學生作答 收集中]
    T13 --> T14[成績頁<br/>可排序表格 + CSV]
    T14 --> T15[AI 班級建議<br/>弱點分析]
  end

  %% 學生流程
  subgraph Student["🧑‍🎓 學生端（免登入）"]
    S1([取得房間碼<br/>或 QR / 連結]) --> S2[/quiz/[accessCode]<br/>QuizTaker]
    S2 --> S3{作答模式}
    S3 -->|一般| S4[填答題目]
    S3 -->|聽力題| S5[播放音檔 + 選答]
    S3 -->|快閃卡複習| S6[3D 翻牌]
    S4 --> S7[提交答案<br/>自動批改]
    S5 --> S7
    S7 --> S8[成績頁 + 解析]
    S8 --> S9[AI 弱點分析]
    S8 --> S10[錯題重做<br/>不計入統計]
  end

  %% 跨端關聯
  T13 -.房間碼/連結.-> S1
```

---

## Layer 2 — 功能架構（Pages / APIs / Modals）

```mermaid
flowchart LR
  %% 公開頁面
  subgraph Public["🌐 Unauth Pages"]
    P1["/(locale)"]
    P2["/pricing"]
    P3["/privacy /terms /refund"]
    P4["/quiz/[accessCode]"]
  end

  %% 認證頁
  subgraph Auth["🔐 Auth Pages"]
    A1["/sign-in /sign-up"]
    A2["/onboarding/organization-selection"]
    A3["/dashboard"]
    A4["/dashboard/quizzes"]
    A5["/dashboard/quizzes/new"]
    A6["/dashboard/quizzes/[id]/edit"]
    A7["/dashboard/quizzes/[id]/results"]
    A8["/dashboard/billing"]
    A9["/dashboard/user-profile"]
    A10["/dashboard/organization-profile"]
  end

  %% 核心元件
  subgraph Components["🧩 核心元件"]
    C1[QuizEditor]
    C2[QuizTaker]
    C3[AIQuizModal<br/>文字出題]
    C4[FileQuizGenerator<br/>檔案出題]
    C5[ShareModal<br/>分享 + 到期]
    C6[ResultsResponseTable]
    C7[ClassAIAnalysis]
    C8[FlashCard]
    C9[OnboardingSteps]
  end

  %% API Routes
  subgraph API["⚡ API Routes"]
    G1["/api/ai/generate-questions<br/>Gemini 2.5 + Claude fallback"]
    G2["/api/ai/generate-from-file<br/>PDF / 圖片 / 音檔"]
    G3["/api/ai/generate-from-url<br/>YouTube / Docs"]
    G4["/api/ai/generate-hints/[quizId]"]
    G5["/api/ai/analyze-weak-points<br/>Claude"]
    G6["/api/ai/analyze-class-performance<br/>Claude"]
    G7["/api/ai/tts<br/>Gemini TTS + Blob"]
    G8["/api/quiz/[id]/submit"]
    G9["/api/quiz/join?code=XXXXXX"]
    G10["/api/quizzes/[id]/questions<br/>AI 匯入"]
    G11["/api/quizzes/[id]/export<br/>CSV"]
    G12["/api/upload/audio/[quizId]"]
    G13["/api/upload/quiz-image/[quizId]"]
    G14["/api/paddle/checkout"]
    G15["/api/webhook<br/>Paddle events"]
    G16["/api/streak + /record"]
  end

  %% 連線
  P4 --> C2
  A5 --> C3
  A5 --> C4
  A6 --> C1
  A6 --> C5
  A7 --> C6
  A7 --> C7
  A3 --> C9

  C3 --> G1
  C3 --> G7
  C4 --> G2
  C4 --> G3
  C1 --> G10
  C1 --> G12
  C1 --> G13
  C2 --> G8
  C2 --> G4
  C6 --> G11
  C7 --> G5
  C7 --> G6

  P2 --> G14
  G14 --> G15
  A3 --> G16
```

---

## Layer 3 — 資料流（Schema / Actions / 第三方服務）

```mermaid
flowchart TB
  %% 第三方
  subgraph External["🌍 第三方服務"]
    E1[Clerk<br/>Auth + Org]
    E2[Neon Postgres<br/>生產 DB]
    E3[PGlite<br/>本地開發 DB]
    E4[Gemini 2.5 Flash<br/>出題]
    E5[Gemini TTS<br/>音檔]
    E6[Claude Sonnet 4<br/>分析 + fallback]
    E7[Vercel Blob<br/>音檔 / 圖片儲存]
    E8[Paddle Billing<br/>訂閱]
    E9[pdf-lib<br/>前端 PDF 裁切]
    E10[pinyin-pro<br/>聽力題拼音]
  end

  %% Server Actions
  subgraph Actions["⚙️ Server Actions"]
    SA1[quizActions<br/>create / update / delete / distributePoints]
    SA2[questionActions<br/>CRUD + 排序]
    SA3[responseActions<br/>submit + 批改]
    SA4[aiActions<br/>弱點分析呼叫]
    SA5[aiUsageActions<br/>quota 檢查與記錄]
  end

  %% DB Tables
  subgraph DB["🗄️ Drizzle Schema（13 tables）"]
    D1[(organization<br/>Clerk orgId)]
    D2[(quiz<br/>roomCode / expiresAt<br/>preventLeave / ownerId)]
    D3[(question<br/>type / options / answer<br/>audioUrl / listeningText)]
    D4[(response<br/>accessCode / leaveCount)]
    D5[(answer<br/>response → question)]
    D6[(quiz_attempt<br/>作答歷程)]
    D7[(quiz_final_score)]
    D8[(user_streak<br/>連續天數)]
    D9[(user_trial<br/>免費試用)]
    D10[(ai_usage<br/>每月 quota)]
    D11[(paddle_customer<br/>clerkUserId ↔ paddle)]
    D12[(subscription<br/>status / plan)]
    D13[(todo)]
  end

  %% 關聯
  D2 -->|1:N| D3
  D2 -->|1:N| D4
  D4 -->|1:N| D5
  D5 -->|N:1| D3
  D2 -->|1:N| D6
  D4 -->|1:1| D7
  D1 -->|1:N| D2
  D11 -->|1:1| D12

  %% Actions 與 DB
  SA1 --> D2
  SA2 --> D3
  SA3 --> D4
  SA3 --> D5
  SA3 --> D6
  SA3 --> D7
  SA4 --> D3
  SA5 --> D10

  %% 第三方呼叫
  SA1 -.-> E1
  SA1 -.-> E2
  E2 -.本地 fallback.-> E3
  SA4 -.-> E6
  D3 -.音檔 URL.-> E7
  D9 -.-> SA5

  %% AI 出題呼叫鏈
  API_AI[/"API Routes<br/>generate-*"/] --> E4
  E4 -.過載 fallback.-> E6
  API_AI --> E5
  E5 -.上傳.-> E7

  %% Paddle
  Webhook[/"/api/webhook"/] --> D11
  Webhook --> D12
  Webhook -.-> E8
```

---

## 匯入 Figma 的步驟

1. 打開 Figma / FigJam 檔案
2. 安裝外掛（任一即可）：
   - **FigJam Mermaid**（官方，推薦）
   - **Mermaid to Figma**
3. 複製上面 ```` ```mermaid ... ``` ```` 區塊內的程式碼
4. 執行外掛 → 貼上 → 渲染
5. 調整顏色／字型 → 匯出 PNG / SVG

---

## 小提醒

- 三張圖**可分開貼**，每張獨立匯入比較好整理版面
- 若要給**投資人／合作夥伴**看，建議只用 Layer 1（乾淨）
- 若要給**新工程師 onboarding**，Layer 2 + Layer 3 最有用
- 實際流程會隨 commit 變動，此文件寫於 2026-04-17
