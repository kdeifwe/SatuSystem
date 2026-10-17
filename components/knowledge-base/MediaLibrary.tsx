'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Film, Trash2, UploadCloud, Loader2 } from 'lucide-react';
import MEDIA_CATEGORIES from '@/lib/media/categories';
import { MEDIA_ACCEPT_ATTR, validateMediaFile, type MediaKind } from '@/lib/media/files';

type MediaItem = {
  id: string;
  title: string;
  category: string;
  description: string;
  mime_type: string;
  kind: MediaKind | null;
  size: number | null;
  status: string;
  url: string | null;
};

const AUTO = 'auto';
const AUTO_CATEGORY: Record<MediaKind, string> = {
  image: 'product_photo',
  video: 'video_demo',
  document: 'other',
};

// Фото с телефона 4–8 МБ не проходят в лимит тела запроса на многих хостингах и тяжело уходят в мессенджеры.
// Сжимаем до 1600px / JPEG 0.85. GIF и маленькие файлы не трогаем.
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function MediaCard({
  item,
  agentId,
  onChanged,
}: {
  item: MediaItem;
  agentId: string;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description);
    setCategory(item.category);
  }, [item.title, item.description, item.category]);

  const patch = async (body: Record<string, string>) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/agents/${agentId}/knowledge/media/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить «${item.title}»? Агент больше не сможет отправлять этот файл.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/knowledge/sources/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось удалить');
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
      <div className="relative h-40 bg-gray-100 flex items-center justify-center">
        {item.kind === 'image' && item.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        ) : item.kind === 'video' && item.url ? (
          <video src={item.url} className="h-full w-full object-cover" preload="metadata" muted playsInline />
        ) : item.kind === 'video' ? (
          <Film size={32} className="text-gray-400" />
        ) : (
          <FileText size={32} className="text-gray-400" />
        )}
        <button
          type="button"
          onClick={remove}
          disabled={saving}
          title="Удалить"
          className="absolute top-2 right-2 rounded-lg bg-white/90 p-1.5 text-gray-600 shadow hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 size={14} />
        </button>
        {item.size ? (
          <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{formatSize(item.size)}</span>
        ) : null}
      </div>

      <div className="p-3 space-y-2 flex-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== item.title && patch({ title: title.trim() })}
          maxLength={120}
          className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Название"
        />
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            patch({ category: e.target.value });
          }}
          className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {MEDIA_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description.trim() !== item.description && patch({ description: description.trim() })}
          maxLength={500}
          rows={2}
          className="w-full resize-none rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Что на фото? Например: «Диван Милан, серый велюр, 3-местный»"
        />
        {saving && <p className="text-[11px] text-gray-400">Сохранение…</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default function MediaLibrary({ agentId }: { agentId: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>(AUTO);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    try {
      const res = await fetch(`/api/agents/${agentId}/knowledge/media`);
      const data = await res.json();
      if (res.ok) setItems(data.files || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0 || uploading) return;

    setErrors([]);
    setUploading({ done: 0, total: files.length });
    const problems: string[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const original = files[i];
      const check = validateMediaFile(original);
      if (!check.ok) {
        problems.push(check.error);
        setUploading({ done: i + 1, total: files.length });
        continue;
      }

      try {
        const file = await compressImage(original);
        const form = new FormData();
        form.append('file', file);
        form.append('media_category', category === AUTO ? AUTO_CATEGORY[check.kind] : category);
        form.append('title', original.name.replace(/\.[^.]+$/, ''));
        if (description.trim()) form.append('media_description', description.trim());
        form.append('useAI', 'true');

        const res = await fetch(`/api/agents/${agentId}/knowledge/sources`, { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const tooLarge = res.status === 413;
          throw new Error(tooLarge ? 'Файл слишком большой для сервера' : data.error || 'Ошибка загрузки');
        }
      } catch (e) {
        problems.push(`«${original.name}»: ${(e as Error).message}`);
      }
      setUploading({ done: i + 1, total: files.length });
    }

    setErrors(problems);
    setUploading(null);
    if (problems.length < files.length) setDescription('');
    if (inputRef.current) inputRef.current.value = '';
    load();
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Фото и файлы для клиентов</h2>
        <p className="text-sm text-gray-500">
          Загрузите фото товаров, прайсы, каталоги или видео — агент сам отправит нужный файл клиенту в WhatsApp или Telegram,
          когда тот попросит или когда это поможет продать. Агент выбирает файл по названию и описанию, поэтому опишите, что на нём.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr] mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Категория для загружаемых файлов</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={AUTO}>Автоматически (фото → «Фото товара», видео → «Видео-демо»)</option>
            {MEDIA_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Описание (необязательно, можно изменить позже)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="Например: Диван Милан, серый велюр"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          uploadFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={MEDIA_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
        {uploading ? (
          <>
            <Loader2 size={22} className="animate-spin text-gray-500" />
            <p className="text-sm text-gray-600">
              Загрузка {Math.min(uploading.done + 1, uploading.total)} из {uploading.total}…
            </p>
          </>
        ) : (
          <>
            <UploadCloud size={22} className="text-gray-400" />
            <p className="text-sm text-gray-600">Перетащите фото сюда или нажмите, чтобы выбрать (можно несколько)</p>
            <p className="text-xs text-gray-400">JPG, PNG, WEBP, GIF до 10 МБ · MP4 до 16 МБ · PDF до 20 МБ</p>
          </>
        )}
      </label>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-red-50 p-3 text-xs text-red-700">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        {loading ? (
          <p className="text-sm text-gray-400">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400">Пока нет файлов. Загрузите первое фото — и агент сможет отправлять его клиентам.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <MediaCard key={item.id} item={item} agentId={agentId} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Отправка файлов работает в WhatsApp и Telegram. В Instagram агент ответит текстом.
      </p>
    </div>
  );
}
