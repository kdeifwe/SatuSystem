import { type ReactNode, useState } from 'react';
import { Button } from './button';
import { Card } from './card';
import { X, Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Удалить',
  cancelLabel = 'Отмена',
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  const handleConfirm = async () => {
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Keep the dialog open if the action fails.
    }
  };

  return (
    <div>
      <div onClick={() => setOpen(true)}>{children}</div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <Card className="w-full max-w-md border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-[color:var(--color-chalk)]">{title}</p>
                <p className="mt-2 text-sm text-[color:var(--color-smoke)]">{description}</p>
              </div>
              <button
                className="rounded-full p-2 text-[color:var(--color-smoke)] hover:bg-[color:var(--color-graphite)]"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {cancelLabel}
              </Button>
              <Button variant="danger" onClick={handleConfirm}>
                <Trash2 size={16} />
                {confirmLabel}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
