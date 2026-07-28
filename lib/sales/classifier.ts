export const DialogStage = {
  GREETING: 'greeting',
  DISCOVERY: 'discovery',
  PRESENTATION: 'presentation',
  OBJECTION: 'objection',
  CLOSING: 'closing',
  FOLLOW_UP: 'follow_up',
  OFF_TOPIC: 'off_topic',
} as const;

export type DialogStageValue = (typeof DialogStage)[keyof typeof DialogStage];

export interface ClassificationResult {
  stage: DialogStageValue;
  confidence: number;
  matchedKeywords: string[];
}

interface MessageLike {
  role?: string;
  content?: string | null;
}

type MessageInput = MessageLike | string;

const GREETING_KEYWORDS = ['привет', 'здравствуй', 'hello', 'hi', 'добрый день', 'добрый вечер', 'доброе утро'];
const OBJECTION_KEYWORDS = ['дорого', 'слишком', 'не уверен', 'not sure', 'сомневаюсь', 'давайте подумаем', 'let me think', 'конкурент', 'competitor', 'дешевле', 'cheaper', 'не подходит', 'not suitable', 'объективно'];
const CLOSING_KEYWORDS = ['куплю', 'оформим', 'buy', 'purchase', 'закажу', 'order', 'оплачу', 'pay', 'договорились', 'deal', 'когда доставка', 'when delivery', 'согласен', 'confirm', 'готов', 'go ahead'];
const FOLLOW_UP_KEYWORDS = ['напомните', 'remind', 'перезвоните', 'call back', 'позже', 'later', 'завтра', 'tomorrow', 'через неделю', 'next week', 'вернёмся', 'follow up'];
const PRESENTATION_KEYWORDS = ['покажите', 'show me', 'характеристики', 'specs', 'почему', 'why', 'в чем разница', 'difference', 'преимущества', 'benefits', 'цена', 'стоимость', 'how much', 'сколько стоит'];
const DISCOVERY_KEYWORDS = ['нужно', 'нужна', 'нужен', 'что', 'какой', 'какая', 'какие', 'как', 'помогите', 'подскажите', 'интересует', 'цель', 'задача', 'хочу', 'tell me', 'расскажите', 'do you have', 'есть ли'];
const OFF_TOPIC_KEYWORDS = ['спасибо', 'thank you', 'до свидания', 'bye', 'пока', 'goodbye', 'до встречи'];

function getTextValue(message: MessageInput): string {
  if (typeof message === 'string') {
    return message;
  }
  return message.content ?? '';
}

function findMatches(text: string, keywords: string[]): string[] {
  const normalized = text.toLowerCase();
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
}

/**
 * Classifies the dialog stage from the last 2 messages without calling Gemini.
 * Confidence is reduced by 0.1 for every message beyond the first 4 in history.
 */
export function classifyDialogStage(messages: MessageInput[]): ClassificationResult {
  const recentMessages = messages.slice(-2);
  const combinedText = recentMessages.map(getTextValue).join(' ');

  if (!combinedText.trim()) {
    return { stage: DialogStage.DISCOVERY, confidence: 0.5, matchedKeywords: [] };
  }

  const messageCount = messages.length;
  const historyPenalty = messageCount > 4 ? (messageCount - 4) * 0.1 : 0;

  const greetingMatches = findMatches(combinedText, GREETING_KEYWORDS);
  if (greetingMatches.length > 0 && messageCount <= 3) {
    return { stage: DialogStage.GREETING, confidence: Math.max(0.1, 0.9 - historyPenalty), matchedKeywords: greetingMatches };
  }

  const objectionMatches = findMatches(combinedText, OBJECTION_KEYWORDS);
  if (objectionMatches.length > 0) {
    return { stage: DialogStage.OBJECTION, confidence: Math.max(0.1, 0.85 - historyPenalty), matchedKeywords: objectionMatches };
  }

  const closingMatches = findMatches(combinedText, CLOSING_KEYWORDS);
  if (closingMatches.length > 0) {
    return { stage: DialogStage.CLOSING, confidence: Math.max(0.1, 0.8 - historyPenalty), matchedKeywords: closingMatches };
  }

  const followUpMatches = findMatches(combinedText, FOLLOW_UP_KEYWORDS);
  if (followUpMatches.length > 0) {
    return { stage: DialogStage.FOLLOW_UP, confidence: Math.max(0.1, 0.8 - historyPenalty), matchedKeywords: followUpMatches };
  }

  const presentationMatches = findMatches(combinedText, PRESENTATION_KEYWORDS);
  if (presentationMatches.length > 0) {
    return { stage: DialogStage.PRESENTATION, confidence: Math.max(0.1, 0.7 - historyPenalty), matchedKeywords: presentationMatches };
  }

  const discoveryMatches = findMatches(combinedText, DISCOVERY_KEYWORDS);
  if (discoveryMatches.length > 0) {
    return { stage: DialogStage.DISCOVERY, confidence: Math.max(0.1, 0.75 - historyPenalty), matchedKeywords: discoveryMatches };
  }

  const offTopicMatches = findMatches(combinedText, OFF_TOPIC_KEYWORDS);
  if (offTopicMatches.length > 0) {
    return { stage: DialogStage.OFF_TOPIC, confidence: Math.max(0.1, 0.6 - historyPenalty), matchedKeywords: offTopicMatches };
  }

  return { stage: DialogStage.DISCOVERY, confidence: Math.max(0.1, 0.5 - historyPenalty), matchedKeywords: [] };
}
