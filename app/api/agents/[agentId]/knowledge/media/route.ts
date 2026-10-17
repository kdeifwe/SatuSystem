import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/server/require-auth';
import { toMediaFileInfo } from '@/lib/media/available';

// Список медиафайлов агента (фото/видео/PDF) со свежими ссылками для превью в UI.
export async function GET(_request: NextRequest, { params }: { params: { agentId: string } }) {
  const access = await requireAgentAccess(params.agentId);
  if (!access.ok) return access.response;

  const { data, error } = await access.admin
    .from('kb_sources')
    .select('id, title, metadata, file_path, file_size, status, created_at')
    .eq('agent_id', params.agentId)
    .eq('type', 'file')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((row: any) => ({ row, info: toMediaFileInfo(row) })).filter((x) => x.info && x.info.storagePath);

  const files = await Promise.all(
    rows.map(async ({ row, info }) => {
      const { data: signed } = await access.admin.storage.from('kb-files').createSignedUrl(info!.storagePath!, 3600);
      return {
        id: info!.id,
        title: info!.title,
        category: info!.category,
        description: info!.description,
        mime_type: info!.mimeType,
        kind: info!.kind,
        size: row.file_size ?? null,
        status: row.status,
        created_at: row.created_at,
        url: signed?.signedUrl ?? null,
      };
    }),
  );

  return NextResponse.json({ files });
}
