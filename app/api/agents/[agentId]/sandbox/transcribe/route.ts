import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/server/require-auth';
import { understandMedia, cleanMimeType } from '@/lib/server/media-understanding';

export const maxDuration = 60;

const MAX_VOICE_BYTES = 10 * 1024 * 1024;

// Расшифровка голосового из песочницы: тот же путь, что у голосовых из WhatsApp/Telegram.
export async function POST(request: NextRequest, { params }: { params: { agentId: string } }) {
  const access = await requireAgentAccess(params.agentId);
  if (!access.ok) return access.response;

  const form = await request.formData().catch(() => null);
  const file = form ? form.get('file') : null;
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Нет аудиофайла' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_VOICE_BYTES) {
    return NextResponse.json({ error: 'Запись пустая или слишком большая (до 10 МБ)' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await understandMedia(buffer, cleanMimeType(file.type, 'audio'), 'audio');
    if (!text) {
      return NextResponse.json({ error: 'Речь не распознана, попробуйте ещё раз' }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (err: any) {
    console.error('[Sandbox] voice transcription failed', err?.message ?? err);
    return NextResponse.json({ error: 'Не удалось расшифровать голосовое' }, { status: 502 });
  }
}
