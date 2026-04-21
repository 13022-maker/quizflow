import type { BlogPost } from '../types';

const cta = {
  type: 'cta' as const,
  title: '想試 QuizFlow？免費方案即可開始',
  description: '不需信用卡，註冊後立刻可建立 3 份測驗，PDF 轉題、AI 生成、分享連結一次搞定。',
  href: '/sign-up',
  label: '免費開始使用',
};

export const toolsComparePosts: BlogPost[] = [
  {
    slug: 'google-form-vs-quizflow',
    title: 'Google 表單做測驗 vs 專業出題平台：哪個適合老師？',
    description:
      'Google 表單免費、大家都會用，但做測驗真的合適嗎？我們從 6 個實務面向比較，幫你決定要不要換工具。',
    keywords: ['Google 表單', 'Google Form 測驗', '線上測驗平台'],
    category: 'tools-compare',
    publishedAt: '2026-04-02',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['Google 表單', '比較'],
    body: [
      { type: 'h2', text: 'Google 表單的優點' },
      {
        type: 'ul',
        items: [
          '完全免費，幾乎所有老師都有帳號。',
          '與 Google Classroom 整合方便。',
          '介面直覺，5 分鐘上手。',
        ],
      },
      { type: 'h2', text: '但這 6 件事做不到' },
      {
        type: 'ol',
        items: [
          '沒有 AI 出題：所有題目要手打。',
          '沒有題庫管理：考過的題目無法分類重用。',
          '沒有學習分析：只能看答對率，看不到學生的弱點診斷。',
          '沒有難度與素養標籤：無法系統化配題。',
          '沒有排序題與多元題型：只有固定幾種問題類型。',
          '沒有防作弊機制：學生可以輕易切換分頁查答案。',
        ],
      },
      { type: 'h2', text: '什麼時候該換工具？' },
      {
        type: 'p',
        text: '如果你每週出題超過 2 次、或手上已累積超過 200 題想系統化管理，換到專業平台會省下大量時間。',
      },
      cta,
    ],
  },
  {
    slug: 'kahoot-quizizz-comparison',
    title: 'Kahoot、Quizizz、QuizFlow 三者差在哪？',
    description:
      'Kahoot 和 Quizizz 主打課堂遊戲化，QuizFlow 主打 AI 出題與評量分析。這篇幫你釐清誰適合什麼場景。',
    keywords: ['Kahoot', 'Quizizz', 'QuizFlow', '課堂遊戲'],
    category: 'tools-compare',
    publishedAt: '2026-04-04',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['Kahoot', 'Quizizz', '比較'],
    body: [
      { type: 'h2', text: '三個工具的定位' },
      {
        type: 'ul',
        items: [
          'Kahoot：課堂即時競賽，氣氛炒熱第一名。',
          'Quizizz：同上，加上自主練習模式與 AI 出題。',
          'QuizFlow：為台灣老師設計的 AI 出題與評量分析平台，側重繁中與課綱對齊。',
        ],
      },
      { type: 'h2', text: '什麼時候用哪個？' },
      {
        type: 'ol',
        items: [
          '上課開場暖身、營造競爭感：Kahoot。',
          '學生回家練習、想看排行榜：Quizizz。',
          '段考命題、素養題、PDF 轉測驗、成績分析：QuizFlow。',
        ],
      },
      { type: 'h2', text: '能不能併用？' },
      {
        type: 'p',
        text: '可以。很多老師在 QuizFlow 產出題目後，把部分題目匯出到 Kahoot 做課堂遊戲，正式段考再用 QuizFlow 系統批改。',
      },
      cta,
    ],
  },
  {
    slug: 'pagamo-vs-quizflow',
    title: 'PaGamO 和 QuizFlow 能不能互補？台灣老師的實戰搭配',
    description:
      'PaGamO 以遊戲化占領土聞名，QuizFlow 專攻老師端出題效率。兩者互補，老師能打造完整學習迴圈。',
    keywords: ['PaGamO', 'QuizFlow', '遊戲化學習'],
    category: 'tools-compare',
    publishedAt: '2026-04-06',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['PaGamO', '遊戲化'],
    body: [
      { type: 'h2', text: '互補而非替代' },
      {
        type: 'p',
        text: 'PaGamO 的強項在學生端的學習動機與題庫系統；QuizFlow 的強項在老師端的出題效率與個人化分析。',
      },
      { type: 'h2', text: '建議搭配流程' },
      {
        type: 'ol',
        items: [
          'QuizFlow 產題：從課本 PDF 生 20 題，做基礎檢核。',
          'QuizFlow 分享連結：放到 Google Classroom 或 LINE 群組。',
          'QuizFlow 分析：抓出班上弱點題目。',
          'PaGamO 加強：在弱點題目上挑戰 PaGamO 同類練習。',
        ],
      },
      { type: 'h2', text: '為什麼不用 PaGamO 出題？' },
      {
        type: 'p',
        text: 'PaGamO 題庫主要由社群貢獻，老師要快速針對某單元出題，還是自己產最快。QuizFlow 就是補上這一塊的工具。',
      },
      cta,
    ],
  },
  {
    slug: 'free-online-quiz-maker-taiwan',
    title: '免費線上出題工具推薦：台灣老師實測 6 款',
    description:
      '不想花錢又想省備課時間？我們實測 6 款免費出題工具，整理功能、限制與推薦用法。',
    keywords: ['免費出題', '免費測驗工具', '線上出題'],
    category: 'tools-compare',
    publishedAt: '2026-04-08',
    readingMinutes: 7,
    author: 'QuizFlow 編輯室',
    tags: ['免費工具', '比較'],
    body: [
      { type: 'h2', text: '我們的評比標準' },
      {
        type: 'ul',
        items: [
          '是否支援繁體中文介面',
          '是否可建立不限次數測驗',
          '是否有 AI 出題（或免費額度）',
          '是否支援學生免登入作答',
          '是否有成績分析報表',
        ],
      },
      { type: 'h2', text: '6 款簡短評析' },
      {
        type: 'ul',
        items: [
          'Google 表單：免費但功能陽春，適合簡單問卷。',
          'Microsoft Forms：功能類似 Google 表單，校園授權時可考慮。',
          'Kahoot Free：可建立 5 題，超過要付費。',
          'Quizizz Free：可無限建立，但 AI 出題限次。',
          'QuizFlow Free：可建立 3 份、AI 出題每月 10 次、有成績分析。',
          'Canva Quiz：以設計取勝，但批改功能弱。',
        ],
      },
      { type: 'h2', text: '結論' },
      {
        type: 'p',
        text: '若你主要要的是「繁中 + AI 出題 + 台灣課綱」，QuizFlow 免費方案最適合起步。量大再升級 Pro。',
      },
      cta,
    ],
  },
  {
    slug: 'notion-vs-quizflow-question-bank',
    title: 'Notion 當題庫工具夠用嗎？和 QuizFlow 的差別',
    description:
      '很多老師用 Notion 整理題庫，但做成測驗就卡關。這篇比較 Notion 與 QuizFlow 的定位差異。',
    keywords: ['Notion 題庫', 'Notion 老師', '題庫管理'],
    category: 'tools-compare',
    publishedAt: '2026-04-10',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['Notion', '題庫'],
    body: [
      { type: 'h2', text: 'Notion 的強項' },
      {
        type: 'ul',
        items: [
          '自由排版，適合整理教學筆記。',
          '資料庫可做標籤、篩選。',
          '跨裝置同步方便。',
        ],
      },
      { type: 'h2', text: 'Notion 的限制' },
      {
        type: 'ol',
        items: [
          '沒有批改功能：學生無法直接答題。',
          '沒有隨機抽題：無法自動生成不同版本。',
          '沒有分享連結給學生免登入作答：要額外用 Google 表單。',
          '沒有統計分析：看不到答對率、鑑別度。',
        ],
      },
      { type: 'h2', text: '建議搭配' },
      {
        type: 'p',
        text: '用 Notion 存教學資料與概念筆記；用 QuizFlow 管理題庫與分享測驗。兩者各司其職最省時間。',
      },
      cta,
    ],
  },
];
