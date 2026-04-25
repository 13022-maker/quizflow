/**
 * 108 新課綱「學習表現」代碼資料表
 *
 * 為何手動 curate 而非完整資料集？
 * - 教育部完整代碼有數百條，UI 下拉選單放不下；老師也不會一條條看
 * - 本檔案僅收錄「最常入題」的指標：以單元教學頻次 + AI 出題友善度為篩選準則
 * - 後續可再擴充至高中職、藝術、綜合活動等領域
 *
 * 代碼格式（參考教育部 108 課綱）：
 * - 國語文 / 英語文：「主軸-學習階段-項次」，如 5-IV-3（閱讀-第四學習階段-第三項）
 * - 數學：「字母-學習階段-項次」，如 n-IV-2（數與量）、a-IV-3（代數）
 * - 自然 / 社會：「主軸-學習階段-項次」，如 INc-IV-1
 *
 * 學習階段：
 * - I：1–2 年級（小學低年級）
 * - II：3–4 年級
 * - III：5–6 年級
 * - IV：7–9 年級（國中）  ← 本表 MVP 範圍
 * - V：高中職
 *
 * 注意：本檔案的描述為簡寫版（≤ 50 字），完整描述請參閱教育部公告。
 */

export type CompetencyCode = {
  /** 完整代碼，例：5-IV-3、n-IV-2、英-S-IV-1 */
  code: string;
  /** 學習階段：iv = 國中 7-9 年級 */
  stage: 'iv';
  /** 主軸描述（≤ 8 字） */
  strand: string;
  /** 學習表現描述（≤ 60 字，AI 出題時注入 prompt） */
  description: string;
};

export type SubjectCurriculum = {
  /** 學科 ID */
  id: 'chinese' | 'english' | 'math' | 'science' | 'social';
  /** 學科顯示名稱 */
  label: string;
  emoji: string;
  /** 此學科的學習表現代碼列表 */
  codes: CompetencyCode[];
};

// ---------- 國語文（國中第四學習階段） ----------
const CHINESE: CompetencyCode[] = [
  { code: '1-IV-2', stage: 'iv', strand: '聆聽', description: '能聽出說話者的觀點、立場與情感，並做合宜回應' },
  { code: '2-IV-1', stage: 'iv', strand: '口語表達', description: '能運用語言進行有效溝通，掌握時機、對象與目的' },
  { code: '3-IV-3', stage: 'iv', strand: '標音與寫字', description: '能運用字辭典工具書，辨識字義、了解詞語意涵' },
  { code: '5-IV-1', stage: 'iv', strand: '閱讀', description: '能掌握各類文本的特徵，深入理解內容並掌握主旨' },
  { code: '5-IV-3', stage: 'iv', strand: '閱讀', description: '能依據文本脈絡推論作者的觀點、立場與弦外之音' },
  { code: '5-IV-5', stage: 'iv', strand: '閱讀', description: '能透過大量閱讀，整合不同文本的資訊與觀點' },
  { code: '6-IV-1', stage: 'iv', strand: '寫作', description: '能依不同目的擬定寫作計畫，組織內容、安排結構' },
  { code: '6-IV-4', stage: 'iv', strand: '寫作', description: '能掌握修辭技巧，使文章生動具感染力' },
];

// ---------- 英語文（國中第四學習階段） ----------
const ENGLISH: CompetencyCode[] = [
  { code: '1-IV-3', stage: 'iv', strand: '聽', description: '能聽懂日常生活中常用的對話與簡短描述' },
  { code: '2-IV-2', stage: 'iv', strand: '說', description: '能使用所學詞彙、句型進行日常溝通與簡短描述' },
  { code: '3-IV-2', stage: 'iv', strand: '讀', description: '能讀懂教材中各類短文，掌握主旨與細節' },
  { code: '3-IV-5', stage: 'iv', strand: '讀', description: '能從上下文推論生字詞義與隱含意思' },
  { code: '4-IV-1', stage: 'iv', strand: '寫', description: '能依書寫格式書寫日常用語與短文' },
  { code: '5-IV-2', stage: 'iv', strand: '聽說綜合', description: '能在情境中聽懂並回應他人說話內容' },
  { code: '7-IV-2', stage: 'iv', strand: '邏輯思考與判斷', description: '能將所學運用於日常生活情境，解決簡單問題' },
  { code: '8-IV-1', stage: 'iv', strand: '文化與習俗', description: '能了解英語系國家風俗習慣與文化差異' },
];

// ---------- 數學（國中第四學習階段） ----------
const MATH: CompetencyCode[] = [
  { code: 'n-IV-2', stage: 'iv', strand: '數與量', description: '理解負數的意義並能進行整數的四則運算' },
  { code: 'n-IV-5', stage: 'iv', strand: '數與量', description: '理解平方根、立方根的概念並能進行運算' },
  { code: 'a-IV-1', stage: 'iv', strand: '代數', description: '理解一元一次方程式的意義並能解題' },
  { code: 'a-IV-3', stage: 'iv', strand: '代數', description: '理解二元一次聯立方程式的解法與應用' },
  { code: 'a-IV-5', stage: 'iv', strand: '代數', description: '理解一元二次方程式的意義並能解題' },
  { code: 'g-IV-2', stage: 'iv', strand: '幾何', description: '理解三角形的內角和、外角和性質與應用' },
  { code: 'g-IV-5', stage: 'iv', strand: '幾何', description: '理解相似形的性質與比例運算' },
  { code: 's-IV-2', stage: 'iv', strand: '空間與形狀', description: '理解柱體、錐體、球體的體積與表面積計算' },
  { code: 'd-IV-2', stage: 'iv', strand: '資料與不確定性', description: '能整理資料並繪製統計圖表，計算統計量' },
];

// ---------- 自然科學（國中第四學習階段） ----------
const SCIENCE: CompetencyCode[] = [
  { code: 'po-IV-1', stage: 'iv', strand: '探究與實作', description: '能從觀察提出問題，設計探究流程蒐集資料' },
  { code: 'tr-IV-1', stage: 'iv', strand: '思考智能', description: '能依據資料分析推理，提出解釋並評估證據' },
  { code: 'INa-IV-1', stage: 'iv', strand: '物質的組成', description: '理解物質的組成與性質，原子、分子的概念' },
  { code: 'INc-IV-1', stage: 'iv', strand: '生命的延續', description: '理解生物的繁殖、遺傳與生命現象' },
  { code: 'INe-IV-1', stage: 'iv', strand: '能量', description: '理解能量的形式、轉換與守恆定律' },
  { code: 'INf-IV-1', stage: 'iv', strand: '生物與環境', description: '理解生態系的組成與生物間的交互作用' },
];

// ---------- 社會（國中第四學習階段，整合歷史/地理/公民） ----------
const SOCIAL: CompetencyCode[] = [
  { code: 'Aa-IV-1', stage: 'iv', strand: '個人與群體', description: '理解個人在群體中的角色與權利義務關係' },
  { code: 'Ba-IV-2', stage: 'iv', strand: '人類生活與社會', description: '理解不同時代與地區的人類生活樣貌與變遷' },
  { code: 'Ca-IV-1', stage: 'iv', strand: '人類經濟活動', description: '理解經濟活動的基本概念與市場運作機制' },
  { code: 'Da-IV-1', stage: 'iv', strand: '臺灣與世界', description: '理解臺灣在亞太地區與全球的地位與互動' },
  { code: 'Ea-IV-2', stage: 'iv', strand: '空間與環境', description: '理解地形、氣候對人類活動的影響' },
  { code: 'Fa-IV-1', stage: 'iv', strand: '公民與民主', description: '理解民主政治的核心價值與公民參與方式' },
];

export const CURRICULUM: SubjectCurriculum[] = [
  { id: 'chinese', label: '國語文', emoji: '📖', codes: CHINESE },
  { id: 'english', label: '英語文', emoji: '🇬🇧', codes: ENGLISH },
  { id: 'math', label: '數學', emoji: '📐', codes: MATH },
  { id: 'science', label: '自然科學', emoji: '🧪', codes: SCIENCE },
  { id: 'social', label: '社會', emoji: '🌏', codes: SOCIAL },
];

/**
 * 由代碼字串反查完整資訊（用於成績頁、編輯器顯示）
 */
export function findCompetency(code: string | null | undefined): (CompetencyCode & { subject: SubjectCurriculum }) | null {
  if (!code) {
    return null;
  }
  for (const subject of CURRICULUM) {
    const c = subject.codes.find(x => x.code === code);
    if (c) {
      return { ...c, subject };
    }
  }
  return null;
}
