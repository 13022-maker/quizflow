/**
 * AdaptiveService — 適性學習的服務單例（每個「適性練習」一個實例）
 * 組裝「BKT 引擎＋導師層＋Drizzle 儲存」；globalThis 快取跨請求／熱重載共用
 * （導師層的卡關計數、進行中課文存在記憶體，重建會遺失）。
 * 學習事件 sink：非同步寫入 adaptive_event 表（失敗只記 log，不中斷教學流程）。
 */
import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { adaptiveEventSchema, adaptivePracticeSchema } from '@/models/Schema';

import { ClaudeTutorProvider } from './claude-provider';
import { AdaptiveEngine, type Item } from './engine';
import { DrizzleAdaptiveRepository } from './repository';
import { getSubject, type Subject } from './subjects';
import {
  BloomTutorLayer,
  TemplateTutorProvider,
  type LearningEvent,
  type NextStep,
  type TutorProvider,
} from './tutor';

export type AdaptiveService = {
  subject: Subject;
  engine: AdaptiveEngine;
  layer: BloomTutorLayer;
  repo: DrizzleAdaptiveRepository;
  /** 依題目 id 查題（answers API 判題用） */
  findItem: (itemId: string) => Item | undefined;
};

/** 學習事件 → adaptive_event 資料列（fire-and-forget，姓名查 state 表反正規化存入） */
function makeLogSink(practiceId: number, repo: DrizzleAdaptiveRepository) {
  return (event: LearningEvent): void => {
    void (async () => {
      try {
        const names = await repo.getDisplayNames();
        await db.insert(adaptiveEventSchema).values({
          practiceId,
          studentKey: event.studentId,
          displayName: names.get(event.studentId) ?? event.studentId,
          eventType: event.eventType,
          knowledgeId: event.knowledgeId ?? null,
          detail: event.detail ?? null,
        });
      } catch (error) {
        console.error(`[adaptive] 學習事件寫入失敗：${(error as Error).message}`);
      }
    })();
  };
}

function createService(practiceId: number, subjectId: string): AdaptiveService {
  const subject = getSubject(subjectId); // 學科不存在會丟出含可用清單的錯誤
  const repo = new DrizzleAdaptiveRepository(practiceId);
  const engine = new AdaptiveEngine(subject.graph, subject.itemBank, repo);

  // 有 Claude 金鑰用 LLM 生成課文與即答，否則離線模板（教學流程不中斷）
  const tutor: TutorProvider = Env.ANTHROPIC_API_KEY
    ? new ClaudeTutorProvider(subject)
    : new TemplateTutorProvider();

  const layer = new BloomTutorLayer(
    engine,
    subject.graph,
    subject.itemBank,
    tutor,
    makeLogSink(practiceId, repo),
  );

  return {
    subject,
    engine,
    layer,
    repo,
    findItem: (itemId) => subject.itemBank.items.find(it => it.id === itemId),
  };
}

// globalThis 快取：dev 熱重載與多個 route module 之間共用同一組實例
const globalStore = globalThis as unknown as {
  __adaptiveServices?: Map<number, AdaptiveService>;
};

/** 取得指定練習的服務單例（key = practiceId；subjectId 來自 practice 資料列） */
export function getAdaptiveService(practiceId: number, subjectId: string): AdaptiveService {
  globalStore.__adaptiveServices ??= new Map();
  let service = globalStore.__adaptiveServices.get(practiceId);
  if (!service) {
    service = createService(practiceId, subjectId);
    globalStore.__adaptiveServices.set(practiceId, service);
  }
  return service;
}

/**
 * 學生端入口：以分享碼（accessCode，8 碼隨機）查練習並取得服務。
 * 學生 API 一律走分享碼而非流水號 id，防止循序猜測別班的練習。
 */
export async function getServiceByCode(code: string) {
  const rows = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(eq(adaptivePracticeSchema.accessCode, code));
  const practice = rows[0];
  if (!practice) {
    throw new Error(`練習不存在：${code}`);
  }
  return { practice, service: getAdaptiveService(practice.id, practice.subjectId) };
}

/** 統一的錯誤轉 HTTP 回應：依錯誤訊息分類狀態碼（學生端公開 API 用） */
export function toErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[adaptive-api] ${new Date().toISOString()} ${message}`);
  const status = message.includes('不存在')
    ? 404 // 練習 / 學生 / 題目不存在
    : message.includes('沒有進行中的課文')
      ? 409 // 狀態衝突：沒有課文卻要提問或完成閱讀
      : 400;
  return Response.json({ error: message }, { status });
}

/**
 * 派題結果的「前端安全版」：剝除正確答案與解析後才回傳。
 * 判對錯一律在伺服器端做——否則學生開瀏覽器開發者工具就能直接看到答案。
 */
export function toClientStep(step: NextStep): NextStep {
  if (step.type !== 'item') {
    return step;
  }
  const { answerIndex: _answer, explanation: _explain, ...safeItem } = step.dispatch.item;
  return {
    ...step,
    // 剝除後缺 answerIndex 欄位，但這正是本函式的目的，故斷言回 Item
    dispatch: { ...step.dispatch, item: safeItem as typeof step.dispatch.item },
  };
}
