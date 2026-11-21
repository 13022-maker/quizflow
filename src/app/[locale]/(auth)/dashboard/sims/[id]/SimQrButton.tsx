'use client';

/** 顯示學生連結 QR Code（上課投影讓學生掃） */
import { useState } from 'react';
import QRCode from 'react-qr-code';

import { SimModal } from './SimModal';

export function SimQrButton({ path, title }: { path: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setUrl(`${window.location.origin}${path}`)}
        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        ▦ QR Code
      </button>
      {url && (
        <SimModal title={<h3 className="font-semibold">{title}</h3>} onClose={() => setUrl(null)} maxWidth="max-w-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-lg bg-white p-4">
              <QRCode value={url} size={220} />
            </div>
            <code className="break-all rounded bg-muted px-2 py-1 text-center text-xs">{url}</code>
          </div>
        </SimModal>
      )}
    </>
  );
}
