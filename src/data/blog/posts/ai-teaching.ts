import type { BlogPost } from '../types';

const cta = {
  type: 'cta' as const,
  title: '讓 AI 幫你節省備課時間',
  description: 'QuizFlow 支援上傳 PDF、貼文字、配課綱，3 分鐘產出整份試卷，免費方案即可試用。',
  href: '/sign-up',
  label: '免費開始使用',
};

export const aiTeachingPosts: BlogPost[] = [
  {
    slug: 'ai-quiz-generator-for-teachers',
    title: 'AI 自動出題工具怎麼選？2026 年台灣老師實測心得',
    description:
      '從準確性、繁中支援、課綱對齊、PDF 上傳四個面向，比較台灣老師最常用的 AI 出題工具，整理出一份不會踩雷的選購指南。',
    keywords: ['AI 出題工具', 'AI 自動出題', '線上出題', '老師備課工具'],
    category: 'ai-teaching',
    publishedAt: '2026-04-02',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['AI', '備課', '工具比較'],
    body: [
      {
        type: 'p',
        text: '過去兩年「AI 出題」從陌生詞變成了每間教師研習的標配，但工具一多，老師反而更難挑。我們訪談了 12 位中小學與高中老師，把他們實際用 AI 出題時踩過的雷與找到的甜蜜點整理在這裡。',
      },
      { type: 'h2', text: '四個挑選標準，缺一不可' },
      {
        type: 'ol',
        items: [
          '繁體中文原生支援：不要用簡體模型硬轉繁中，常會出現「爲」「麼」等錯字。',
          '來源可追溯：每題要能標示來自課本第幾頁，方便你驗題。',
          '題型完整：選擇、是非、填空、簡答、排序五種都要有，才能應付不同教學情境。',
          '課綱對齊：能輸入領域、年級、學習表現指標，產出才能直接用。',
        ],
      },
      { type: 'h2', text: '最常見的三個踩雷案例' },
      { type: 'h3', text: '1. AI 一口氣產 50 題，卻有一半是幻覺' },
      {
        type: 'p',
        text: '模型在沒有課本內容的狀態下，會從訓練資料補幻覺，尤其是歷史年代、地名、化學式。建議每次產題時一定要附上 PDF 或貼上課文原文。',
      },
      { type: 'h3', text: '2. 難度集中在「中等偏易」' },
      {
        type: 'p',
        text: '若沒有明確難度指示，AI 產出的題目會集中在 Bloom 第 2~3 層。可以在提示詞裡指定「難度 1~5 各產 2 題」，或選擇支援難度欄位的工具。',
      },
      { type: 'h3', text: '3. 解析太短，學生看不懂' },
      {
        type: 'p',
        text: '好的解析應該包含「為什麼這個選項正確」與「其他選項為什麼錯」。選工具時，優先考慮支援 rubric 多維度評分的平台。',
      },
      { type: 'h2', text: '我們的建議' },
      {
        type: 'p',
        text: '若你是台灣中小學老師，優先挑選：繁中原生 + PDF 追溯 + 五種題型 + 課綱對齊 的工具。這四個條件同時達成的工具並不多，QuizFlow 是其中之一。',
      },
      cta,
    ],
  },
  {
    slug: 'pdf-to-quiz-workflow',
    title: 'PDF 轉測驗：台灣老師的實用工作流（含 3 個常見坑）',
    description:
      '把課本 PDF 一鍵轉成測驗是省時間的最大槓桿，但 80% 的老師第一次用都會踩到檔案太大、頁碼錯亂、AI 產題發散的問題。這篇分享可直接套用的流程。',
    keywords: ['PDF 轉測驗', 'PDF 出題', 'AI 出題 PDF', '課本轉測驗'],
    category: 'ai-teaching',
    publishedAt: '2026-04-04',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['PDF', 'AI', '工作流'],
    body: [
      { type: 'h2', text: '為什麼 PDF 轉測驗這麼難？' },
      {
        type: 'p',
        text: '台灣老師最常遇到的 PDF 是出版社課本或自製講義。課本 PDF 通常大於 20MB、有大量圖片與表格，直接丟給 AI 常常會爆記憶體或被伺服器拒絕。',
      },
      { type: 'h2', text: '推薦的 4 步工作流' },
      {
        type: 'ol',
        items: [
          '步驟 1：決定這次要考的範圍（例如第 3 章第 2 節），用 pdf 編輯工具裁出只有該章節的頁面。',
          '步驟 2：如果檔案仍大於 4MB，用線上工具或直接在 QuizFlow 上傳頁範圍選擇器，只送必要頁面。',
          '步驟 3：指定題型比例（例如選擇 6、是非 2、簡答 2），並加上「請於每題附上來源頁碼」。',
          '步驟 4：拿到草稿後，花 3 分鐘逐題對照原文驗題，重點看日期、人名、公式。',
        ],
      },
      { type: 'h2', text: '三個常見坑' },
      { type: 'h3', text: '坑 1：圖表題 AI 看不懂' },
      {
        type: 'p',
        text: '課本中的圖表（長條圖、地圖、化學式）如果你希望納入題目，建議另外截圖並標註文字描述，AI 才能據此出題。',
      },
      { type: 'h3', text: '坑 2：OCR 掃描版 PDF 文字錯亂' },
      {
        type: 'p',
        text: '掃描版 PDF 常有亂碼。先用 OCR 工具轉成文字版 PDF 再丟，品質差很多。',
      },
      { type: 'h3', text: '坑 3：忘記存版本' },
      {
        type: 'p',
        text: 'AI 產題是隨機的，今天的版本明天再產可能就不一樣。養成「產完立刻存成測驗」的習慣。',
      },
      cta,
    ],
  },
  {
    slug: 'ai-prompt-templates-for-teachers',
    title: '老師專用的 AI 出題提示詞（可複製，5 個範本）',
    description:
      '直接能用的繁體中文提示詞範本，涵蓋選擇、填空、素養題、英文閱讀、數學應用題。每個範本都附解釋，你可以改成自己的風格。',
    keywords: ['AI 提示詞', '出題提示詞', 'AI Prompt 教師', 'AI 出題範本'],
    category: 'ai-teaching',
    publishedAt: '2026-04-06',
    readingMinutes: 7,
    author: 'QuizFlow 編輯室',
    tags: ['Prompt', 'AI', '範本'],
    body: [
      {
        type: 'p',
        text: '提示詞（Prompt）寫得好不好，是 AI 出題品質的分水嶺。以下五個範本都是從實戰流程精煉出來的，你可以直接複製貼上。',
      },
      { type: 'h2', text: '範本 1：標準選擇題（適合段考）' },
      {
        type: 'quote',
        text: '請根據以下課本內容，產生 10 題單選題。每題 4 個選項，只有一個正確。請附上來源頁碼、解析，以及難度 1~5 分布均勻。輸出格式為 JSON。',
      },
      { type: 'h2', text: '範本 2：素養導向題' },
      {
        type: 'quote',
        text: '請設計 5 題素養導向的情境題，題幹需包含生活情境描述 (80~120 字)，並能檢驗學生的分析、應用與評鑑能力 (Bloom 3~5 層)。',
      },
      { type: 'h2', text: '範本 3：英文閱讀測驗' },
      {
        type: 'quote',
        text: '請根據以下英文文章，產生 5 題閱讀測驗（3 題 literal、2 題 inferential），選項長度相近，避免可直接從原文找到答案的題目。',
      },
      { type: 'h2', text: '範本 4：數學應用題' },
      {
        type: 'quote',
        text: '請設計 5 題符合國中二年級能力指標的一元二次方程式應用題，情境需多樣（至少包含：購物、路程、面積、比例、統計），每題附完整解題步驟。',
      },
      { type: 'h2', text: '範本 5：錯題變式' },
      {
        type: 'quote',
        text: '以下是學生答錯的題目與正確答案，請產生 3 題相似但情境不同的變式題，讓學生練習相同概念但不會直接背答案。',
      },
      { type: 'h2', text: '使用小訣竅' },
      {
        type: 'ul',
        items: [
          '永遠先給 AI 材料（課文、題目、單字表），再給指令，品質提升 40% 以上。',
          '明確指定題數、題型、難度分佈，不要讓 AI 自己決定。',
          '要求 JSON 輸出方便後續匯入。',
        ],
      },
      cta,
    ],
  },
  {
    slug: 'gemma-claude-compare-for-teachers',
    title: 'Gemma 本地 vs Claude API：老師應該用哪個？',
    description:
      '同樣一份課本 PDF、同一個提示詞，送進 Gemma 4 本地模型與 Claude API 會產出什麼？我們實測後的誠實比較。',
    keywords: ['Gemma', 'Claude', 'AI 模型比較', 'Ollama'],
    category: 'ai-teaching',
    publishedAt: '2026-04-08',
    readingMinutes: 6,
    author: 'QuizFlow 編輯室',
    tags: ['AI', '模型比較', 'Ollama'],
    body: [
      { type: 'h2', text: '為什麼要關心模型差異？' },
      {
        type: 'p',
        text: '老師不需要成為 AI 工程師，但了解模型的強弱能幫你選對工具。Gemma 4 和 Claude 分別代表兩條路線：本地輕量 vs 雲端強力。',
      },
      { type: 'h2', text: '三個維度的實測比較' },
      { type: 'h3', text: '1. 繁中表達' },
      {
        type: 'p',
        text: 'Claude 在繁中語感上贏明顯，尤其是素養題情境描述；Gemma 4 需要調整提示詞才能避免出現簡體字或網路慣用語。',
      },
      { type: 'h3', text: '2. 準確性' },
      {
        type: 'p',
        text: '有提供原文時兩者都可達到 95% 以上正確率。沒提供原文時，Claude 的幻覺率較低，Gemma 在歷史年代、化學式上容易出錯。',
      },
      { type: 'h3', text: '3. 成本' },
      {
        type: 'p',
        text: 'Gemma 本地幾乎零成本（僅電費）；Claude API 每百題約需 $0.3~$1 美元。高用量補習班可以 Gemma 為主、Claude 做品質抽驗。',
      },
      { type: 'h2', text: '建議搭配方式' },
      {
        type: 'ul',
        items: [
          '個人老師 / 低用量：直接用 Claude API，品質穩定、維運簡單。',
          '補習班 / 高用量：Gemma 主力 + Claude 做分析與班級建議。',
          'QuizFlow 混合策略：出題用可選、分析一律 Claude，兩者優勢都拿到。',
        ],
      },
      cta,
    ],
  },
  {
    slug: 'hallucination-guard-for-teachers',
    title: 'AI 出題幻覺怎麼防？3 個技巧讓題目百分百準確',
    description:
      'AI 幻覺對老師最危險：一個錯題發給 30 個學生，事後解釋成本遠大於省下的出題時間。這篇分享 3 個可立刻執行的技巧。',
    keywords: ['AI 幻覺', 'AI 準確性', 'AI 驗題', '避免 AI 錯誤'],
    category: 'ai-teaching',
    publishedAt: '2026-04-10',
    readingMinutes: 5,
    author: 'QuizFlow 編輯室',
    tags: ['AI', '準確性', '驗題'],
    body: [
      { type: 'h2', text: '為什麼會有 AI 幻覺？' },
      {
        type: 'p',
        text: 'AI 模型是根據訓練資料統計機率產生文字，當它不確定時，仍會用流暢的語氣寫出錯誤答案。這是結構性問題，無法完全消除，只能透過流程降低。',
      },
      { type: 'h2', text: '技巧 1：永遠提供原文' },
      {
        type: 'p',
        text: '提供 PDF、課文、單字表作為 AI 的參考來源，可把幻覺率從 20% 降到 3% 以下。這是投資報酬率最高的一步。',
      },
      { type: 'h2', text: '技巧 2：要求來源頁碼' },
      {
        type: 'p',
        text: '在提示詞加入「請標註每題的來源頁碼」。如果 AI 胡謅一個不存在的頁碼，你一眼就能發現。',
      },
      { type: 'h2', text: '技巧 3：多維度 rubric 評分' },
      {
        type: 'p',
        text: '讓 AI 自我評分：正確性、完整性、清晰度、教學價值各 0~5 分。rubric total 低於 18 的題目直接剔除。',
      },
      { type: 'h2', text: '第四個加分技巧：人工抽驗' },
      {
        type: 'p',
        text: '即使做了前三項，仍建議抽 20% 的題目人工驗證一次。花 5 分鐘，省掉一整節課的解釋時間。',
      },
      cta,
    ],
  },
];
