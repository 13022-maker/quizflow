'use client';

import { MoreVertical } from 'lucide-react';
import { useState } from 'react';

import { deleteVocabSet } from '@/actions/vocabActions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PublishVocabDialog } from '@/components/vocab/PublishVocabDialog';

type Props = {
  set: {
    id: number;
    accessCode: string | null;
    visibility: 'private' | 'public';
    category: string | null;
    gradeLevel: string | null;
  };
};

// 列表頁卡片右上的「⋯」menu：上架/下架、複製連結、刪除
export function VocabActionsMenu({ set }: Props) {
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const isPublic = set.visibility === 'public';

  // 複製學生公開練習頁網址到剪貼簿
  const handleCopyLink = async () => {
    if (!set.accessCode) {
      // eslint-disable-next-line no-alert
      window.alert('此單字卡集尚未產生公開連結');
      return;
    }
    const url = `${window.location.origin}/vocab/${set.accessCode}`;
    try {
      await navigator.clipboard.writeText(url);
      // eslint-disable-next-line no-alert
      window.alert('已複製連結');
    } catch {
      // eslint-disable-next-line no-alert
      window.alert(url);
    }
  };

  const handleDelete = async () => {
    // eslint-disable-next-line no-alert
    if (window.confirm('確定要刪除此單字卡集？')) {
      await deleteVocabSet(set.id);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="更多操作"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <MoreVertical size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setShowPublishDialog(true)}>
            {isPublic ? '管理市集上架' : '上架到題庫市集'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyLink}>
            複製公開連結
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDelete} className="text-red-600 focus:text-red-600">
            刪除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showPublishDialog && (
        <PublishVocabDialog
          setId={set.id}
          isPublic={isPublic}
          initialCategory={set.category}
          initialGradeLevel={set.gradeLevel}
          onClose={() => setShowPublishDialog(false)}
        />
      )}
    </>
  );
}
