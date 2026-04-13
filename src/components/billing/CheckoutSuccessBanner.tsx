'use client';

/**
 * 結帳成功提示 banner
 * 當 URL 帶 ?checkout=success 時顯示（Paddle checkout 完成後 redirect 回來）
 */

import { useSearchParams } from 'next/navigation';

export function CheckoutSuccessBanner() {
  const searchParams = useSearchParams();
  const isSuccess = searchParams.get('checkout') === 'success';

  if (!isSuccess) {
    return null;
  }

  return (
    <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
      🎉 訂閱成功！你現在可以使用所有 Pro 功能了。
    </div>
  );
}
