import type { BlogPost } from '../types';

const cta = {
  type: 'cta' as const,
  title: '讓課綱對齊變簡單',
  description: 'QuizFlow 支援選擇領域、年級、學習表現指標，產出的題目直接貼近 108 課綱，不用再對照表。',
  href: '/sign-up',
  label: '免費試用課綱對齊功能',
};

export const curriculumPosts: BlogPost[] = [
  {
    slug: '108-curriculum-alignment-guide',
    title: '108 課綱評量對齊的 5 個小動作',
    description:
      '素養導向評量講了 6 年，但真正落實到每次小考還是不容易。分享 5 個立刻可做的對齊動作。',
    keywords: ['108 課綱', '素養評量', '課綱對齊'],
    category: 'curriculum',
    publishedAt: '2026-04-03',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['課綱', '素養'],
    body: [
      { type: 'h2', text: '5 個小動作' },
      {
        type: 'ol',
        items: [
          '每題加上「學習表現代碼」，例如 數-E-A2。',
          '每份試卷至少 30% 題目是情境題。',
          '每題對應一個以上 Bloom 層級。',
          '每次段考後，統計學生在「認知歷程向度」的分佈。',
          '把評量結果寫進下一次教學設計。',
        ],
      },
      { type: 'h2', text: '最常見的執行誤區' },
      {
        type: 'ul',
        items: [
          '把「加情境」當成「貼新聞」：情境必須和評量目標連動。',
          '把「分組報告」當成素養評量：還需要有客觀評分標準。',
          '把「素養題」等於「難題」：素養題重在思考歷程，不一定難。',
        ],
      },
      cta,
    ],
  },
  {
    slug: 'bloom-taxonomy-for-question-design',
    title: 'Bloom 分類法怎麼套進出題？6 層思考的題目範例',
    description:
      '記憶、理解、應用、分析、評鑑、創造，每一層該怎麼出題？本文給範例，讓你快速對號入座。',
    keywords: ['Bloom', '認知層級', '題目分類'],
    category: 'curriculum',
    publishedAt: '2026-04-05',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['Bloom', '思考層級'],
    body: [
      { type: 'h2', text: '6 層對應的題目動詞' },
      {
        type: 'ul',
        items: [
          '記憶：列出、定義、辨識、指出。',
          '理解：解釋、比較、摘要、改寫。',
          '應用：使用、執行、示範、解決。',
          '分析：區分、組織、歸因、檢驗。',
          '評鑑：評價、批判、辯護、建議。',
          '創造：設計、發明、規劃、產生。',
        ],
      },
      { type: 'h2', text: '國中自然範例' },
      {
        type: 'ul',
        items: [
          '記憶：光合作用的原料是哪兩種物質？',
          '理解：請用自己的話說明光合作用的過程。',
          '應用：若某植物葉面被塗滿凡士林，會對光合作用造成什麼影響？',
          '分析：比較 C3 與 C4 植物在炎熱乾燥環境的適應差異。',
          '評鑑：你認為使用基改作物提高產量，是否符合永續發展？說明理由。',
          '創造：請設計一個實驗，驗證光強度對光合作用速率的影響。',
        ],
      },
      { type: 'h2', text: '如何用 AI 快速產出各層題目' },
      {
        type: 'p',
        text: '在提示詞中明確要求「請各產 2 題，對應 Bloom 的 6 層認知歷程」，AI 會幫你做完初步分類，省下大量標註時間。',
      },
      cta,
    ],
  },
  {
    slug: 'cognitive-diagnostic-assessment',
    title: '診斷性評量怎麼做？讓你一眼看出全班弱點',
    description:
      '單純看分數看不出學生在哪裡卡關。診斷性評量讓你用最少題目，最精準定位學習盲點。',
    keywords: ['診斷性評量', '弱點分析', '認知診斷'],
    category: 'curriculum',
    publishedAt: '2026-04-07',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['診斷', '評量'],
    body: [
      { type: 'h2', text: '診斷性評量的核心' },
      {
        type: 'p',
        text: '每題對應一個具體概念或能力，錯題直接指向學生沒掌握的部分。不需要大量題目，10 題精準題就夠。',
      },
      { type: 'h2', text: '設計步驟' },
      {
        type: 'ol',
        items: [
          '列出單元的 5~10 個核心概念。',
          '為每個概念設計 1~2 題，混合選擇、填空、簡答。',
          '每題標註對應概念代碼。',
          '批改後統計：哪個概念的錯誤率最高？',
          '下節課針對最弱概念重點補強。',
        ],
      },
      { type: 'h2', text: 'AI 協助的部分' },
      {
        type: 'p',
        text: '可以把班級答題分佈丟給 AI，請它分析「最常見的迷思概念」與「教學建議」。QuizFlow 的班級分析功能就是這個用途。',
      },
      cta,
    ],
  },
  {
    slug: 'learning-outcome-based-question',
    title: '從學習表現寫題目：用 OBE 思維設計評量',
    description:
      '成果導向教育 (OBE) 強調先定義學生要達到什麼，再反推怎麼教、怎麼考。套用到台灣課綱，這樣出題最對齊。',
    keywords: ['OBE', '學習表現', '成果導向'],
    category: 'curriculum',
    publishedAt: '2026-04-09',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['OBE', '課綱'],
    body: [
      { type: 'h2', text: 'OBE 的 3 步流程' },
      {
        type: 'ol',
        items: [
          '寫下「學生完成本單元後，要能做什麼」（使用可觀察動詞）。',
          '設計評量題目，直接檢驗這個能力。',
          '根據評量結果回推教學活動。',
        ],
      },
      { type: 'h2', text: '範例：國文修辭單元' },
      {
        type: 'p',
        text: '目標：學生能辨識並自行仿寫三種常見修辭。',
      },
      {
        type: 'ul',
        items: [
          '記憶題：下列何者屬於譬喻修辭？（選擇題）',
          '理解題：請說明「轉化」與「誇飾」的差異（簡答）。',
          '應用題：請以「夏日午後」為主題，各寫一句譬喻、轉化、誇飾（實作）。',
        ],
      },
      { type: 'h2', text: 'OBE 的好處' },
      {
        type: 'ul',
        items: [
          '學生清楚知道「達成標準」是什麼。',
          '老師容易回答家長「為什麼這樣改分」。',
          '評量結果可直接回饋教學改進。',
        ],
      },
      cta,
    ],
  },
];
