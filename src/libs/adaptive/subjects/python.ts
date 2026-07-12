/**
 * 學科設定：Python 程式設計（示範用第二學科）
 * 用途：證明多學科動態載入機制——getTutorService("python") 即可取得
 * 獨立的引擎實例與持久化資料（student_states 表以 subject_id 隔離），與 cpp 互不干擾。
 * 題目數量刻意精簡（每個知識點 3 題）；正式使用時再擴充。
 * 每題為單選題：options 為選項、answerIndex 為正解索引（伺服器端判題）。
 */

import type { ItemBank, KnowledgeGraph } from '../engine';
import type { Subject } from './index';

/** 知識圖譜：變數 → 迴圈 → 串列（線性前置鏈） */
const graph: KnowledgeGraph = {
  nodes: [
    { id: 'py-var', name: '變數與資料型別', prerequisites: [] },
    { id: 'py-loop', name: '迴圈控制', prerequisites: ['py-var'] },
    { id: 'py-list', name: '串列 (list)', prerequisites: ['py-loop'] },
  ],
};

const itemBank: ItemBank = {
  items: [
    // --- 變數與資料型別 ---
    {
      id: 'PV1',
      knowledgeId: 'py-var',
      difficulty: 0.2,
      prompt: 'x = 5 之後，type(x) 會回傳什麼？',
      options: ['<class \'float\'>', '<class \'int\'>', '<class \'str\'>', '<class \'number\'>'],
      answerIndex: 1,
      explanation: '整數字面值 5 的型別是 int；Python 沒有叫 number 的型別。',
    },
    {
      id: 'PV2',
      knowledgeId: 'py-var',
      difficulty: 0.5,
      prompt: '7 / 2 與 7 // 2 的結果分別是？',
      options: ['3 與 3.5', '3.5 與 3.5', '3.5 與 3', '3 與 3'],
      answerIndex: 2,
      explanation: '/ 是真除法、一律回傳 float（3.5）；// 是整數除法、向下取整（3）。',
    },
    {
      id: 'PV3',
      knowledgeId: 'py-var',
      difficulty: 0.8,
      prompt: '下列哪一個轉型會拋出例外？',
      options: ['int(\'3.5\')', 'int(\'12\')', 'str(12)', 'float(\'3.5\')'],
      answerIndex: 0,
      explanation: 'int() 不接受帶小數點的「字串」，會拋 ValueError；要先 float(\'3.5\') 再 int()。',
    },
    // --- 迴圈控制 ---
    {
      id: 'PL1',
      knowledgeId: 'py-loop',
      difficulty: 0.2,
      prompt: 'for i in range(3) 中，i 依序是哪些值？',
      options: ['1, 2, 3', '0, 1, 2', '0, 1, 2, 3', '1, 2'],
      answerIndex: 1,
      explanation: 'range(3) 從 0 開始、不含上界 3，所以是 0、1、2。',
    },
    {
      id: 'PL2',
      knowledgeId: 'py-loop',
      difficulty: 0.5,
      prompt: 'total = 0 之後，下列哪個迴圈正確計算 1~100 的總和？',
      options: [
        'for i in range(100): total += i',
        'for i in range(1, 100): total += i',
        'for i in range(1, 101): total = i',
        'for i in range(1, 101): total += i',
      ],
      answerIndex: 3,
      explanation: 'range 不含上界所以要寫 101；且要用 += 累加，= 只會覆寫成最後一個 i。',
    },
    {
      id: 'PL3',
      knowledgeId: 'py-loop',
      difficulty: 0.8,
      prompt: 'while 迴圈主體中執行 continue 的效果是？',
      options: [
        '跳出整個迴圈',
        '跳回條件判斷，直接開始下一輪',
        '結束程式',
        '重設迴圈變數為初始值',
      ],
      answerIndex: 1,
      explanation: 'continue 跳過主體剩餘的程式碼回到條件判斷；跳出整個迴圈的是 break。',
    },
    // --- 串列 ---
    {
      id: 'PS1',
      knowledgeId: 'py-list',
      difficulty: 0.3,
      prompt: 'nums = [1, 2, 3, 4, 5]，取出最後一個元素的寫法是？',
      options: ['nums[5]', 'nums.last()', 'nums[-1]', 'nums[len(nums)]'],
      answerIndex: 2,
      explanation: '索引從 0 開始，nums[5] 和 nums[len(nums)] 都會 IndexError；-1 代表倒數第一個。',
    },
    {
      id: 'PS2',
      knowledgeId: 'py-list',
      difficulty: 0.5,
      prompt: '用迴圈找 list 最大值，下列做法何者正確？',
      options: [
        'm = nums[0]，走訪時遇到 x > m 就更新 m = x',
        'm = 0，走訪時遇到 x > m 就更新 m = x',
        '不用迴圈，呼叫 nums.max() 即可',
        'm = -1，走訪時遇到 x > m 就更新 m = x',
      ],
      answerIndex: 0,
      explanation: 'm 初始化為 0 或 -1 在全為負數時會錯；另外內建函式是 max(nums)，list 沒有 .max() 方法。',
    },
    {
      id: 'PS3',
      knowledgeId: 'py-list',
      difficulty: 0.8,
      prompt: 'nums = [0, 1, 2, 3, 4, 5]，nums[1:4] 與 nums[::-1] 的結果分別是？',
      options: [
        '[1, 2, 3, 4] 與 [5, 4, 3, 2, 1, 0]',
        '[0, 1, 2, 3] 與原串列不變',
        '[1, 2, 3] 與 [5, 4, 3, 2, 1, 0]',
        '[1, 2, 3] 與原串列不變',
      ],
      answerIndex: 2,
      explanation: '切片含頭不含尾（索引 1~3）；[::-1] 回傳一個反轉的「新」串列，原串列不變。',
    },
  ],
};

export const pythonSubject: Subject = {
  id: 'python',
  name: 'Python 程式設計',
  graph,
  itemBank,
  tutor: {
    lessonExampleRule: '必須含至少一段可執行的 Python 程式碼範例與逐步推導',
    formatRule: '程式碼註解一律使用繁體中文',
  },
};
