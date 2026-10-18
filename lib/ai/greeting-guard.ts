/**
 * Жёсткая защита от повторного приветствия.
 * Модель может игнорировать инструкцию «не здоровайся», поэтому, если в диалоге
 * агент уже отвечал, приветствие в начале ответа убираем кодом.
 */

export const ALREADY_GREETED_NOTE =
  'ВАЖНО: диалог уже начат, ты уже поздоровался с клиентом. НЕ здоровайся повторно ' +
  '(никаких «Здравствуйте», «Привет», «Добрый день», «Рада вас приветствовать» и т.п.). ' +
  'Сразу отвечай по сути на последние сообщения клиента.';

const GREETING_WORDS =
  '(?:здравствуйте|здравствуй|здраствуйте|добрый\\s+день|добрый\\s+вечер|доброе\\s+утро|доброй\\s+ночи|' +
  'привет(?:ствую)?|салам(?:алейкум)?|ассаламу\\s+алейкум|сәлем(?:етсіз\\s+бе)?|hello|hi|hey)' +
  // слово должно закончиться: иначе «History» → «story», «Приветственная» → «ственная»
  '(?![\\p{L}\\p{N}_])';

// «Здравствуйте, Айгерим!» (имя необязательно, но только если за ним знак препинания)
const GREETING_WITH_NAME = new RegExp(
  `^\\s*${GREETING_WORDS}[\\s,]+[\\p{L}_.\\-]+\\s*[!.,;:—-]+\\s*`,
  'iu'
);
// «Здравствуйте!» / «Добрый день,»
const GREETING_ONLY = new RegExp(`^\\s*${GREETING_WORDS}\\s*[!.,;:—-]*\\s*`, 'iu');
// «Рада вас приветствовать в bibi_massage.» / «Рады видеть вас!»
const WELCOME_SENTENCE =
  /^\s*рад[аы]?\s+(?:вас\s+)?(?:приветствовать|видеть)[^.!?\n]*[.!?]*\s*/iu;

function capitalizeFirst(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function stripLeadingGreeting(text: string): string {
  if (typeof text !== 'string' || !text.trim()) return text;

  let result = text;
  let changed = false;

  for (let i = 0; i < 4; i += 1) {
    const before = result;
    const withName = result.replace(GREETING_WITH_NAME, '');
    if (withName !== result && withName.trim().length > 0) {
      result = withName;
    } else {
      result = result.replace(GREETING_ONLY, '').replace(WELCOME_SENTENCE, '');
    }
    if (result === before) break;
    changed = true;
  }

  result = result.trim();
  // Если кроме приветствия ничего не было, лучше отправить оригинал, чем молчать
  if (!changed || result.length === 0) return text;
  return capitalizeFirst(result);
}

export function hasAssistantReplied(messages: Array<{ role?: string }> | null | undefined): boolean {
  return Array.isArray(messages) && messages.some((m) => m?.role && m.role !== 'user');
}
