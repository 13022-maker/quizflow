/**
 * ============================================================================
 * 「動態診斷、差異化派案」核心引擎 MVP 原型
 * ============================================================================
 * 架構總覽（三層）：
 *   1. 核心資料結構層：KnowledgeGraph（知識圖譜）/ ItemBank（題庫）/ StudentState（學生狀態）
 *   2. 適性引擎層（AdaptiveEngine）：
 *        - getNextItem()：診斷 → 鎖定/解鎖知識點 → 依目標難度派題
 *        - updateStudentState()：以 BKT（Bayesian Knowledge Tracing）貝氏知識追蹤
 *          更新精熟度機率，並依對錯/提示/時間調整目標難度
 *   3. Mock 測試層：模擬「連續答對 → 卡關 → 用提示回穩 → 解鎖下一知識點」完整流程
 *
 * 執行方式（零依賴，Node.js 23+ 原生支援 TypeScript type stripping）：
 *   node adaptive-engine.ts
 * 或使用 tsx：
 *   npx tsx adaptive-engine.ts
 * ============================================================================
 */

// ============================================================================
// 第一部分：核心資料結構 (Core Data Models)
// ============================================================================

/** 知識點節點：prerequisites 描述前置依賴（必須先精熟前置，才解鎖此節點） */
export type KnowledgeNode = {
  id: string;
  name: string;
  prerequisites: string[]; // 前置知識點 id 清單（空陣列 = 起點知識點）
};

/** 知識圖譜：以節點清單表示的有向無環圖（DAG） */
export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
};

/** 題目：每題「精準綁定單一知識點」，並帶難易度權重 0.1 ~ 1.0 */
export type Item = {
  id: string;
  knowledgeId: string; // 綁定的唯一知識點
  difficulty: number; // 難易度權重 (Difficulty Index)：0.1（最易）~ 1.0（最難）
  prompt: string; // 題幹
  options: string[]; // 選項（單選）
  answerIndex: number; // 正確選項索引——只存在伺服器端，派題 API 會剝除後才回傳前端
  explanation?: string; // 作答後顯示的一句話解析（也隨派題剝除，判題後才回傳）
};

/** 題庫 */
export type ItemBank = {
  items: Item[];
};

/** 單一知識點的學生狀態 */
export type KnowledgeMastery = {
  mastery: number; // 精熟度機率估計值 0 ~ 1
  targetDifficulty: number; // 下一題的目標難度（答對升、答錯/用提示降）
  attempts: number; // 累計作答次數（診斷報表用）
};

/** 學生整體狀態 */
export type StudentState = {
  studentId: string;
  knowledge: Map<string, KnowledgeMastery>; // key = 知識點 id
  answeredItemIds: Set<string>; // 已作答題目（避免短期內重複派同一題）
};

/** 單一知識點的結構化診斷（供 API / 前端儀表板使用） */
export type KnowledgeDiagnosis = {
  knowledgeId: string;
  name: string;
  status: 'mastered' | 'learning' | 'locked'; // 已精熟 / 學習中 / 鎖定中
  mastery: number;
  targetDifficulty: number;
  attempts: number;
};

/** getNextItem 的派案結果：除了題目本身，也回傳「為什麼派這題」的診斷理由 */
export type DispatchResult = {
  item: Item;
  targetKnowledgeId: string;
  isRemediation: boolean; // 是否為前置知識點的補強派案
  reason: string; // 人類可讀的診斷說明（供教師端 dashboard 顯示）
};

/**
 * 學生狀態儲存介面：引擎只依賴此介面，不關心資料存在哪裡。
 * 介面為非同步（真實資料庫驅動都是 async）。實作抽換點：
 *   - InMemoryStudentRepository：記憶體版（預設）
 *   - JsonFileStudentRepository：JSON 檔案版（見 student-repository.ts）
 *   - PostgresStudentRepository：Drizzle + PostgreSQL/PGlite，QuizFlow 同款疊棧
 *     （見 student-repository-pg.ts）
 */
export type StudentStateRepository = {
  get: (studentId: string) => Promise<StudentState | undefined>;
  save: (state: StudentState) => Promise<void>;
  list: () => Promise<StudentState[]>;
};

/** 記憶體版學生狀態儲存（預設實作，資料隨程式結束消失） */
export class InMemoryStudentRepository implements StudentStateRepository {
  private students = new Map<string, StudentState>();

  async get(studentId: string): Promise<StudentState | undefined> {
    return this.students.get(studentId);
  }

  async save(state: StudentState): Promise<void> {
    this.students.set(state.studentId, state);
  }

  async list(): Promise<StudentState[]> {
    return [...this.students.values()];
  }
}

// ============================================================================
// 第二部分：適性引擎 (Adaptive Engine)
// ============================================================================

/** 引擎參數：集中管理所有可調權重，方便日後 A/B 校準 */
export const ENGINE_CONFIG = {
  MASTERY_THRESHOLD: 0.8, // 精熟門檻：P(已學會) 低於此值視為未精熟，鎖定後續知識點
  INITIAL_DIFFICULTY: 0.4, // 初始目標難度

  // --- BKT（Bayesian Knowledge Tracing）四大標準參數 ---
  // 參數刻意調保守：至少連續答對 3 題才可能跨越精熟門檻，避免誤判精熟
  BKT_P_L0: 0.25, // P(L0)：學生在作答前「已具備該知識」的先驗機率
  BKT_P_T: 0.1, // P(T)：每次作答機會後，從「未學會」轉移到「學會」的機率
  BKT_P_GUESS: 0.25, // P(G)：未學會卻矇對的基礎機率
  BKT_P_SLIP: 0.1, // P(S)：已學會卻失誤答錯的基礎機率

  // --- 題目層級修正（KT-IDEM 精神：guess/slip 隨題目難度變動）---
  GUESS_EASY_BONUS: 0.15, // 題目越簡單，矇對機率越高：G' = G + 0.15×(1−難度)
  SLIP_HARD_BONUS: 0.1, // 題目越難，失誤機率越高：S' = S + 0.1×難度

  // --- 提示與作答時間對「證據力」的修正 ---
  HINT_GUESS_BONUS: 0.2, // 每用一次提示，答對的等效 guess 上升（證據力下降）
  HINT_TRANSIT_DISCOUNT: 0.25, // 每用一次提示，學習轉移率 P(T) 打的折扣

  // --- 差異化難度調整（與精熟度估計解耦的獨立旋鈕）---
  DIFFICULTY_STEP_UP: 0.15, // 純答對（無提示）→ 下一題難度上調幅度
  DIFFICULTY_STEP_UP_HINTED: 0.05, // 用提示才答對 → 小幅上調
  DIFFICULTY_STEP_DOWN: 0.2, // 答錯 → 難度下調幅度
  MIN_DIFFICULTY: 0.1,
  MAX_DIFFICULTY: 1.0,
  FRESH_GAP_TOLERANCE: 0.3, // 新題與目標難度落差超過此值時，允許重派已作答過的題
  FAST_ANSWER_SEC: 30, // 低於此秒數視為「快速作答」，學習轉移率小幅加成
  SLOW_ANSWER_SEC: 90, // 高於此秒數視為「猶豫作答」，學習轉移率略降
} as const;

/** 數值夾限工具 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * BKT 核心更新：對單次作答結果做貝氏更新，再套用學習轉移。
 *
 * 步驟一（貝氏證據更新）：依作答結果修正 P(已學會)
 *   答對：P(L|對) = P(L)(1−S′) / [P(L)(1−S′) + (1−P(L))G′]
 *   答錯：P(L|錯) = P(L)S′ / [P(L)S′ + (1−P(L))(1−G′)]
 * 步驟二（學習轉移）：這次作答本身也是學習機會
 *   P(L′) = P(L|觀測) + (1 − P(L|觀測)) × P(T)′
 */
export function bktUpdate(
  pLearned: number, // 更新前的 P(已學會)
  isCorrect: boolean,
  guess: number, // 題目層級修正後的 G′
  slip: number, // 題目層級修正後的 S′
  transit: number, // 提示/時間修正後的 P(T)′
): number {
  const evidence = isCorrect
    ? (pLearned * (1 - slip)) / (pLearned * (1 - slip) + (1 - pLearned) * guess)
    : (pLearned * slip) / (pLearned * slip + (1 - pLearned) * (1 - guess));
  return clamp(evidence + (1 - evidence) * transit, 0, 1);
}

export class AdaptiveEngine {
  private graph: KnowledgeGraph;
  private itemBank: ItemBank;
  private repo: StudentStateRepository; // 學生狀態儲存層（可抽換）
  private topoOrder: KnowledgeNode[]; // 知識圖譜的拓撲排序快取（學習路徑）

  constructor(
    graph: KnowledgeGraph,
    itemBank: ItemBank,
    repository: StudentStateRepository = new InMemoryStudentRepository(),
  ) {
    this.graph = graph;
    this.itemBank = itemBank;
    this.repo = repository;
    this.topoOrder = this.topologicalSort(graph);
  }

  /**
   * 拓撲排序：把知識圖譜攤平成「合法學習路徑」。
   * 保證任何節點都排在它所有前置知識點之後；若圖中有循環依賴則直接報錯，
   * 在建構期就擋掉不合法的課程設計。
   */
  private topologicalSort(graph: KnowledgeGraph): KnowledgeNode[] {
    const sorted: KnowledgeNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>(); // 偵測循環用
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    const visit = (node: KnowledgeNode): void => {
      if (visited.has(node.id)) {
        return;
      }
      if (visiting.has(node.id)) {
        throw new Error(`知識圖譜含循環依賴：${node.id}`);
      }
      visiting.add(node.id);
      for (const prereqId of node.prerequisites) {
        const prereq = nodeMap.get(prereqId);
        if (!prereq) {
          throw new Error(`找不到前置知識點：${prereqId}`);
        }
        visit(prereq);
      }
      visiting.delete(node.id);
      visited.add(node.id);
      sorted.push(node);
    };

    graph.nodes.forEach(visit);
    return sorted;
  }

  /**
   * 註冊學生（冪等）：已存在則回傳既有狀態（搭配持久化儲存時可跨執行續學），
   * 不存在才對圖譜中每個知識點建立初始狀態。
   */
  async registerStudent(studentId: string): Promise<StudentState> {
    const existing = await this.repo.get(studentId);
    if (existing) {
      return existing;
    } // 已有紀錄：直接續用（跨執行恢復進度）

    const knowledge = new Map<string, KnowledgeMastery>();
    for (const node of this.graph.nodes) {
      knowledge.set(node.id, {
        mastery: ENGINE_CONFIG.BKT_P_L0, // 初始精熟度 = BKT 先驗 P(L0)
        targetDifficulty: ENGINE_CONFIG.INITIAL_DIFFICULTY,
        attempts: 0,
      });
    }
    const state: StudentState = {
      studentId,
      knowledge,
      answeredItemIds: new Set(),
    };
    await this.repo.save(state);
    return state;
  }

  private async getStudent(studentId: string): Promise<StudentState> {
    const state = await this.repo.get(studentId);
    if (!state) {
      throw new Error(`學生不存在：${studentId}`);
    }
    return state;
  }

  private getMastery(state: StudentState, knowledgeId: string): KnowledgeMastery {
    const km = state.knowledge.get(knowledgeId);
    if (!km) {
      throw new Error(`學生狀態缺少知識點：${knowledgeId}`);
    }
    return km;
  }

  /** 判斷某知識點是否已精熟 */
  private isMastered(state: StudentState, knowledgeId: string): boolean {
    return this.getMastery(state, knowledgeId).mastery >= ENGINE_CONFIG.MASTERY_THRESHOLD;
  }

  /** 判斷某知識點是否被鎖定（任一前置未精熟即鎖定） */
  private isLocked(state: StudentState, node: KnowledgeNode): boolean {
    return node.prerequisites.some(p => !this.isMastered(state, p));
  }

  /**
   * 差異化派案核心：get_next_item
   *
   * 演算法：
   *   1. 沿拓撲排序（合法學習路徑）找出第一個「未精熟」的知識點。
   *   2. 若該知識點被鎖定（前置未精熟）→ 改派「未精熟前置」的補強題（remediation）。
   *      （沿拓撲排序掃描時，未精熟的前置一定排在更前面，因此正常情況下
   *        第一個未精熟節點必然已解鎖；此處防禦性檢查同時產生診斷理由。）
   *   3. 在目標知識點的題目中，挑「難度最接近學生當前目標難度」的一題；
   *      優先派未作答過的題，全部答過才允許重複。
   *   4. 全部知識點皆精熟 → 回傳 null（課程完成）。
   */
  async getNextItem(studentId: string): Promise<DispatchResult | null> {
    const state = await this.getStudent(studentId);

    // 步驟 1：沿學習路徑找第一個未精熟的知識點
    let targetNode: KnowledgeNode | null = null;
    for (const node of this.topoOrder) {
      if (!this.isMastered(state, node.id)) {
        targetNode = node;
        break;
      }
    }
    if (!targetNode) {
      return null;
    } // 全部精熟，課程完成

    // 步驟 2：檢查前置依賴 → 決定是正常派題還是補強派題
    let isRemediation = false;
    let reason: string;
    const unmetPrereq = targetNode.prerequisites.find(p => !this.isMastered(state, p));
    if (unmetPrereq !== undefined) {
      // 前置未精熟：鎖定原目標，改派前置知識點的補強題
      const lockedName = targetNode.name;
      targetNode = this.topoOrder.find(n => n.id === unmetPrereq)!;
      isRemediation = true;
      reason = `「${lockedName}」因前置「${targetNode.name}」未達精熟門檻而鎖定，改派補強題`;
    } else {
      const km = this.getMastery(state, targetNode.id);
      reason = `「${targetNode.name}」學習中（精熟度 ${km.mastery.toFixed(2)}），依目標難度派題`;
    }

    // 步驟 3：在目標知識點題目中，選「難度最接近目標難度」的題目
    const km = this.getMastery(state, targetNode.id);
    const candidates = this.itemBank.items.filter(it => it.knowledgeId === targetNode!.id);
    if (candidates.length === 0) {
      throw new Error(`題庫中沒有知識點「${targetNode.id}」的題目`);
    }
    // 優先使用未作答過的題目；但若最接近的新題與目標難度落差過大
    // （> FRESH_GAP_TOLERANCE），允許重派已作答過的題——例如補強課文讀完後
    // 難度已下修，此時重試先前答錯的簡單題，正是精熟學習法的正確做法
    const pickNearest = (pool: Item[]): Item =>
      pool.reduce((best, cur) =>
        Math.abs(cur.difficulty - km.targetDifficulty) < Math.abs(best.difficulty - km.targetDifficulty)
          ? cur
          : best,
      );
    const fresh = candidates.filter(it => !state.answeredItemIds.has(it.id));
    let item = fresh.length > 0 ? pickNearest(fresh) : pickNearest(candidates);
    if (
      Math.abs(item.difficulty - km.targetDifficulty) > ENGINE_CONFIG.FRESH_GAP_TOLERANCE
    ) {
      const overall = pickNearest(candidates); // 含已作答的完整題池
      if (
        Math.abs(overall.difficulty - km.targetDifficulty)
        < Math.abs(item.difficulty - km.targetDifficulty)
      ) {
        item = overall;
      }
    }

    return { item, targetKnowledgeId: targetNode.id, isRemediation, reason };
  }

  /**
   * 學生狀態更新核心：update_student_state
   *
   * 精熟度更新模型：BKT（Bayesian Knowledge Tracing）貝氏知識追蹤
   *   mastery 欄位的語意 = P(該生已學會此知識點) 的機率估計。
   *   每次作答做兩件事：貝氏證據更新（依對錯修正機率）＋ 學習轉移（作答即學習）。
   *
   *   題目難度、提示、作答時間透過以下方式進入模型：
   *   - 難度 → 修正題目層級的 guess/slip（KT-IDEM 精神）：
   *       簡單題矇對容易 → 答對證據力低、答錯扣分重
   *       困難題失誤常見 → 答錯扣分輕、答對證據力高
   *   - 提示 → 答對的等效 guess 上升（看提示答對 ≠ 真的會），
   *       且學習轉移率 P(T) 打折（依賴提示的學習較淺）
   *   - 時間 → 快速作答代表熟練，P(T) 小幅加成；超時作答 P(T) 略降
   *
   * 目標難度調整（差異化旋鈕，與精熟度估計刻意解耦）：
   *   - 無提示答對 → 難度 +0.15（挑戰升級）
   *   - 用提示答對 → 難度 +0.05（小步前進）
   *   - 答錯       → 難度 -0.20（退回舒適區重建信心）
   */
  async updateStudentState(
    studentId: string,
    itemId: string,
    isCorrect: boolean,
    hintsUsed: number,
    responseTimeSec: number = ENGINE_CONFIG.FAST_ANSWER_SEC,
  ): Promise<KnowledgeMastery> {
    const state = await this.getStudent(studentId);
    const item = this.itemBank.items.find(it => it.id === itemId);
    if (!item) {
      throw new Error(`題目不存在：${itemId}`);
    }

    const km = this.getMastery(state, item.knowledgeId);
    km.attempts += 1;
    state.answeredItemIds.add(itemId);

    // --- 步驟 1：計算題目層級的 guess / slip（隨難度修正）---
    const baseGuess = clamp(
      ENGINE_CONFIG.BKT_P_GUESS + ENGINE_CONFIG.GUESS_EASY_BONUS * (1 - item.difficulty),
      0.05,
      0.5,
    );
    // 用提示答對時，等效 guess 上升：正確答案的證據力被稀釋
    const guess = isCorrect
      ? clamp(baseGuess + ENGINE_CONFIG.HINT_GUESS_BONUS * hintsUsed, 0.05, 0.85)
      : baseGuess;
    const slip = clamp(
      ENGINE_CONFIG.BKT_P_SLIP + ENGINE_CONFIG.SLIP_HARD_BONUS * item.difficulty,
      0.01,
      0.3,
    );

    // --- 步驟 2：計算本次的學習轉移率 P(T)′（提示折扣 × 時間係數）---
    const timeFactor
      = responseTimeSec <= ENGINE_CONFIG.FAST_ANSWER_SEC
        ? 1.1
        : responseTimeSec <= ENGINE_CONFIG.SLOW_ANSWER_SEC
          ? 1.0
          : 0.8;
    const transit = clamp(
      ENGINE_CONFIG.BKT_P_T * timeFactor
      * (1 - ENGINE_CONFIG.HINT_TRANSIT_DISCOUNT * hintsUsed),
      0.02,
      0.5,
    );

    // --- 步驟 3：BKT 貝氏更新精熟度機率 ---
    km.mastery = bktUpdate(km.mastery, isCorrect, guess, slip, transit);

    // --- 步驟 4：調整下一題目標難度（差異化派案的獨立旋鈕）---
    if (isCorrect) {
      const step = hintsUsed === 0
        ? ENGINE_CONFIG.DIFFICULTY_STEP_UP
        : ENGINE_CONFIG.DIFFICULTY_STEP_UP_HINTED;
      km.targetDifficulty = clamp(
        km.targetDifficulty + step,
        ENGINE_CONFIG.MIN_DIFFICULTY,
        ENGINE_CONFIG.MAX_DIFFICULTY,
      );
    } else {
      km.targetDifficulty = clamp(
        km.targetDifficulty - ENGINE_CONFIG.DIFFICULTY_STEP_DOWN,
        ENGINE_CONFIG.MIN_DIFFICULTY,
        ENGINE_CONFIG.MAX_DIFFICULTY,
      );
    }

    await this.repo.save(state); // 狀態變更後寫回儲存層（持久化實作在此落盤）
    return km;
  }

  /** 取得學生單一知識點狀態的唯讀快照（供外部導師層診斷用，回傳複本、不可回寫） */
  async getKnowledgeSnapshot(
    studentId: string,
    knowledgeId: string,
  ): Promise<Readonly<KnowledgeMastery>> {
    return { ...this.getMastery(await this.getStudent(studentId), knowledgeId) };
  }

  /**
   * 套用一次「無作答證據的學習機會」（BKT 的學習轉移項）。
   * 用途：閱讀補強課文、觀看教學影片等行為沒有對/錯證據可做貝氏更新，
   * 但依 BKT 模型仍是一次學習機會 → P(L′) = P(L) + (1 − P(L)) × transit
   */
  async applyLearningOpportunity(
    studentId: string,
    knowledgeId: string,
    transit: number,
  ): Promise<KnowledgeMastery> {
    const state = await this.getStudent(studentId);
    const km = this.getMastery(state, knowledgeId);
    km.mastery = clamp(km.mastery + (1 - km.mastery) * clamp(transit, 0, 1), 0, 1);
    await this.repo.save(state); // 狀態變更後寫回儲存層
    return km;
  }

  /** 結構化診斷：每個知識點的狀態（供 API 回傳 JSON / 前端儀表板渲染） */
  async getDiagnosis(studentId: string): Promise<KnowledgeDiagnosis[]> {
    const state = await this.getStudent(studentId);
    return this.topoOrder.map((node) => {
      const km = this.getMastery(state, node.id);
      const status: KnowledgeDiagnosis['status'] = this.isMastered(state, node.id)
        ? 'mastered'
        : this.isLocked(state, node)
          ? 'locked'
          : 'learning';
      return {
        knowledgeId: node.id,
        name: node.name,
        status,
        mastery: km.mastery,
        targetDifficulty: km.targetDifficulty,
        attempts: km.attempts,
      };
    });
  }

  /** 文字版診斷報表：基於 getDiagnosis() 產生（CLI Demo 用） */
  async diagnose(studentId: string): Promise<string> {
    const statusLabel = {
      mastered: '✅ 已精熟',
      locked: '🔒 鎖定中',
      learning: '📖 學習中',
    } as const;
    return (await this.getDiagnosis(studentId))
      .map(
        d =>
          `  ${statusLabel[d.status]}｜${d.name.padEnd(12, '　')} 精熟度=${d.mastery.toFixed(3)}  目標難度=${d.targetDifficulty.toFixed(2)}  作答=${d.attempts} 次`,
      )
      .join('\n');
  }
}

// ============================================================================
// 第三部分：學科內容已抽離
// 知識圖譜與題庫移至 /subjects 目錄（subjects/cpp.ts、subjects/python.ts…），
// 由 subjects/index.ts 的 getSubject(subjectId) 動態載入——引擎自此為純演算法。
// ============================================================================
