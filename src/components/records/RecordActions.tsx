'use client';

import { Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted';

/**
 * Edit / Archive(Restore) / Delete controls for a record detail page. Archive
 * and delete are pre-bound server actions; omit them to hide the control.
 */
export function RecordActions({
  editHref,
  isActive,
  archiveAction,
  deleteAction,
  labels,
}: {
  editHref?: string;
  isActive?: boolean;
  archiveAction?: () => Promise<void>;
  deleteAction?: () => Promise<void>;
  labels: { edit: string; archive: string; restore: string; delete: string; confirm: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {editHref ? (
        <Link href={editHref} className={btn}>
          <Pencil className="size-3.5" />
          {labels.edit}
        </Link>
      ) : null}

      {archiveAction && isActive !== undefined ? (
        <form action={archiveAction}>
          <button type="submit" className={btn}>
            {isActive ? <Archive className="size-3.5" /> : <ArchiveRestore className="size-3.5" />}
            {isActive ? labels.archive : labels.restore}
          </button>
        </form>
      ) : null}

      {deleteAction ? (
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (!confirm(labels.confirm)) e.preventDefault();
          }}
        >
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-soft"
          >
            <Trash2 className="size-3.5" />
            {labels.delete}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** Inline confirm-then-submit button for a single bound action (e.g. delete a
 * scheduled price row). */
export function ConfirmButton({ action, label, confirm }: { action: () => Promise<void>; label: string; confirm: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm || !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button type="submit" className="text-xs font-medium text-danger hover:underline">
        {label}
      </button>
    </form>
  );
}
