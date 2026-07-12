/**
 * ============================================================================
 * Bloom 式導師介入層 (Bloom Tutor Layer)
 * ============================================================================
 * 結合 https://github.com/Li-Evan/Bloom 的核心教學功能到適性派題引擎：
 *
 *   Bloom 概念                    →  本層對應實作
 *   ─────────────────────────────────────────────────────────────
 *   自適應課文（針對薄弱點客製）    →  卡關偵測 + RemedialLesson 補強課文
 *   劃線問答會話（即問即答、可追問） →  askAnnotation() 即時回答，並餵入下次課文生成
 *   思考題（間隔檢索）             →  課文附思考題，開頭複盤上次錯題
 *   「我讀完了」→ 生成下一篇        →  completeLesson() → BKT 學習轉移 → 回到派題
 *   LearningEvent 學習事件         →  learning-log.jsonl（JSONL 格式，同 Bloom）
 *   掌握學習法（精熟才推進）        →  沿用引擎的精熟門檻與知識點鎖定
 *
 * 分層架構：
 *   AdaptiveEngine（診斷：卡在哪個知識點、錯哪些題）
 *        ↑ 唯讀快照 / 學習轉移
 *   BloomTutorLayer（介入：卡關時派補強課文，而不是無限降低題目難度）
 *        → TutorProvider（課文生成：MVP 用模板；正式版換成 LLM 或 Bloom 後端 API）
 *
 * 執行方式：node bloom-tutor.ts
 * ============================================================================
 */

import {
  type AdaptiveEngine,
  clamp,
  type DispatchResult,
  type Item,
  type ItemBank,
  type KnowledgeGraph,
  type KnowledgeNode,
} from './engine';

// ============================================================================
// 第一部分：資料結構
// ============================================================================

/** 導師層參數：集中管理，方便校準 */
const TUTOR_CONFIG = {
  STRUGGLE_WRONG_STREAK: 2, // 同一知識點連續答錯 N 題 → 判定卡關，介入補強課文
  LESSON_BASE_TRANSIT: 0.2, // 讀完補強課文的基礎學習轉移率（BKT 的 P(T)，無證據版）
  LESSON_ANNOTATION_BONUS: 0.02, // 每提出一條劃線提問（有問有答 = 更深入），轉移率加成
  LESSON_MAX_TRANSIT: 0.3, // 單篇課文轉移率上限
} as const;

/** 卡關證據：交給 TutorProvider 客製課文的完整上下文（對應 Bloom「讀懂你的理解程度」） */
export type StruggleEvidence = {
  node: KnowledgeNode; // 卡關的知識點
  mastery: number; // 當前精熟度機率
  wrongItems: Item[]; // 本次卡關期間答錯的題目（課文要針對這些點補強）
  totalHintsUsed: number; // 期間累計使用的提示次數
  previousAnnotations: string[]; // 上一篇課文的劃線提問（若同一知識點二度卡關）
};

/** 補強課文：對應 Bloom 的 Lesson（number/content/思考題） */
export type RemedialLesson = {
  knowledgeId: string;
  title: string;
  content: string; // Markdown 課文內容
  thoughtQuestions: string[]; // 思考題（Bloom 的間隔檢索：下次作答前先複盤）
};

/** 一輪劃線問答：劃了哪段、問了什麼、導師答了什麼 */
export type AnnotationExchange = {
  highlightedText: string; // 學生劃線的課文片段
  question: string; // 學生的提問
  answer: string; // 導師的即時回答
};

/** 劃線提問的完整上下文（比照 Bloom：整篇課文 + 劃線段落 + 本會話對話歷史） */
export type AnnotationContext = {
  lesson: RemedialLesson; // 正在閱讀的課文全文
  highlightedText: string; // 本次劃線的段落
  question: string; // 本次提問
  history: AnnotationExchange[]; // 同一篇課文內先前的問答（支援多輪追問）
};

/**
 * 導師介面：MVP 內建模板版（零依賴）。
 * 正式版替換點——實作同一介面即可無痛切換：
 *   - LLM 版：呼叫 Claude API（見 claude-tutor-provider.ts）
 *   - Bloom 後端版：POST http://localhost:8000/api/courses/{id}/lessons
 */
export type TutorProvider = {
  /**
   * 卡關時生成補強課文。
   * onDelta（可選）：生成過程中逐段回呼課文文字，供前端串流顯示
   * （Bloom 的「流式生成」——學生即時看導師寫課文，不用乾等）
   */
  generateLesson: (
    evidence: StruggleEvidence,
    onDelta?: (text: string) => void
  ) => Promise<RemedialLesson>;
  /** 劃線提問的即時回答（Bloom 的劃線問答會話） */
  answerAnnotation: (context: AnnotationContext) => Promise<string>;
};

/** getNextStep 的回傳：派題、派課文、或課程完成 */
export type NextStep =
  | { type: 'item'; dispatch: DispatchResult }
  | { type: 'lesson'; lesson: RemedialLesson }
  | { type: 'completed' };

/** 學習事件（對應 Bloom 的 LearningEvent 資料表），以 JSONL 追加寫入日誌 */
export type LearningEvent = {
  date: string; // ISO 日期（Bloom 相容欄位）
  at: string; // 完整 ISO 時間戳（儀表板時間軸用）
  studentId: string;
  eventType:
    | 'remedial_lesson_dispatched'
    | 'annotation_added'
    | 'lesson_completed'
    | 'knowledge_mastered'
    | 'course_completed';
  knowledgeId?: string;
  detail?: string;
};

/** 單一學生對單一知識點的「卡關回合」追蹤狀態 */
type StruggleEpisode = {
  wrongStreak: number; // 連續答錯計數（答對即歸零）
  wrongItems: Item[]; // 本回合答錯的題目
  hintsUsed: number; // 本回合累計提示次數
  lastAnnotations: string[]; // 上一篇補強課文收到的劃線提問
};

// ============================================================================
// 第二部分：模板版課文生成器（TutorProvider 的 MVP 實作）
// ============================================================================

/**
 * 模板版導師：用確定性模板組出課文骨架。
 * 課文結構完全比照 Bloom：複盤上次的坑 → 重點講解 → 思考題。
 */
export class TemplateTutorProvider implements TutorProvider {
  async generateLesson(
    evidence: StruggleEvidence,
    onDelta?: (text: string) => void,
  ): Promise<RemedialLesson> {
    const { node, mastery, wrongItems, totalHintsUsed, previousAnnotations } = evidence;

    // 段落一：複盤錯題（Bloom 的「思考題複盤」精神——先面對上次的坑）
    const reviewSection = wrongItems
      .map(it => `- 你在「${it.prompt}」（難度 ${it.difficulty.toFixed(1)}）答錯了`)
      .join('\n');

    // 段落二：若學生上次讀課文時有劃線提問，本篇開頭先回應（Bloom 的批注解答）
    const annotationSection
      = previousAnnotations.length > 0
        ? `\n## 回應你上次的提問\n${
          previousAnnotations.map(q => `> ❓ ${q}\n>\n> 這個問題問得好，本篇會特別針對它展開。`).join('\n\n')}`
        : '';

    // 段落三：依精熟度決定講解起點（精熟度越低，起點越基礎）
    const depthNote
      = mastery < 0.2
        ? '我們從最基礎的觀念重新建立，一步一步來。'
        : '你已有部分基礎，我們針對誤解的環節精準修補。';

    const content = [
      `# 補強課文：${node.name}`,
      ``,
      `## 先看看你卡在哪`,
      reviewSection,
      totalHintsUsed > 0 ? `\n（期間你使用了 ${totalHintsUsed} 次提示——別擔心，這正是導師存在的意義）` : ``,
      annotationSection,
      ``,
      `## 本篇目標`,
      depthNote,
      ``,
      `## 重點講解`,
      `（模板版佔位：正式版由 LLM 依上方錯題證據，生成針對「${node.name}」`,
      `誤解點的完整講解，含範例程式碼與逐步推導。）`,
      ``,
      `讀課文時，任何看不懂的句子都可以「劃線提問」，我會即時回答，`,
      `你的提問也會讓下一篇課文更貼近你的需要。`,
    ].join('\n');

    onDelta?.(content); // 模板版沒有真串流：一次回呼完整內容（模擬串流結束）

    return {
      knowledgeId: node.id,
      title: `補強課文：${node.name}`,
      content,
      // 思考題：下次作答前先自我檢核（Bloom 的間隔檢索）
      thoughtQuestions: [
        `用自己的話說明「${node.name}」的核心觀念是什麼？`,
        `回頭看你答錯的第一題，現在你會怎麼解？`,
      ],
    };
  }

  /** 模板版即時回答：確定性佔位文字（正式版由 LLM 依課文與劃線段落作答） */
  async answerAnnotation(context: AnnotationContext): Promise<string> {
    const followUpNote
      = context.history.length > 0
        ? `這是你在本篇課文的第 ${context.history.length + 1} 個問題，問得越多代表讀得越深入。`
        : '';
    return (
      `（模板版佔位）你劃線的「${context.highlightedText}」確實是關鍵段落。`
      + `${followUpNote}建議先回頭對照課文「重點講解」一節逐步推導一次；`
      + `你的這個提問已被記錄，下一篇課文會針對它展開。`
    );
  }
}

// ============================================================================
// 第三部分：Bloom 導師介入層
// ============================================================================

export class BloomTutorLayer {
  private engine: AdaptiveEngine;
  private graph: KnowledgeGraph;
  private itemBank: ItemBank;
  private tutor: TutorProvider;
  private logSink: (event: LearningEvent) => void;
  // key = `${studentId}:${knowledgeId}`
  private episodes: Map<string, StruggleEpisode>;
  // key = studentId → 待讀完的課文 + 本篇的劃線問答對話（讀完前不派新題）
  private pendingLessons: Map<string, { lesson: RemedialLesson; dialog: AnnotationExchange[] }>;

  constructor(
    engine: AdaptiveEngine,
    graph: KnowledgeGraph,
    itemBank: ItemBank,
    tutor: TutorProvider,
    logSink: (event: LearningEvent) => void,
  ) {
    this.engine = engine;
    this.graph = graph;
    this.itemBank = itemBank;
    this.tutor = tutor;
    this.logSink = logSink;
    this.episodes = new Map();
    this.pendingLessons = new Map();
  }

  /** 學習事件交給 sink（QuizFlow 寫入 adaptive_event 表；失敗不影響主流程由 sink 自理） */
  private log(event: Omit<LearningEvent, 'date' | 'at'>): void {
    const now = new Date();
    const full: LearningEvent = {
      date: now.toISOString().slice(0, 10),
      at: now.toISOString(),
      ...event,
    };
    this.logSink(full);
  }

  private episodeKey(studentId: string, knowledgeId: string): string {
    return `${studentId}:${knowledgeId}`;
  }

  private getEpisode(studentId: string, knowledgeId: string): StruggleEpisode {
    const key = this.episodeKey(studentId, knowledgeId);
    let ep = this.episodes.get(key);
    if (!ep) {
      ep = { wrongStreak: 0, wrongItems: [], hintsUsed: 0, lastAnnotations: [] };
      this.episodes.set(key, ep);
    }
    return ep;
  }

  /**
   * 取得下一步學習活動（取代直接呼叫 engine.getNextItem 的新入口）：
   *   1. 有未讀完的補強課文 → 先讀課文（讀完才繼續，Bloom 的掌握學習法）
   *   2. 某知識點連錯達門檻 → 生成補強課文介入（而不是繼續派更簡單的題）
   *   3. 其餘情況 → 照引擎的差異化邏輯派題
   * onLessonDelta（可選）：課文生成過程的串流回呼，透傳給 TutorProvider
   */
  async getNextStep(
    studentId: string,
    onLessonDelta?: (text: string) => void,
  ): Promise<NextStep> {
    // 步驟 1：有課文沒讀完，先讀完
    const pending = this.pendingLessons.get(studentId);
    if (pending) {
      return { type: 'lesson', lesson: pending.lesson };
    }

    const dispatch = await this.engine.getNextItem(studentId);
    if (!dispatch) {
      this.log({ studentId, eventType: 'course_completed' });
      return { type: 'completed' };
    }

    // 步驟 2：檢查派題目標知識點是否已達卡關門檻 → 切換成課文介入
    const ep = this.getEpisode(studentId, dispatch.targetKnowledgeId);
    if (ep.wrongStreak >= TUTOR_CONFIG.STRUGGLE_WRONG_STREAK) {
      const node = this.graph.nodes.find(n => n.id === dispatch.targetKnowledgeId)!;
      const snapshot = await this.engine.getKnowledgeSnapshot(studentId, node.id);
      const lesson = await this.tutor.generateLesson(
        {
          node,
          mastery: snapshot.mastery,
          wrongItems: [...ep.wrongItems],
          totalHintsUsed: ep.hintsUsed,
          previousAnnotations: [...ep.lastAnnotations],
        },
        onLessonDelta,
      );
      this.pendingLessons.set(studentId, { lesson, dialog: [] });
      this.log({
        studentId,
        eventType: 'remedial_lesson_dispatched',
        knowledgeId: node.id,
        detail: `連錯 ${ep.wrongStreak} 題觸發介入，精熟度 ${snapshot.mastery.toFixed(3)}`,
      });
      return { type: 'lesson', lesson };
    }

    // 步驟 3：正常派題
    return { type: 'item', dispatch };
  }

  /** 提交答題結果：委派引擎更新 BKT 狀態，同時維護卡關偵測與精熟事件 */
  async submitAnswer(
    studentId: string,
    itemId: string,
    isCorrect: boolean,
    hintsUsed: number,
    responseTimeSec?: number,
  ): Promise<void> {
    const item = this.itemBank.items.find(it => it.id === itemId);
    if (!item) {
      throw new Error(`題目不存在：${itemId}`);
    }

    const before = (await this.engine.getKnowledgeSnapshot(studentId, item.knowledgeId)).mastery;
    await this.engine.updateStudentState(studentId, itemId, isCorrect, hintsUsed, responseTimeSec);
    const after = (await this.engine.getKnowledgeSnapshot(studentId, item.knowledgeId)).mastery;

    // 維護卡關回合：答錯累積、答對歸零
    const ep = this.getEpisode(studentId, item.knowledgeId);
    ep.hintsUsed += hintsUsed;
    if (isCorrect) {
      ep.wrongStreak = 0;
      ep.wrongItems = [];
    } else {
      ep.wrongStreak += 1;
      ep.wrongItems.push(item);
    }

    // 精熟度跨越門檻 → 記錄里程碑事件
    if (before < 0.8 && after >= 0.8) {
      this.log({
        studentId,
        eventType: 'knowledge_mastered',
        knowledgeId: item.knowledgeId,
        detail: `精熟度 ${before.toFixed(3)} → ${after.toFixed(3)}`,
      });
    }
  }

  /**
   * 劃線提問即時回答（Bloom 的劃線問答會話）：
   * 學生在課文中劃線並提問 → 導師依「整篇課文 + 劃線段落 + 本會話歷史」即時作答，
   * 同一篇課文內可連續追問（多輪對話）。問答會被記錄：
   *   - 讀完課文時，提問數量提高 BKT 學習轉移率（有問有答 = 更深度的處理）
   *   - 若同一知識點再度卡關，下一篇課文開頭會先回應這些提問
   */
  async askAnnotation(
    studentId: string,
    highlightedText: string,
    question: string,
  ): Promise<string> {
    const pending = this.pendingLessons.get(studentId);
    if (!pending) {
      throw new Error(`學生 ${studentId} 沒有進行中的課文，無法劃線提問`);
    }

    const answer = await this.tutor.answerAnnotation({
      lesson: pending.lesson,
      highlightedText,
      question,
      history: [...pending.dialog], // 傳複本，避免 provider 誤改內部狀態
    });
    pending.dialog.push({ highlightedText, question, answer });

    this.log({
      studentId,
      eventType: 'annotation_added',
      knowledgeId: pending.lesson.knowledgeId,
      detail: question,
    });
    return answer;
  }

  /**
   * 學生點「我讀完了」：依本篇累積的劃線問答套用 BKT 學習轉移、解除課文門檻。
   * 提問越多轉移率越高——有問有答代表更深度的處理（Bloom 的劃線問答會話精神）。
   */
  async completeLesson(studentId: string): Promise<void> {
    const pending = this.pendingLessons.get(studentId);
    if (!pending) {
      throw new Error(`學生 ${studentId} 沒有進行中的課文`);
    }
    const { lesson, dialog } = pending;

    const transit = clamp(
      TUTOR_CONFIG.LESSON_BASE_TRANSIT + dialog.length * TUTOR_CONFIG.LESSON_ANNOTATION_BONUS,
      0,
      TUTOR_CONFIG.LESSON_MAX_TRANSIT,
    );
    const km = await this.engine.applyLearningOpportunity(studentId, lesson.knowledgeId, transit);

    // 重置卡關回合，並保留這次的提問（若再度卡關，下一篇課文會先回應它們）
    const ep = this.getEpisode(studentId, lesson.knowledgeId);
    ep.wrongStreak = 0;
    ep.wrongItems = [];
    ep.lastAnnotations = dialog.map(d => d.question);
    this.pendingLessons.delete(studentId);

    this.log({
      studentId,
      eventType: 'lesson_completed',
      knowledgeId: lesson.knowledgeId,
      detail: `劃線提問 ${dialog.length} 條，學習轉移率 ${transit.toFixed(2)}，精熟度 → ${km.mastery.toFixed(3)}`,
    });
  }
}
