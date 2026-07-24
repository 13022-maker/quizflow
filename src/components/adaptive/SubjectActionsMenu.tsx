'use client';

import { MoreVertical } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  archiveAdaptiveSubject,
  deleteAdaptiveSubject,
  setAdaptiveSubjectPinned,
  unarchiveAdaptiveSubject,
} from '@/actions/adaptiveActions';
import { RenameSubjectDialog } from '@/components/adaptive/RenameSubjectDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  subject: {
    id: number;
    name: string;
    pinned: boolean;
    archivedAt: Date | null;
  };
};

// 學科管理頁每列右側的「⋯」menu：重新命名、釘選、封存、刪除
export function SubjectActionsMenu({ subject }: Props) {
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [, startTransition] = useTransition();
  const isArchived = subject.archivedAt !== null;

  const handleTogglePin = () => {
    startTransition(async () => {
      await setAdaptiveSubjectPinned(subject.id, !subject.pinned);
    });
  };

  const handleToggleArchive = () => {
    startTransition(async () => {
      if (isArchived) {
        await unarchiveAdaptiveSubject(subject.id);
      } else {
        await archiveAdaptiveSubject(subject.id);
      }
    });
  };

  const handleDelete = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('確定要刪除此學科？此操作無法復原。')) {
      return;
    }
    const res = await deleteAdaptiveSubject(subject.id);
    if (res.error) {
      // eslint-disable-next-line no-alert
      window.alert(res.error);
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
          <DropdownMenuItem onClick={() => setShowRenameDialog(true)}>
            重新命名
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleTogglePin}>
            {subject.pinned ? '取消釘選' : '📌 釘選'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleToggleArchive}>
            {isArchived ? '取消封存' : '封存'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDelete} className="text-red-600 focus:text-red-600">
            刪除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showRenameDialog && (
        <RenameSubjectDialog
          subjectId={subject.id}
          initialName={subject.name}
          onClose={() => setShowRenameDialog(false)}
        />
      )}
    </>
  );
}
