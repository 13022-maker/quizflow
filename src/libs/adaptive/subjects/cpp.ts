/**
 * 學科設定：C++ 程式設計（高中計概／程式設計課）
 * 知識圖譜：變數 → 迴圈 → 陣列（線性前置鏈，3 個知識點）
 * 每題為單選題：options 為選項、answerIndex 為正解索引（只存在伺服器端，
 * 派題 API 會剝除）、explanation 為作答後顯示的一句話解析。
 */

import type { ItemBank, KnowledgeGraph } from '../engine';
import type { Subject } from './index';

/** 知識圖譜：變數 → 迴圈 → 陣列（線性前置鏈，3 個知識點） */
const graph: KnowledgeGraph = {
  nodes: [
    { id: 'k-var', name: '變數與資料型別', prerequisites: [] },
    { id: 'k-loop', name: '迴圈控制', prerequisites: ['k-var'] },
    { id: 'k-array', name: '一維陣列', prerequisites: ['k-loop'] },
  ],
};

/** 題庫：每題綁定單一知識點，難度覆蓋 0.1 ~ 1.0 光譜 */
const itemBank: ItemBank = {
  items: [
    // --- 變數與資料型別 ---
    {
      id: 'V01',
      knowledgeId: 'k-var',
      difficulty: 0.2,
      prompt: 'int x = 5; 中 x 的型別是什麼？',
      options: ['double', 'int', 'char', 'string'],
      answerIndex: 1,
      explanation: '宣告最前面的關鍵字就是變數的型別：int x = 5; 宣告了一個 int。',
    },
    {
      id: 'V02',
      knowledgeId: 'k-var',
      difficulty: 0.4,
      prompt: 'double 與 int 相除（例如 7.0 / 2）的結果型別為何？',
      options: ['int', 'float', 'double', '編譯錯誤'],
      answerIndex: 2,
      explanation: '混合運算時 int 會被隱式提升為 double，整個運算式的結果是 double（3.5）。',
    },
    {
      id: 'V03',
      knowledgeId: 'k-var',
      difficulty: 0.6,
      prompt: 'signed int 已是最大值 2147483647，再 +1 會發生什麼？',
      options: [
        '自動升級成 long long，值變 2147483648',
        '維持在最大值不變',
        '程式必定當機並丟出例外',
        '未定義行為（實務上常繞回最小負值 -2147483648）',
      ],
      answerIndex: 3,
      explanation: 'signed 整數溢位在 C++ 是未定義行為；常見實作會繞回負值，但不能依賴它。',
    },
    {
      id: 'V04',
      knowledgeId: 'k-var',
      difficulty: 0.8,
      prompt: '關於 static_cast 與隱式轉型的差異，下列敘述何者正確？',
      options: [
        'static_cast 讓轉型意圖明確，且不合理的轉型會在編譯期報錯',
        'static_cast 的執行速度比隱式轉型快',
        '隱式轉型一定會遺失精確度',
        '兩者完全等價，只是寫法不同',
      ],
      answerIndex: 0,
      explanation: '兩者產生的機器碼通常相同；差別在 static_cast 顯式標出意圖、並提供編譯期檢查。',
    },
    {
      id: 'V05',
      knowledgeId: 'k-var',
      difficulty: 1.0,
      prompt: 'char a = 100, b = 100; int s = a + b; 之後 s 的值是多少？',
      options: [
        '-56（char 相加溢位後才存入 s）',
        '200（a、b 先整數提升為 int 再相加）',
        '未定義行為',
        '編譯錯誤：char 不能相加',
      ],
      answerIndex: 1,
      explanation: '算術運算前 char 會「整數提升」為 int，相加在 int 域進行，不會溢位，s = 200。',
    },
    // --- 迴圈控制 ---
    {
      id: 'L01',
      knowledgeId: 'k-loop',
      difficulty: 0.1,
      prompt: 'for (int i = 0; i < 3; i++) 的迴圈主體會執行幾次？',
      options: ['2 次', '3 次', '4 次', '無限次'],
      answerIndex: 1,
      explanation: 'i 依序是 0、1、2，到 3 時條件 i < 3 不成立而停止，共 3 次。',
    },
    {
      id: 'L02',
      knowledgeId: 'k-loop',
      difficulty: 0.3,
      prompt: 'while 與 do-while 最關鍵的差異是？',
      options: [
        'while 的執行速度比較快',
        'do-while 裡不能使用 break',
        'do-while 的迴圈主體至少會執行一次',
        'while 不能寫成無限迴圈',
      ],
      answerIndex: 2,
      explanation: 'do-while 先執行主體再檢查條件，所以即使條件一開始就不成立，也會先跑一次。',
    },
    {
      id: 'L03',
      knowledgeId: 'k-loop',
      difficulty: 0.5,
      prompt: '下列哪段程式正確計算 1~100 的總和？',
      options: [
        'int s = 0; for (int i = 1; i < 100; i++) s += i;',
        'int s;     for (int i = 1; i <= 100; i++) s += i;',
        'int s = 0; for (int i = 1; i <= 100; i++) s = i;',
        'int s = 0; for (int i = 1; i <= 100; i++) s += i;',
      ],
      answerIndex: 3,
      explanation: '三個錯誤選項分別是：少加了 100（i < 100）、s 未初始化、用 = 覆寫而非 += 累加。',
    },
    {
      id: 'L04',
      knowledgeId: 'k-loop',
      difficulty: 0.7,
      prompt: '用巢狀迴圈印九九乘法表（1×1 到 9×9），需要幾層迴圈、共印出幾筆乘法？',
      options: ['兩層，81 筆', '一層，9 筆', '兩層，18 筆', '三層，729 筆'],
      answerIndex: 0,
      explanation: '外層 i 跑 1~9、內層 j 跑 1~9，主體執行 9 × 9 = 81 次。',
    },
    {
      id: 'L05',
      knowledgeId: 'k-loop',
      difficulty: 0.9,
      prompt: '巢狀迴圈中，內層迴圈執行 break 的效果是？',
      options: [
        '同時跳出內外兩層迴圈',
        '只跳出內層迴圈，外層繼續下一輪',
        '跳過本次內層迭代，繼續內層下一輪',
        '結束整個程式',
      ],
      answerIndex: 1,
      explanation: 'break 只影響「最近的一層」迴圈；跳過本次迭代是 continue 的行為。',
    },
    {
      id: 'L06',
      knowledgeId: 'k-loop',
      difficulty: 0.2,
      prompt: 'for (初始; 條件; 更新) 三個區段中，哪一個在每輪主體結束後執行？',
      options: ['初始', '條件', '更新', '三個都會'],
      answerIndex: 2,
      explanation: '初始只執行一次；條件在每輪開始前檢查；更新在每輪主體結束後執行。',
    },
    {
      id: 'L07',
      knowledgeId: 'k-loop',
      difficulty: 0.4,
      prompt: '想印出 1 到 10 共 10 個數字，下列哪個迴圈頭正確？',
      options: [
        'for (int i = 1; i < 10; i++)',
        'for (int i = 0; i <= 10; i++)',
        'for (int i = 1; i <= 10; i++)',
        'for (int i = 0; i < 9; i++)',
      ],
      answerIndex: 2,
      explanation: '邊界差一（off-by-one）是最常見的迴圈錯誤：i < 10 少印 10，i 從 0 起會多印 0。',
    },
    {
      id: 'L08',
      knowledgeId: 'k-loop',
      difficulty: 0.6,
      prompt: '以試除法判斷 n 是否為質數，迴圈最遠只需要檢查到哪裡就夠了？',
      options: ['√n', 'n - 1', 'n 的所有位數', '2n'],
      answerIndex: 0,
      explanation: '若 n 有大於 √n 的因數，必有一個對應的因數小於 √n，所以檢查到 √n 即可。',
    },
    // --- 一維陣列 ---
    {
      id: 'A01',
      knowledgeId: 'k-array',
      difficulty: 0.3,
      prompt: '宣告一個含 10 個 int 的陣列，下列何者正確？',
      options: ['int a(10);', 'int[10] a;', 'array a = int[10];', 'int a[10];'],
      answerIndex: 3,
      explanation: 'C 風格陣列的中括號放在變數名稱後面：int a[10];（索引 0 ~ 9）。',
    },
    {
      id: 'A02',
      knowledgeId: 'k-array',
      difficulty: 0.5,
      prompt: '用迴圈找陣列最大值時，max 變數應該初始化為什麼最安全？',
      options: [
        '0',
        'a[0]（陣列的第一個元素）',
        '-1',
        '任意值皆可，反正會被更新',
      ],
      answerIndex: 1,
      explanation: '初始化為 0 或 -1 在「元素全是負數」時會得到錯誤答案；用 a[0] 起跑必定正確。',
    },
    {
      id: 'A03',
      knowledgeId: 'k-array',
      difficulty: 0.8,
      prompt: '就地（in-place）反轉長度 n 的陣列，頭尾對調的交換應執行幾次？',
      options: ['n 次', 'n - 1 次', 'n / 2 次', 'n² 次'],
      answerIndex: 2,
      explanation: '頭尾指標往中間夾，交換 n/2 次即完成；跑滿 n 次會把陣列又換回原樣。',
    },
  ],
};

export const cppSubject: Subject = {
  id: 'cpp',
  name: 'C++ 程式設計',
  graph,
  itemBank,
  tutor: {
    lessonExampleRule: '必須含至少一段可執行的 C++ 程式碼範例與逐步推導',
    formatRule: '程式碼註解一律使用繁體中文',
  },
};
