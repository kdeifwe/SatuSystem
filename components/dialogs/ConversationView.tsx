'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { MessageSquare, Paperclip, Mic, Send, MoreHorizontal, Loader2 } from 'lucide-react';
import MessageBubble from './MessageBubble';
import AvatarInitial from './AvatarInitial';

export type ConversationViewProps = {
  conversationId?: string;
  leadId?: string | null;
  leadName?: string | null;
  leadStatus?: string | null;
  leadAiEnabled?: boolean | null;
  toggleAiEnabled?: (leadId: string, current: boolean) => Promise<void>;
};

type MessageItem = {
  id: string;
  sender: 'user' | 'ai' | 'operator' | 'system';
  content: string;
  tool_calls?: unknown;
  created_at: string;
};

function statusBadge(status?: string | null) {
  switch (status) {
    case 'new':
      return 'bg-blue-50 text-blue-600';
    case 'in_progress':
      return 'bg-amber-50 text-amber-600';
    case 'done':
      return 'bg-emerald-50 text-emerald-600';
    case 'rejected':
      return 'bg-red-50 text-red-600';
    default:
      return 'bg-gray-100 text-gray-500';
  }
}

export default function ConversationView({
  conversationId,
  leadId,
  leadName,
  leadStatus,
  leadAiEnabled,
  toggleAiEnabled,
}: ConversationViewProps) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(Boolean(leadAiEnabled));
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAiEnabled(Boolean(leadAiEnabled));
  }, [leadAiEnabled]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    fetch(`/api/dialogs/${conversationId}/messages`)
      .then((response) => response.json())
      .then((data) => {
        if (!isMounted) return;
        setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => setMessages([]))
      .finally(() => setIsLoading(false));

    return () => {
      isMounted = false;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase.channel(`messages:${conversationId}`);

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as MessageItem;
          setMessages((current) => {
            if (current.some((message) => message.id === newMessage.id)) {
              return current;
            }
            return [...current, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [draft, conversationId]);

  const formattedLeadName = leadName || 'Выберите переписку';

  const statusClass = statusBadge(leadStatus);
  const aiLabel = aiEnabled ? 'ИИ вкл' : 'ИИ выкл';
  const aiTextClass = aiEnabled ? 'text-[#1557FF]' : 'text-gray-400';

  const canSend = Boolean(draft.trim()) && Boolean(conversationId) && !isSending;

  const handleSend = async () => {
    if (!canSend || !conversationId) return;

    const content = draft.trim();
    setIsSending(true);
    setSendError(null);

    try {
      const response = await fetch(`/api/dialogs/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? 'Не удалось отправить сообщение');
      }

      setDraft('');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Не удалось отправить сообщение');
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleAi = async () => {
    if (!leadId || !toggleAiEnabled) return;
    setAiEnabled((current) => !current);
    try {
      await toggleAiEnabled(leadId, aiEnabled);
    } catch {
      setAiEnabled((current) => !current);
    }
  };

  const groupedMessages = useMemo(() => {
    const groups: Record<string, MessageItem[]> = {};

    for (const message of messages) {
      const date = new Date(message.created_at);
      const label = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
      groups[label] = groups[label] || [];
      groups[label].push(message);
    }

    return Object.entries(groups).map(([label, items]) => ({ label, items }));
  }, [messages]);

  if (!conversationId) {
    return (
      <div className="flex h-full flex-1 flex-col">
        <div className="flex h-full flex-1 items-center justify-center text-center px-6">
          <div className="flex flex-col items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-200">
              <MessageSquare size={48} />
            </div>
            <p className="mt-3 max-w-xs text-sm text-gray-400">
              Выберите переписку, чтобы увидеть историю сообщений
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex h-14 items-center justify-between border-b border-gray-200 px-6">
        <div className="flex items-center">
          <AvatarInitial name={leadName || undefined} />
          <div className="ml-3 flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900">{formattedLeadName}</p>
            {leadStatus ? (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
                {leadStatus}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleAi}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-gray-100"
          >
            <span className={`text-xs ${aiTextClass}`}>{aiLabel}</span>
            <div className={`h-5 w-10 rounded-full ${aiEnabled ? 'bg-[#1557FF]' : 'bg-gray-200'}`}>
              <div
                className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  aiEnabled ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </div>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                <button type="button" className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                  Изменить статус
                </button>
                <button type="button" className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                  Назначить
                </button>
                <button type="button" className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                  Заблокировать
                </button>
                <button type="button" className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                  Экспортировать
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50/30">
        {isLoading ? (
          <div className="text-sm text-gray-500">Загрузка...</div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-3 my-4">
                <hr className="flex-1 border-gray-200" />
                <span className="text-xs text-gray-400 flex-shrink-0">{group.label}</span>
                <hr className="flex-1 border-gray-200" />
              </div>
              {group.items.map((message) => (
                <MessageBubble
                  key={message.id}
                  sender={message.sender}
                  content={message.content}
                  createdAt={message.created_at}
                />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-end gap-3">
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100">
            <Paperclip size={18} />
          </button>
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={draft}
              disabled={isSending}
              onChange={(event) => setDraft(event.target.value)}
              onInput={() => {
                if (!textareaRef.current) return;
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Написать сообщение..."
              className="min-h-[40px] max-h-[120px] w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:border-blue-300"
            />
          </div>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1557FF] text-white hover:bg-[#0E3FC9] disabled:opacity-40" onClick={handleSend} disabled={!canSend}>
            {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <Mic size={18} />
          </button>
        </div>
        {sendError ? <p className="mt-2 text-sm text-red-600">{sendError}</p> : null}
      </div>
    </div>
  );
}
