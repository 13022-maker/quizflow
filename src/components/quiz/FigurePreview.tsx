import { needsFigure } from '@/lib/figureReference';

type PreviewQuestion = {
  question: string;
  imageUrl?: string;
  diagramSvg?: string;
};

type Props = {
  questions: PreviewQuestion[];
  /** 老師覺得截錯圖時移除該題附圖（之後可在編輯器手動上傳） */
  onRemoveImage?: (index: number) => void;
};

/**
 * AI 從檔案出題完成後、匯入前的附圖預覽：
 * - 自動從原始檔截圖的題目：顯示縮圖，讓老師先確認截得對不對
 * - 題目提到「如圖」卻沒有附圖（AI 沒標位置或截圖失敗）：列題號警告
 */
export function FigurePreview({ questions, onRemoveImage }: Props) {
  const withImage = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => Boolean(q.imageUrl));
  const missing = questions
    .map((q, i) => (typeof q.question === 'string'
      && needsFigure({ body: q.question, imageUrl: q.imageUrl, diagramSvg: q.diagramSvg })
      ? i + 1
      : 0))
    .filter(n => n > 0);

  if (withImage.length === 0 && missing.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {withImage.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          <p className="mb-2 font-bold">
            🖼️ 已從原始檔自動截取
            {' '}
            {withImage.length}
            {' '}
            張題目附圖，請確認圖片是否正確：
          </p>
          <ul className="space-y-2">
            {withImage.map(({ q, i }) => (
              <li key={i} className="flex gap-3 rounded-lg border border-blue-100 bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={q.imageUrl}
                  alt={`第 ${i + 1} 題附圖`}
                  className="h-24 w-32 shrink-0 rounded border border-gray-100 object-contain"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-700">
                    第
                    {' '}
                    {i + 1}
                    {' '}
                    題
                  </p>
                  <p className="line-clamp-3 text-gray-600">{q.question}</p>
                  {onRemoveImage && (
                    <button
                      type="button"
                      onClick={() => onRemoveImage(i)}
                      className="mt-1 text-red-500 underline hover:text-red-700"
                    >
                      截錯了，移除這張圖
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          ⚠️ 第
          {' '}
          {missing.join('、')}
          {' '}
          題提到「圖／表」，但沒有附上圖片，學生作答時看不到。建議按「重新命題」，或匯入後在編輯器上傳題目圖片。
        </div>
      )}
    </div>
  );
}
