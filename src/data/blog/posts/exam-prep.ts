import type { BlogPost } from '../types';

const cta = {
  type: 'cta' as const,
  title: '快速為學生客製化一份衝刺卷',
  description: '把歷屆題 PDF 丟進 QuizFlow，3 分鐘產出題目分類 + 難度分佈 + 錯題練習，學生直接線上作答。',
  href: '/sign-up',
  label: '免費製作衝刺卷',
};

export const examPrepPosts: BlogPost[] = [
  {
    slug: 'high-school-entrance-exam-strategy',
    title: '國中會考衝刺 6 週計畫：老師可直接套用',
    description:
      '離會考剩 6 週，該怎麼安排複習進度？我們整理一份老師可直接參考的衝刺計畫，含每週重點與題目配比。',
    keywords: ['會考', '國中會考', '衝刺計畫'],
    category: 'exam-prep',
    publishedAt: '2026-04-02',
    readingMinutes: 8,
    author: 'QuizFlow 編輯室',
    tags: ['會考', '衝刺'],
    body: [
      { type: 'h2', text: '6 週主題規劃' },
      {
        type: 'ul',
        items: [
          '第 1 週：單元自我檢測，找出弱點。',
          '第 2 週：歷屆試題分類，一次做一個單元。',
          '第 3 週：跨單元綜合題，訓練統整能力。',
          '第 4 週：模擬整卷，壓時間練速度。',
          '第 5 週：錯題重做，針對個人弱點加強。',
          '第 6 週：心態調整 + 輕度複習，避免過度疲勞。',
        ],
      },
      { type: 'h2', text: '出題比例建議' },
      {
        type: 'p',
        text: '衝刺期題型以「素養題 60%、計算 / 記憶題 40%」為主，模擬會考比例。',
      },
      cta,
    ],
  },
  {
    slug: 'college-entrance-math-tips',
    title: '學測數學備考：3 個穩分技巧 + AI 產題流程',
    description:
      '學測數學難度年年提高，穩分策略比拚難題更重要。本文分享 3 個實用技巧與快速產題流程。',
    keywords: ['學測數學', '學測備考', '學測'],
    category: 'exam-prep',
    publishedAt: '2026-04-04',
    readingMinutes: 7,
    author: 'QuizFlow 編輯室',
    tags: ['學測', '數學'],
    body: [
      { type: 'h2', text: '3 個穩分技巧' },
      {
        type: 'ol',
        items: [
          '把前 10 題（簡單 + 中等）的正確率拉到 95%。',
          '多選題採消去法，不用每個選項都完美判斷。',
          '非選題寫清楚步驟，寧可慢也不跳步。',
        ],
      },
      { type: 'h2', text: 'AI 產題流程' },
      {
        type: 'ol',
        items: [
          '把近 3 年學測數學 PDF 丟進 QuizFlow。',
          '指定「難度 3 為主，產 20 題新題」。',
          '產完人工抽驗 5 題。',
          '發給學生作答，根據錯題自動生衍生題。',
        ],
      },
      cta,
    ],
  },
  {
    slug: 'english-reading-comprehension-prep',
    title: '英文閱讀測驗怎麼練？老師帶班級衝高分的方法',
    description:
      '英文閱讀是學測、指考的關鍵題型。用 AI 從 TED、BBC 文章快速產題，讓學生接觸多元語料。',
    keywords: ['英文閱讀', '閱讀測驗', '英文備考'],
    category: 'exam-prep',
    publishedAt: '2026-04-06',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['英文', '閱讀'],
    body: [
      { type: 'h2', text: '選文章的 3 個標準' },
      {
        type: 'ul',
        items: [
          '長度 250~500 字，符合考試篇幅。',
          '題材多元：科普、社會、藝術、科技輪流。',
          '難度 B1~B2（CEFR），符合高中程度。',
        ],
      },
      { type: 'h2', text: 'AI 產題技巧' },
      {
        type: 'p',
        text: '提示詞中明確要求 literal vs inferential 比例 3:2，並要求選項長度相近。這樣產出的題目鑑別度較高。',
      },
      cta,
    ],
  },
  {
    slug: 'high-school-natural-science-prep',
    title: '高中自然科整合題怎麼準備？跨科題目 AI 生成技巧',
    description:
      '新課綱自然科考跨領域整合，物化生地要一起看。本文分享如何用 AI 生成高品質整合題。',
    keywords: ['高中自然', '整合題', '跨領域'],
    category: 'exam-prep',
    publishedAt: '2026-04-08',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['自然科', '跨領域'],
    body: [
      { type: 'h2', text: '跨領域題常見組合' },
      {
        type: 'ul',
        items: [
          '生物 + 化學：細胞代謝、酵素作用。',
          '物理 + 地科：天體力學、地震波。',
          '化學 + 地科：大氣化學、海洋酸化。',
          '生物 + 物理：視覺、聽覺、神經傳導。',
        ],
      },
      { type: 'h2', text: 'AI 提示詞建議' },
      {
        type: 'quote',
        text: '請設計一題情境，需要同時運用高中生物與化學知識，情境與能源轉換或環境議題相關，附解析。',
      },
      cta,
    ],
  },
  {
    slug: 'mock-exam-design-checklist',
    title: '模擬考設計檢核表：8 項確認再發卷',
    description:
      '模擬考最怕「題目難度失衡」「題幹有瑕疵」「時間配置錯誤」。這張檢核表是老師發卷前的最後 5 分鐘確認。',
    keywords: ['模擬考', '考卷檢核', '試卷'],
    category: 'exam-prep',
    publishedAt: '2026-04-10',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['模擬考', '檢核'],
    body: [
      { type: 'h2', text: '8 項檢核' },
      {
        type: 'ol',
        items: [
          '題目順序：由易到難或混合（依考試策略而定）。',
          '難度分佈：3-4-3 或你設定的比例。',
          '題幹通順：沒有錯字、沒有模糊指稱。',
          '選項長度相近：避免最長選項就是答案。',
          '避免跨題暗示：A 題答案不會洩漏 B 題。',
          '時間估計：普通學生可在 90% 時限內完成。',
          '解答無誤：最後再自己做一次題目。',
          '印刷樣式：字體大小、圖片清晰度。',
        ],
      },
      cta,
    ],
  },
  {
    slug: 'spaced-repetition-for-exam-prep',
    title: '考前複習用間隔重複，記憶效率提升 200%',
    description:
      '一次讀 4 小時不如分 4 天讀 1 小時。間隔重複是考試記憶的神器，本文分享具體執行法。',
    keywords: ['間隔重複', '考前複習', '記憶法'],
    category: 'exam-prep',
    publishedAt: '2026-04-12',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['間隔重複', '複習'],
    body: [
      { type: 'h2', text: '為什麼有效？' },
      {
        type: 'p',
        text: '遺忘曲線顯示我們會快速忘記新學的內容，但在快遺忘前複習一次，記憶強度會加倍。這就是間隔重複 (spaced repetition) 的原理。',
      },
      { type: 'h2', text: '實際排程' },
      {
        type: 'ul',
        items: [
          'Day 0：學習新內容。',
          'Day 1：第一次複習（快速回顧）。',
          'Day 3：第二次複習（嘗試回憶不看筆記）。',
          'Day 7：第三次複習（做題檢驗）。',
          'Day 14：第四次複習。',
          'Day 30：第五次複習。',
        ],
      },
      { type: 'h2', text: '如何用 QuizFlow 實作' },
      {
        type: 'p',
        text: '每次錯題自動加入「錯題本」，每週末系統重新抽出上上週、上週、本週的錯題混合考，就是天然的間隔重複。',
      },
      cta,
    ],
  },
];
