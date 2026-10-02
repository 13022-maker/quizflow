'use client';

// 命題結果預覽：列出 AI 自動附加教材圖片的題目縮圖，讓老師匯入前先確認圖有沒有配對對
type Props = {
  questions: { imageUrl?: string }[];
};

export function MaterialImageThumbs({ questions }: Props) {
  const withImages = questions
    .map((q, i) => ({ url: q.imageUrl, no: i + 1 }))
    .filter((x): x is { url: string; no: number } => Boolean(x.url));

  if (withImages.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs text-green-700">
        🖼️ 已自動附加教材圖片（
        {withImages.length}
        {' '}
        題）
      </p>
      <div className="flex flex-wrap gap-2">
        {withImages.map(({ url, no }) => (
          <figure key={no} className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`第 ${no} 題附圖`}
              className="max-h-24 max-w-32 rounded border border-gray-200 bg-white object-contain"
            />
            <figcaption className="mt-0.5 text-[11px] text-gray-500">
              第
              {' '}
              {no}
              {' '}
              題
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
