import dotenv from 'dotenv';
import { createAdminClient } from './lib/supabase/admin.ts';

dotenv.config({ path: '.env.local' });

async function main() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agents')
    .select('id,name,system_prompt_compiled')
    .eq('id', '9b7cf5df-9055-4a14-a77c-e006a4454f5d')
    .single();

  if (error) {
    console.error('ERROR', error);
    process.exit(1);
  }

  console.log(JSON.stringify({ id: data?.id, name: data?.name, len: data?.system_prompt_compiled?.length }, null, 2));

  if (typeof data?.system_prompt_compiled === 'string') {
    const s = data.system_prompt_compiled;
    const patterns = [
      'Escalate when the client explicitly asks for a human',
      'Некоторые знания уже включены напрямую в блок CORE_KNOWLEDGE выше',
      '**searchKnowledgeBase** — Выполняет семантический поиск по базе знаний компании',
      '1. searchKnowledgeBase — вызывай перед любым утверждением о фактах компании',
      '**redirectToOperator** — Передаёт диалог живому оператору',
      'Триггеры: the client directly asked for a human or an operator',
      'Обязательно вызови инструмент searchKnowledgeBase для поиска реальных кейсов и цифр в базе знаний',
      'Эскалировать запрос на человека-эксперта, если информация требует глубокой интерпретации',
      'Никогда не использовать фразу "Я не знаю"',
      'Если ответ не найден',
      'переключить на специалиста',
      'специалиста',
      'CORE_KNOWLEDGE (эти факты ты знаешь всегда, без необходимости искать):',
    ];
    for (const p of patterns) {
      const idx = s.indexOf(p);
      console.log('PATTERN:', p, 'idx=', idx);
      if (idx !== -1) {
        console.log('EXCERPT:', JSON.stringify(s.slice(idx, idx + 420)));
      }
    }

    const missingText = 'Если ответ не найден, предлагать найти информацию или переключить на специалиста.';
    const missingIdx = s.indexOf(missingText);
    if (missingIdx !== -1) {
      console.log('RAW AROUND missing:', s.slice(missingIdx - 80, missingIdx + 180));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
