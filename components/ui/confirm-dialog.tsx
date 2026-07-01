import { type ReactNode, useState } from 'react';
import { Button } from './button';
import { X, Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
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

  return (
    <div>
      <div onClick={() => setOpen(true)}>{children}</div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-gray-900">{title}</p>
                <p className="mt-2 text-sm text-gray-500">{description}</p>
              </div>
              <button
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {cancelLabel}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  onConfirm();
                  setOpen(false);
                }}
              >
                <Trash2 size={16} />
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
