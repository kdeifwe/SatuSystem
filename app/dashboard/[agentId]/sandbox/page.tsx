'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, RotateCcw, Send, Paperclip, Mic, X, ThumbsDown, Copy, Instagram } from 'lucide-react';

interface RetrievalDebugChunk {
  id: string;
  content: string;
  similarity: number;
  priority?: string;
  linkType?: string;
  sourceTitle?: string;
  sourceType?: string;
  postType?: string;
}

interface RetrievalDebug {
  primaryChunks: RetrievalDebugChunk[];
  linkedChunks: RetrievalDebugChunk[];
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  pending?: boolean;
  retrievalDebug?: RetrievalDebug;
}

export default function SandboxPage({ params }: { params: { agentId: string } }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentName, setAgentName] = useState('Агент');
  const [dislikedMessage, setDislikedMessage] = useState<string | null>(null);
  const [showDislikeModal, setShowDislikeModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/agents/${params.agentId}/info`)
      .then((response) => response.json())
      .then((data) => {
        if (data.name) {
          setAgentName(data.name);
        }
      })
      .catch(() => {});
  }, [params.agentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    const nextMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage, timestamp: new Date() },
    ];
    const assistantIndex = nextMessages.length;
    setMessages(nextMessages);
    setMessages([...nextMessages, { role: 'assistant', content: '', timestamp: new Date(), pending: true }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: params.agentId,
          message: userMessage,
          history: messages.map((message) => ({
            role: message.role === 'user' ? 'user' : 'model',
            text: message.content,
          })),
          systemPrompt: '',
        }),
      });

      const raw = await response.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: raw || 'Ошибка' };
      }

      const answer = data.answer ?? data.error ?? 'Ошибка';
      const retrievalDebug = data.retrievalDebug ?? null;
      const parts = Array.isArray(data.messageParts) && data.messageParts.length
        ? data.messageParts
        : [{ text: answer, delayMs: 0 }];

      console.log('[Sandbox] splitMessages:', data.splitMessages);
      console.log('[Sandbox] messageParts count:', data.messageParts?.length);
      console.log('[Sandbox] messageParts:', data.messageParts);

      if (parts.length > 1 && data.splitMessages) {
        setMessages((current) => current.slice(0, assistantIndex));
        for (const [index, part] of parts.entries()) {
          if (index > 0) {
            await new Promise((resolve) => setTimeout(resolve, part.delayMs));
          }
          setMessages((current) => [
            ...current,
            { role: 'assistant', content: part.text, timestamp: new Date(), pending: false, retrievalDebug: index === parts.length - 1 ? retrievalDebug : undefined },
          ]);
        }
      } else {
        setMessages((current) =>
          current.map((message, messageIndex) =>
            messageIndex === assistantIndex
              ? { ...message, content: answer, pending: false, retrievalDebug }
              : message,
          ),
        );
      }

      if (data.handoffMessage) {
        setMessages((current) => [
          ...current,
          { role: 'system', content: data.handoffMessage, timestamp: new Date() },
        ]);
      }
    } catch {
      setMessages((current) =>
        current.map((message, messageIndex) =>
          messageIndex === assistantIndex ? { ...message, content: 'Ошибка соединения', pending: false } : message,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
  }

  function formatMessageTime(date: Date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function handleDislike(messageContent: string) {
    setDislikedMessage(messageContent);
    setShowDislikeModal(true);
  }

  function handleDislikeReason(reason: string) {
    if (!dislikedMessage) return;
    const feedback = `Агент ответил: ${dislikedMessage}. Проблема: ${reason}. Исправь это.`;
    window.location.href = `/dashboard/${params.agentId}/improve?feedback=${encodeURIComponent(feedback)}`;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Тестирование</h1>
          <p className="text-xs text-gray-500">Общайтесь с вашим ИИ-агентом</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearChat}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="Очистить чат"
          >
            <RotateCcw size={16} />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" title="История">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">
                  {agentName[0]}
                </div>
              </div>
              <p className="text-sm text-gray-600">Добрый день, {agentName}</p>
              <p className="mt-1 text-xs text-gray-400">Начните диалог, чтобы протестировать агента</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((message, index) => {
              if (message.role === 'system' && message.content.toLowerCase().includes('передан оператору')) {
                return (
                  <div key={`${message.role}-${index}`} className="flex items-center justify-center">
                    <div className="w-full max-w-[80%] rounded-full border border-dashed border-gray-300 bg-white px-4 py-2 text-center text-xs font-medium text-gray-500">
                      ─────────────────────────────────
                      <br />
                      🔄 Разговор передан оператору · {agentName} · {formatMessageTime(message.timestamp)}
                      <br />
                      ─────────────────────────────────
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`${message.role}-${index}`}
                  className={`group flex flex-col items-${message.role === 'user' ? 'end' : 'start'}`}
                >
                  {message.role === 'assistant' ? (
                    <div className="flex items-center gap-1 mb-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <button
                        onClick={() => handleDislike(message.content)}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                        title="Плохой ответ"
                      >
                        <ThumbsDown size={13} />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                        title="Скопировать"
                        onClick={() => navigator.clipboard.writeText(message.content)}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  ) : null}
                  <div
                    className={`${message.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : message.role === 'system' ? 'bg-transparent px-0 py-0 text-gray-500' : 'bg-gray-100 text-gray-800 rounded-bl-sm'} max-w-[75%] px-4 py-3 rounded-2xl text-sm`}
                  >
                    {message.content}
                    {message.role === 'assistant' && message.retrievalDebug ? (
                      <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 text-xs">
                        <div>
                          <div className="mb-1 font-semibold text-blue-600">Найдено по запросу</div>
                          <div className="space-y-1">
                            {message.retrievalDebug.primaryChunks.length === 0 ? (
                              <div className="text-gray-500">Нет основных чанков</div>
                            ) : message.retrievalDebug.primaryChunks.map((chunk) => (
                              <div key={chunk.id} className="rounded-lg bg-white/70 p-2">
                                <div className="flex items-center gap-2 font-medium text-gray-700">
                                  {chunk.sourceType === 'instagram' ? <Instagram size={13} className="text-pink-500" /> : null}
                                  <span>{chunk.sourceTitle || 'Источник'}</span>
                                </div>
                                <div className="line-clamp-3 text-gray-600">{chunk.content}</div>
                                <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">
                                  {Math.round(chunk.similarity * 100)}% · {chunk.priority || 'chunk'}
                                  {chunk.sourceType === 'instagram' ? ' · instagram' : ''}
                                  {chunk.postType ? ` · ${chunk.postType}` : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 font-semibold text-amber-600">Подтянуто по связи</div>
                          <div className="space-y-1">
                            {message.retrievalDebug.linkedChunks.length === 0 ? (
                              <div className="text-gray-500">Нет связанных чанков</div>
                            ) : message.retrievalDebug.linkedChunks.map((chunk) => (
                              <div key={chunk.id} className="rounded-lg border border-amber-200 bg-amber-50/70 p-2">
                                <div className="flex items-center gap-2 font-medium text-gray-700">
                                  {chunk.sourceType === 'instagram' ? <Instagram size={13} className="text-pink-500" /> : null}
                                  <span>{chunk.sourceTitle || 'Связанный источник'}</span>
                                </div>
                                <div className="line-clamp-3 text-gray-600">{chunk.content}</div>
                                <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">
                                  {chunk.linkType || 'linked'} · {Math.round(chunk.similarity * 100)}% · {chunk.priority || 'chunk'}
                                  {chunk.sourceType === 'instagram' ? ' · instagram' : ''}
                                  {chunk.postType ? ` · ${chunk.postType}` : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {isLoading ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-end gap-3">
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Напишите сообщение..."
              rows={1}
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 pr-12 text-sm focus:border-blue-300 focus:outline-none"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 text-gray-400">
              <Paperclip size={16} />
              <Mic size={16} />
            </div>
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-gray-400">
          Нажмите Enter для отправки · Shift+Enter для новой строки
        </p>
      </div>

      {showDislikeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Что именно не так с этим ответом?</h2>
                <p className="mt-1 text-sm text-gray-500">Выберите причину, и я помогу исправить агента.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDislikeModal(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 grid gap-3">
              {[
                'Неправильная информация',
                'Слишком формально / неформально',
                'Не по теме',
                'Другое',
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => handleDislikeReason(reason)}
                  className="rounded-2xl border border-gray-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
