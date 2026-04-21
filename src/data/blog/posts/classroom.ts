import type { BlogPost } from '../types';

const cta = {
  type: 'cta' as const,
  title: '讓這些方法自動化',
  description: 'QuizFlow 內建考試模式、防作弊、即時分析、Google Classroom 分享，把教室流程一次串起來。',
  href: '/sign-up',
  label: '免費開始使用',
};

export const classroomPosts: BlogPost[] = [
  {
    slug: 'google-classroom-integration-tips',
    title: '用 QuizFlow 搭 Google Classroom 的 5 個技巧',
    description:
      'Google Classroom 是台灣老師主流平台，搭配 QuizFlow 可以把測驗流程從 30 分鐘縮到 3 分鐘。',
    keywords: ['Google Classroom', 'QuizFlow 整合', '派發測驗'],
    category: 'classroom',
    publishedAt: '2026-04-02',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['Google Classroom', '流程'],
    body: [
      { type: 'h2', text: '5 個實用技巧' },
      {
        type: 'ol',
        items: [
          '用 QuizFlow 的「Google Classroom 分享」按鈕一鍵派發。',
          '把房間碼（6 碼英數）寫在作業描述，方便學生直接打開。',
          '設定到期時間 24 小時，避免作業無限期拖延。',
          '開啟「考試模式」避免學生切換分頁查答案。',
          '完成後把成績 CSV 匯出，直接貼進 Classroom 成績簿。',
        ],
      },
      cta,
    ],
  },
  {
    slug: 'prevent-student-cheating',
    title: '線上測驗防作弊的 6 個具體做法',
    description:
      '學生回家考試難免動手腳，但過度防範又會讓介面難用。分享 6 個實用且不擾民的方法。',
    keywords: ['線上測驗防作弊', '線上考試', '防作弊'],
    category: 'classroom',
    publishedAt: '2026-04-04',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['防作弊', '線上考試'],
    body: [
      { type: 'ul', items: [
        '啟用切換分頁偵測：QuizFlow 會記錄 leaveCount。',
        '隨機題目順序：每位學生看到的順序不同。',
        '隨機選項順序：正確答案位置每人不同。',
        '限時作答：壓縮查答案的時間。',
        '禁用返回 / 防刷新：避免重複作答。',
        '公開 leaveCount 給老師看：讓學生知道「我會看到」就能降低作弊動機。',
      ] },
      { type: 'h2', text: '過度防範的反效果' },
      {
        type: 'p',
        text: '有些工具要求全螢幕、關閉所有分頁，結果學生家裡網路一閃就失效，抱怨反而多。折衷做法是偵測 + 記錄，而非強制鎖定。',
      },
      cta,
    ],
  },
  {
    slug: 'flipped-classroom-quiz-workflow',
    title: '翻轉教室 × 線上測驗：課前診斷的 3 步流程',
    description:
      '翻轉教室的成敗在於課前診斷。用 QuizFlow 做 5 題小測驗，就能讓課堂討論精準命中迷思。',
    keywords: ['翻轉教室', '課前診斷', '先備知識'],
    category: 'classroom',
    publishedAt: '2026-04-06',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['翻轉教室', '診斷'],
    body: [
      { type: 'h2', text: '3 步流程' },
      {
        type: 'ol',
        items: [
          '前一天派發 5 題診斷測驗（3 題先備概念 + 2 題今日新內容）。',
          '開課前看答題分佈，找出最弱的 1~2 個概念。',
          '上課先花 10 分鐘針對最弱概念做小組討論，而不是從頭講一遍。',
        ],
      },
      { type: 'h2', text: '為什麼是 5 題？' },
      {
        type: 'p',
        text: '5 題約 5 分鐘，不會造成學生負擔，繳交率通常能達 80% 以上。10 題以上容易被學生敷衍。',
      },
      cta,
    ],
  },
  {
    slug: 'after-test-review-session',
    title: '考後檢討怎麼做最有效？7 分鐘的黃金流程',
    description:
      '「考完發卷、講錯題、下課」這種模式學生吸收有限。分享一套 7 分鐘的考後流程，讓錯題變成記憶。',
    keywords: ['考後檢討', '錯題分析', '教學法'],
    category: 'classroom',
    publishedAt: '2026-04-08',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['檢討', '錯題'],
    body: [
      { type: 'h2', text: '7 分鐘流程' },
      {
        type: 'ol',
        items: [
          '1 分鐘：展示全班答題分佈（哪題最多人錯）。',
          '2 分鐘：請學生兩兩互相說明錯題答案（同儕教學）。',
          '2 分鐘：老師講解 1~2 題核心迷思，不是全部講。',
          '1 分鐘：寫下「今天我學到⋯」一句話（後設認知）。',
          '1 分鐘：指定錯題重做（QuizFlow 有錯題重做模式）。',
        ],
      },
      { type: 'h2', text: '背後的學習科學' },
      {
        type: 'p',
        text: '同儕教學比單向聽講記憶留存率高 3 倍；後設認知寫作讓知識鞏固；間隔重做讓記憶從短期變長期。',
      },
      cta,
    ],
  },
  {
    slug: 'flashcards-for-memory-retention',
    title: '快閃卡怎麼用？提高單字、定義、公式的記憶留存率',
    description:
      '快閃卡（flashcards）+ 間隔重複 (Spaced Repetition) 是記憶最高效的方式。分享實際應用範例。',
    keywords: ['快閃卡', 'flashcard', '間隔重複', '記憶'],
    category: 'classroom',
    publishedAt: '2026-04-10',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['快閃卡', '記憶'],
    body: [
      { type: 'h2', text: '快閃卡最適合的內容' },
      {
        type: 'ul',
        items: [
          '英文單字與例句',
          '國文成語、文學常識',
          '歷史年代、地名',
          '科學公式與定義',
          '單位換算、化學式',
        ],
      },
      { type: 'h2', text: '3 個使用技巧' },
      {
        type: 'ol',
        items: [
          '正面寫問題、反面寫答案，避免把兩者擠在同一面。',
          '每張卡只考一個概念，避免「複合題」。',
          '搭配 3-7-15 間隔（今天學 → 3 天複習 → 7 天複習 → 15 天複習）。',
        ],
      },
      { type: 'h2', text: 'QuizFlow 的快閃卡模式' },
      {
        type: 'p',
        text: 'QuizFlow 內建 3D 翻牌 + 進度追蹤，學生可以在作答錯題後一鍵建立對應快閃卡，讓錯題變成記憶入口。',
      },
      cta,
    ],
  },
];
