/**
 * ============================================================================
 * ClaudeTutorProvider — 用 Claude API 真正生成補強課文的導師實作
 * ============================================================================
 * 實作 bloom-tutor.ts 的 TutorProvider 介面，抽換點就是上一版註解裡預留的位置。
 *
 * 技術要點（依 Anthropic 官方最新 API 規範）：
 *   - 模型：claude-opus-4-8（Opus 4.8，不需也不可傳 temperature/top_p）
 *   - 思考：thinking: { type: "adaptive" }（Opus 4.8 需明確開啟，讓模型自行
 *     決定思考深度；舊版的 budget_tokens 已移除，傳了會 400）
 *   - 串流：client.messages.stream() + finalMessage()，避免長輸出撞上 HTTP 逾時，
 *     並以 onDelta 回呼支援前端流式顯示
 *   - 課文格式：純 Markdown＋格式約定（見 parseLessonMarkdown）
 *   - 學科切換：系統提示由 Subject.tutor 動態組出——程式學科要求可執行程式碼範例、
 *     數學學科要求逐步算式推導與純文字數學式（禁 LaTeX，前端不支援渲染）
 *   - 韌性：API 呼叫失敗（沒網路、沒金鑰、限流）時自動降級回模板版，
 *     課堂上斷網也不會讓整個系統掛掉
 *
 * 執行 Demo（跑與 bloom-tutor.ts 相同的四階段流程，但課文由 LLM 生成）：
 *   node claude-tutor-provider.ts
 * 憑證：SDK 會自動讀取 ANTHROPIC_API_KEY 環境變數
 * ============================================================================
 */

import Anthropic from '@anthropic-ai/sdk';

import { generateAIText, isProSafe } from '@/lib/ai/textModel';

import type { Subject } from './subjects';
import { cppSubject } from './subjects/cpp'; // 預設學科（向下相容用）
import {
  type AnnotationContext,
  type RemedialLesson,
  type StruggleEvidence,
  TemplateTutorProvider,
  type TutorProvider,
} from './tutor';

/**
 * 課文輸出改用「純 Markdown ＋ 格式約定」而非 JSON Schema：
 * 串流時逐段送出的才是可直接漸進渲染的課文文字（JSON 轉義字串無法邊收邊顯示）。
 * 格式約定（寫進系統提示）：第一行 `# 標題`；最後一節固定為 `## 思考題`（2~3 個列點）。
 * 生成完畢後由 parseLessonMarkdown() 拆回 RemedialLesson 結構。
 */
function parseLessonMarkdown(markdown: string, knowledgeId: string): RemedialLesson {
  const title = markdown.match(/^#\s+(\S.*)$/m)?.[1]?.trim() ?? '補強課文';

  // 以「## 思考題」為界：前段是課文本體，後段逐行取出列點作為思考題
  const split = markdown.split(/^##\s*【?思考題】?\s*$/m);
  const content = (split[0] ?? markdown).trim();
  const bulletPattern = /^\s*(?:[-*・]|\d+[.、）)])\s+/;
  const thoughtQuestions = (split[1] ?? '')
    .split('\n')
    .filter(line => bulletPattern.test(line))
    .map(line => line.replace(bulletPattern, '').trim())
    .filter(Boolean);

  if (thoughtQuestions.length === 0) {
    thoughtQuestions.push('用自己的話說明這篇課文的核心觀念是什麼？');
  }
  return { knowledgeId, title, content, thoughtQuestions };
}

/**
 * 課文生成的系統提示：依學科動態組出（學科名稱、範例形式、表達格式規則）。
 * 穩定不變的部分放 system、與每次變動的證據分離，利於快取。
 */
function buildLessonSystemPrompt(subject: Subject): string {
  return `你是一位台灣高中「${subject.name}」課程的 AI 一對一導師，教學法遵循 Bloom 2 Sigma 研究的精熟學習精神。

你的任務：學生在某個知識點「卡關」（連續答錯）時，根據他的錯題證據，為他量身打造一篇補強課文。

課文寫作原則：
1. 用繁體中文，語氣溫暖鼓勵、不說教；${subject.tutor.formatRule}
2. 蘇格拉底式教學：多用引導性問題，不直接丟答案
3. 輸出「純 Markdown」，格式嚴格遵守：
   - 第一行必須是「# 課文標題」（一行、不加其他文字）
   - 正文依序四段：
     ## 先看看你卡在哪 —— 逐題複盤學生答錯的題目，點出每題背後的「真正誤解」
     ## 回應你上次的提問 —— 若學生先前有劃線提問，先認真回答（沒有就省略此段）
     ## 重點講解 —— 針對誤解點重建觀念，${subject.tutor.lessonExampleRule}
     ## 常見陷阱 —— 1~2 個該知識點最容易再犯的錯
   - 最後一節必須是「## 思考題」，列 2~3 個「- 」開頭的問題（間隔檢索用）
   - 除 Markdown 課文外不要輸出任何其他文字（不要 JSON、不要前後說明）
4. 依學生當前精熟度調整起點：精熟度 < 0.2 從最基礎講起；否則精準修補誤解環節
5. 長度控制在 500~900 字（不含程式碼與算式），一篇課文只聚焦這一個知識點`;
}

/** 劃線問答的系統提示：與課文生成分離的輕量人設（回答要短、要即時），同樣依學科組出 */
function buildAnnotationSystemPrompt(subject: Subject): string {
  return `你是一位台灣高中「${subject.name}」課程的 AI 一對一導師。學生正在閱讀一篇補強課文，對某個劃線段落提出了問題。

回答原則：
1. 用繁體中文，直接回答重點，長度控制在 100~200 字（這是即時問答，不是課文）
2. 先給明確答案，再視情況用一個小反問促進思考（蘇格拉底式收尾）
3. 需要舉例時給最精簡的一小段即可；${subject.tutor.formatRule}
4. 緊扣課文脈絡與劃線段落，不要岔題展開新主題`;
}

/** 把卡關證據組成使用者訊息（每次變動的內容放 messages，利於快取設計） */
function buildEvidencePrompt(evidence: StruggleEvidence): string {
  const { node, mastery, wrongItems, totalHintsUsed, previousAnnotations } = evidence;
  const wrongList = wrongItems
    .map(it => `- 【${it.id}】難度 ${it.difficulty.toFixed(1)}：${it.prompt}`)
    .join('\n');
  const annotationList
    = previousAnnotations.length > 0
      ? previousAnnotations.map(q => `- ${q}`).join('\n')
      : '（無）';

  return `請為以下卡關的學生生成一篇補強課文。

## 卡關知識點
${node.name}（前置知識點：${node.prerequisites.length > 0 ? node.prerequisites.join('、') : '無'}）

## 學生狀態
- 當前精熟度機率（BKT 估計）：${mastery.toFixed(3)}
- 本次卡關期間使用提示次數：${totalHintsUsed}

## 答錯的題目
${wrongList}

## 學生上一篇課文的劃線提問
${annotationList}`;
}

export class ClaudeTutorProvider implements TutorProvider {
  private client: Anthropic;
  private fallback: TemplateTutorProvider;
  private lessonSystemPrompt: string;
  private annotationSystemPrompt: string;

  /** subject：導師提示詞隨學科切換（預設 cpp，既有呼叫端不變） */
  constructor(subject: Subject = cppSubject) {
    // SDK 自動從環境解析憑證（ANTHROPIC_API_KEY 或 ant auth login 的 profile）
    this.client = new Anthropic();
    this.fallback = new TemplateTutorProvider(); // API 失敗時的離線降級方案
    this.lessonSystemPrompt = buildLessonSystemPrompt(subject);
    this.annotationSystemPrompt = buildAnnotationSystemPrompt(subject);
  }

  async generateLesson(
    evidence: StruggleEvidence,
    onDelta?: (text: string) => void,
  ): Promise<RemedialLesson> {
    // 付費且有金鑰才走 Claude 串流（免費用戶直接跳到 Gemini）
    if (await isProSafe() && process.env.ANTHROPIC_API_KEY?.trim()) {
      try {
        // 串流呼叫：課文以純 Markdown 逐段輸出，每個文字增量即時回呼給 onDelta
        // （前端可邊收邊渲染，Bloom 的「流式生成」體驗）
        const stream = this.client.messages.stream({
          model: 'claude-opus-4-8',
          max_tokens: 16000,
          thinking: { type: 'adaptive' }, // Opus 4.8 需明確開啟 adaptive thinking
          system: this.lessonSystemPrompt,
          messages: [{ role: 'user', content: buildEvidencePrompt(evidence) }],
        });
        if (onDelta) {
          stream.on('text', delta => onDelta(delta));
        }
        const message = await stream.finalMessage();

        // 先檢查停止原因，再讀內容（refusal / max_tokens 時輸出可能不完整）
        if (message.stop_reason === 'refusal') {
          throw new Error('Claude 拒絕了此請求');
        }
        if (message.stop_reason === 'max_tokens') {
          throw new Error('輸出被 max_tokens 截斷');
        }

        const textBlock = message.content.find(b => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('回應中沒有文字內容');
        }

        // 依格式約定把 Markdown 拆回 RemedialLesson 結構
        return parseLessonMarkdown(textBlock.text, evidence.node.id);
      } catch (error) {
        // 分類錯誤原因後改試 Gemini（課堂上不能因為 API 問題中斷教學）
        if (error instanceof Anthropic.AuthenticationError) {
          console.warn('   ⚠️ API 金鑰無效或未設定（請設定 ANTHROPIC_API_KEY）');
        } else if (error instanceof Anthropic.RateLimitError) {
          console.warn('   ⚠️ API 觸發限流（429）');
        } else if (error instanceof Anthropic.APIConnectionError) {
          console.warn('   ⚠️ 無法連線到 Claude API（請檢查網路）');
        } else if (error instanceof Anthropic.APIError) {
          console.warn(`   ⚠️ Claude API 錯誤（${error.status}）：${error.message}`);
        } else {
          console.warn(`   ⚠️ 課文生成失敗：${(error as Error).message}`);
        }
        console.warn('   ⚠️ Claude 失敗，改試 Gemini');
      }
    }
    // Gemini 備援（免費用戶的主路徑）：非串流，一次回全文
    try {
      const { text } = await generateAIText({
        prompt: buildEvidencePrompt(evidence),
        system: this.lessonSystemPrompt,
        maxTokens: 16000,
      });
      onDelta?.(text); // 無串流，全文一次回呼
      return parseLessonMarkdown(text, evidence.node.id);
    } catch (err) {
      console.warn(`   ⚠️ Gemini 也失敗（${(err as Error).message}），改用模板版課文`);
      return this.fallback.generateLesson(evidence, onDelta);
    }
  }

  /**
   * 劃線提問即時回答：多輪對話。
   * 訊息組裝比照 Bloom 的上下文設計：課文全文只放在對話的第一則使用者訊息
   * （後續追問共用同一前綴，對 prompt cache 友善），之後每輪只帶劃線段落與問題。
   */
  async answerAnnotation(context: AnnotationContext): Promise<string> {
    // 付費且有金鑰才走 Claude 串流（免費用戶直接跳到 Gemini）
    if (await isProSafe() && process.env.ANTHROPIC_API_KEY?.trim()) {
      try {
        const messages: Anthropic.MessageParam[] = [];

        // 重建本篇課文的問答歷史（交替 user / assistant）
        context.history.forEach((ex, i) => {
          messages.push({
            role: 'user',
            content:
              i === 0
                ? this.firstAnnotationTurn(context, ex.highlightedText, ex.question)
                : this.followUpTurn(ex.highlightedText, ex.question),
          });
          messages.push({ role: 'assistant', content: ex.answer });
        });

        // 本次提問：若是本篇第一問，帶入課文全文；否則只帶劃線與問題
        messages.push({
          role: 'user',
          content:
            context.history.length === 0
              ? this.firstAnnotationTurn(context, context.highlightedText, context.question)
              : this.followUpTurn(context.highlightedText, context.question),
        });

        const stream = this.client.messages.stream({
          model: 'claude-opus-4-8',
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          system: this.annotationSystemPrompt,
          messages,
        });
        const message = await stream.finalMessage();

        if (message.stop_reason === 'refusal') {
          throw new Error('Claude 拒絕了此提問');
        }
        const textBlock = message.content.find(b => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('回應中沒有文字內容');
        }
        return textBlock.text.trim();
      } catch (error) {
        // 即時問答失敗不該中斷閱讀：說明原因後改試 Gemini
        console.warn(
          `   ⚠️ 即時回答失敗（${(error as Error).message}），改試 Gemini`,
        );
      }
    }
    // Gemini 備援：把問答歷史序列化成單一 prompt
    try {
      const parts: string[] = [];
      context.history.forEach((ex, i) => {
        parts.push(`【學生】${i === 0
          ? this.firstAnnotationTurn(context, ex.highlightedText, ex.question)
          : this.followUpTurn(ex.highlightedText, ex.question)}`);
        parts.push(`【導師】${ex.answer}`);
      });
      parts.push(`【學生】${context.history.length === 0
        ? this.firstAnnotationTurn(context, context.highlightedText, context.question)
        : this.followUpTurn(context.highlightedText, context.question)}`);
      const { text } = await generateAIText({
        prompt: parts.join('\n\n'),
        system: this.annotationSystemPrompt,
        maxTokens: 4096,
      });
      return text.trim();
    } catch (err) {
      console.warn(`   ⚠️ Gemini 即時回答也失敗（${(err as Error).message}），改用模板版回答`);
      return this.fallback.answerAnnotation(context);
    }
  }

  /** 本篇課文的第一則提問：附上課文全文，建立整個問答會話的共用上下文 */
  private firstAnnotationTurn(
    context: AnnotationContext,
    highlightedText: string,
    question: string,
  ): string {
    return `以下是我正在閱讀的補強課文：

<課文>
# ${context.lesson.title}

${context.lesson.content}
</課文>

我劃線了這一段：「${highlightedText}」

我的問題：${question}`;
  }

  /** 同一篇課文內的追問：只帶劃線段落與問題（課文全文已在對話開頭） */
  private followUpTurn(highlightedText: string, question: string): string {
    return `我又劃線了這一段：「${highlightedText}」

我的問題：${question}`;
  }
}
