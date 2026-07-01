import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request, { params }: { params: { agentId: string } }) {
  try {
    const { url } = await request.json();

    const docMatch = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    const sheetMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch?.[1] || sheetMatch?.[1];
    const isSheet = !!sheetMatch;

    if (!docId) {
      return Response.json({ error: 'Неверная ссылка. Вставьте ссылку на Google Документ или Таблицу' }, { status: 400 });
    }

    const exportUrl = isSheet
      ? `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv`
      : `https://docs.google.com/document/d/${docId}/export?format=txt`;

    const exportRes = await fetch(exportUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    });

    if (!exportRes.ok) {
      return Response.json({
        error: 'Не удалось получить документ. Убедитесь что документ открыт для всех по ссылке (Настройки доступа → Все у кого есть ссылка)'
      }, { status: 400 });
    }

    const content = await exportRes.text();
    if (!content || content.includes('<!DOCTYPE')) {
      return Response.json({
        error: 'Документ закрыт или недоступен. Откройте доступ: Файл → Поделиться → Все у кого есть ссылка'
      }, { status: 400 });
    }

    const supabase = createAdminClient();
    const type = isSheet ? 'google_sheets' : 'google_docs';
    const title = `${isSheet ? 'Google Таблица' : 'Google Документ'} - ${new Date().toISOString().slice(0,10)}`;

    const { data: source, error: sourceError } = await supabase
      .from('kb_sources')
      .insert({
        agent_id: params.agentId,
        type,
        title,
        raw_content: content.slice(0, 50000),
        status: 'processing',
        metadata: { doc_id: docId, original_url: url, use_ai: true, is_sheet: isSheet },
      })
      .select('id')
      .single();

    if (sourceError || !source) {
      return Response.json({ error: sourceError?.message || 'Не удалось создать источник' }, { status: 500 });
    }

    setImmediate(() => {
      import('@/lib/server/knowledge/processor')
        .then(({ processSource }) => processSource(source.id, params.agentId, true).catch(console.error))
        .catch(console.error);
    });

    return Response.json({ sourceId: source.id, status: 'processing', type });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
