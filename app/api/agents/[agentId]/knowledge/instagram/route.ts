import { createAdminClient } from '@/lib/supabase/admin';
import { processSource } from '@/lib/server/knowledge/processor';

const INSTAGRAM_ERROR_HINT = 'Instagram ограничивает автоматический доступ. Попробуйте скопировать нужный текст вручную через вкладку «Ввод вручную».';

export async function POST(request: Request, { params }: { params: { agentId: string; sourceId?: string } }) {
  try {
    const { username } = await request.json();
    if (!username) {
      return Response.json({ error: 'username required' }, { status: 400 });
    }

    const cleanUsername = String(username).replace('@', '').replace('https://www.instagram.com/', '').replace('/', '');

    const profileRes = await fetch(`https://www.instagram.com/${cleanUsername}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
    });

    if (!profileRes.ok) {
      return Response.json({ error: 'Не удалось загрузить Instagram профиль. Профиль может быть закрытым или недоступным.' }, { status: 400 });
    }

    const html = await profileRes.text();
    const match = html.match(/"biography":"([^"]*)"/);
    const nameMatch = html.match(/"full_name":"([^"]*)"/);
    const followersMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);

    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 15000);

    if (!textContent.trim()) {
      return Response.json({ error: 'Instagram не вернул содержимое профиля. Профиль может быть закрытым или недоступным.' }, { status: 400 });
    }

    const bio = match?.[1] || '';
    const fullName = nameMatch?.[1] || cleanUsername;
    const followers = followersMatch?.[1] || '0';

    const supabase = createAdminClient();
    const title = `Instagram: @${cleanUsername} - ${new Date().toISOString().slice(0, 10)}`;
    const content = `Instagram профиль: ${fullName} (@${cleanUsername})\nПодписчики: ${followers}\nBio: ${bio}\n\nКонтент страницы:\n${textContent}`;

    const { data: source, error: sourceError } = await supabase
      .from('kb_sources')
      .insert({
        agent_id: params.agentId,
        type: 'website',
        title,
        raw_content: content,
        status: 'processing',
        metadata: {
          instagram_username: cleanUsername,
          use_ai: true,
          source_type: 'instagram',
          error_hint: INSTAGRAM_ERROR_HINT,
        },
      })
      .select('id')
      .single();

    if (sourceError || !source) {
      return Response.json({ error: sourceError?.message || 'Не удалось создать источник' }, { status: 500 });
    }

    setImmediate(() => {
      processSource(source.id, params.agentId, true).catch((error) => {
        console.error('[KB] Instagram processing failed:', source.id, error);
      });
    });

    return Response.json({ sourceId: source.id, status: 'processing', username: cleanUsername });
  } catch (e: any) {
    console.error('[KB] Instagram parse failed:', e);
    return Response.json({ error: e.message || 'Неизвестная ошибка' }, { status: 500 });
  }
}
