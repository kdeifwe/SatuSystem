export function buildTelegramExternalMessageId(channelId: string | number, messageId: string | number) {
  return `tg_${channelId}_${messageId}`;
}

export function buildTelegramAiExternalMessageId(
  channelId: string | number,
  messageId: string | number,
  partIndex: number,
) {
  return `tg_ai_${channelId}_${messageId}_${partIndex}`;
}
