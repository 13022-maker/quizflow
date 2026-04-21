import Link from 'next/link';
import { Fragment } from 'react';

import type { BlogBlock } from '@/data/blog';

/**
 * 文章 body 渲染器：將結構化 blocks 轉成 HTML。
 * 段落文字支援簡易 **bold** 與 [text](url) 語法。
 */
function renderInline(text: string) {
  // 切出 **bold** 與 [link](url)
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern).filter(Boolean);
  return parts.map((part, i) => {
    if (/^\*\*(.+)\*\*$/.test(part)) {
      return <strong key={i}>{part.replace(/^\*\*|\*\*$/g, '')}</strong>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <Link key={i} href={linkMatch[2]!} className="text-primary underline hover:opacity-80">
          {linkMatch[1]}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function PostBody({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h2':
            return (
              <h2 key={i} className="mt-10 text-2xl font-bold tracking-tight">
                {block.text}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={i} className="mt-6 text-xl font-semibold">
                {block.text}
              </h3>
            );
          case 'p':
            return (
              <p key={i} className="mt-4 leading-7 text-foreground/90">
                {renderInline(block.text)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="mt-4 list-disc space-y-2 pl-6 text-foreground/90">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="mt-4 list-decimal space-y-2 pl-6 text-foreground/90">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote
                key={i}
                className="mt-6 border-l-4 border-primary/40 bg-muted/40 px-4 py-3 text-foreground/80"
              >
                <p className="italic">{renderInline(block.text)}</p>
                {block.cite && (
                  <cite className="mt-2 block text-sm not-italic text-muted-foreground">
                    —
                    {' '}
                    {block.cite}
                  </cite>
                )}
              </blockquote>
            );
          case 'cta':
            return (
              <aside
                key={i}
                className="mt-10 rounded-2xl border border-primary/20 bg-primary/5 p-6"
              >
                <h3 className="text-lg font-bold text-foreground">{block.title}</h3>
                <p className="mt-2 text-sm text-foreground/80">{block.description}</p>
                <Link
                  href={block.href}
                  className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                >
                  {block.label}
                  {' '}
                  →
                </Link>
              </aside>
            );
          case 'faq':
            return (
              <section key={i} className="mt-8 space-y-4">
                {block.items.map((qa, j) => (
                  <div key={j} className="rounded-lg border bg-card p-4">
                    <p className="font-semibold">
                      Q:
                      {qa.q}
                    </p>
                    <p className="mt-2 text-sm text-foreground/80">
                      A:
                      {qa.a}
                    </p>
                  </div>
                ))}
              </section>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
