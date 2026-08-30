"use client";

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Mic, Paperclip, Send } from 'lucide-react';
import { getLeadToAutoOpen } from './lead-auto-selection';

interface Lead {
  id: string;
  name: string;
  status: string;
  external_id: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  channel_type?: string;
  ai_enabled?: boolean;
  conversation_id?: string;
}

interface MessageItem {
  id: string;
  sender: string;
  content: string;
  created_at: string;
  pending?: boolean;
}

export default function DialogsPage({ params }: { params: { agentId: string } }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [updatingAi, setUpdatingAi] = useState(false);
  const searchParams = useSearchParams();
  const leadIdFromUrl = searchParams.get('leadId');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedLeadIdRef = useRef<string | null>(null);
  const autoOpenedLeadIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId;
  }, [selectedLeadId]);

  useEffect(() => {
    if (!params.agentId) {
      setError('Ошибка: ID агента не найден');
      setLoading(false);
      return;
    }

    loadLeads();
    const interval = setInterval(loadLeads, 5000);
    return () => clearInterval(interval);
  }, [params.agentId, leadIdFromUrl]);

  useEffect(() => {
    const leadId = searchParams.get('leadId');
    if (!leadId || leads.length === 0) return;

    const leadExists = leads.some((item) => item.id === leadId);
    if (leadExists) {
      setSelectedLeadId(leadId);
      void loadMessages(leadId);
    }
  }, [searchParams, leads]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const nextHeight = Math.min(120, Math.max(40, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedLeadId]);

  async function loadLeads() {
    try {
      const res = await fetch(`/api/agents/${params.agentId}/leads`);
      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data?.error ?? `Ошибка ${res.status}: ${res.statusText}`;
        setError(errorMsg);
        setLeads([]);
        return;
      }

      const nextLeads = data.leads ?? [];
      setError(null);
      setLeads(nextLeads);

      const shouldAutoOpenLead = getLeadToAutoOpen({
        leadIdFromUrl,
        selectedLeadId: selectedLeadIdRef.current,
        leads: nextLeads,
        autoOpenedLeadId: autoOpenedLeadIdRef.current,
      });

      if (shouldAutoOpenLead) {
        autoOpenedLeadIdRef.current = shouldAutoOpenLead;
        void loadMessages(shouldAutoOpenLead, nextLeads);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      setError(`Ошибка загрузки: ${errorMsg}`);
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(leadId: string, availableLeads: Lead[] = leads) {
    const lead = availableLeads.find((item) => item.id === leadId);
    setSelectedLeadId(leadId);
    setInput('');
    setMessages([]);

    if (!lead?.conversation_id) {
      return;
    }

    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/dialogs/${lead.conversation_id}/messages`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = await res.json();
      setMessages((data ?? []).map((message: any) => ({
        id: message.id,
        sender: message.sender,
        content: message.content,
        created_at: message.created_at,
      })));
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleSend() {
    const lead = leads.find((item) => item.id === selectedLeadId);
    if (!lead?.conversation_id || !input.trim() || isSending) return;

    const content = input.trim();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((current) => [
      ...current,
      { id: tempId, sender: 'operator', content, created_at: new Date().toISOString(), pending: true },
    ]);
    setInput('');
    setIsSending(true);

    try {
      const res = await fetch(`/api/dialogs/${lead.conversation_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, operatorMode: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось отправить сообщение');
      }

      const message = data?.message ?? data;
      setMessages((current) => current.map((item) => (item.id === tempId ? {
        ...item,
        id: message?.id ?? item.id,
        created_at: message?.created_at ?? item.created_at,
        pending: false,
      } : item)));
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== tempId));
      alert(error instanceof Error ? error.message : 'Не удалось отправить сообщение');
    } finally {
      setIsSending(false);
    }
  }

  async function toggleAiEnabled() {
    const lead = leads.find((item) => item.id === selectedLeadId);
    if (!lead || updatingAi) return;

    setUpdatingAi(true);
    try {
      const res = await fetch(`/api/agents/${params.agentId}/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_enabled: !lead.ai_enabled }),
      });

      if (!res.ok) return;
      setLeads((current) => current.map((item) => (item.id === lead.id ? { ...item, ai_enabled: !item.ai_enabled } : item)));
    } finally {
      setUpdatingAi(false);
    }
  }

  const selectedLead = leads.find((item) => item.id === selectedLeadId);

  return (
    <div className="flex h-full overflow-hidden bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]">
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)]">
        <div className="border-b border-[color:var(--color-graphite)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--color-chalk)]">Диалоги</h2>
              <p className="text-xs text-[color:var(--color-smoke)]">{leads.length} контактов</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-center text-xs text-[color:var(--color-smoke)]">Загрузка...</div>}
          {!loading && error && (
            <div className="border-b border-red-100 p-4">
              <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-3">
                <p className="text-xs font-medium text-[color:var(--color-chalk)]">Ошибка загрузки диалогов</p>
                <p className="mt-1 text-xs text-[color:var(--color-smoke)]">{error}</p>
                <button
                  type="button"
                  onClick={loadLeads}
                  className="mt-2 w-full rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-1.5 text-xs text-[color:var(--color-chalk)] transition-colors hover:border-[color:var(--color-ash)]"
                >
                  Повторить
                </button>
              </div>
            </div>
          )}
          {!loading && !error && leads.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-[color:var(--color-smoke)]">Диалогов пока нет</p>
              <p className="mt-1 text-xs text-[color:var(--color-smoke)]">Подключите канал и напишите боту</p>
            </div>
          )}
          {leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => loadMessages(lead.id)}
              className={`w-full border-b border-[color:var(--color-graphite)] px-4 py-3 text-left transition-colors ${
                selectedLeadId === lead.id ? 'border-l-2 border-l-[color:var(--color-chalk)] bg-[color:var(--color-obsidian)]' : 'bg-[color:var(--color-carbon)] hover:bg-[color:var(--color-obsidian)]'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate text-sm font-medium text-[color:var(--color-chalk)]">{lead.name}</span>
                <span className="ml-2 flex-shrink-0 text-[10px] text-[color:var(--color-smoke)]">
                  {formatDistanceToNow(new Date(lead.updated_at ?? lead.created_at), { locale: ru, addSuffix: true })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
                  lead.status === 'new' ? 'bg-[color:var(--color-pulse-green)]' : lead.status === 'in_progress' ? 'bg-[color:var(--color-compass-gold)]' : lead.status === 'done' ? 'bg-[color:var(--color-pulse-green)]' : 'bg-[color:var(--color-iron)]'
                }`} />
                <span className="truncate text-xs text-[color:var(--color-smoke)]">{lead.last_message ?? 'Нет сообщений'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedLeadId ? (
          <div className="flex flex-1 items-center justify-center text-[color:var(--color-smoke)]">
            <div className="text-center">
              <p className="text-sm">Выберите диалог</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-14 items-center justify-between border-b border-[color:var(--color-graphite)] px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] text-sm font-semibold text-[color:var(--color-chalk)]">
                  {selectedLead?.name?.[0] ?? '?'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[color:var(--color-chalk)]">{selectedLead?.name}</p>
                    <span className={`rounded-full border border-[color:var(--color-graphite)] px-2 py-0.5 text-[10px] font-medium ${
                      selectedLead?.status === 'new' ? 'bg-[color:var(--color-carbon)] text-[color:var(--color-chalk)]' :
                      selectedLead?.status === 'in_progress' ? 'bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]' :
                      selectedLead?.status === 'done' ? 'bg-[color:var(--color-carbon)] text-[color:var(--color-pulse-green)]' : 'bg-[color:var(--color-carbon)] text-[color:var(--color-smoke)]'
                    }`}>
                      {selectedLead?.status === 'new' ? 'new' : selectedLead?.status === 'in_progress' ? 'in progress' : selectedLead?.status === 'done' ? 'done' : selectedLead?.status}
                    </span>
                  </div>
                  <p className="text-xs text-[color:var(--color-smoke)]">{selectedLead?.external_id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleAiEnabled}
                disabled={updatingAi}
                className="flex items-center gap-2 text-sm text-[color:var(--color-smoke)]"
              >
                <span className="text-xs text-[color:var(--color-smoke)]">{selectedLead?.ai_enabled ? 'ИИ вкл' : 'ИИ выкл'}</span>
                <span className={`relative inline-flex h-6 w-11 items-center rounded-full border border-[color:var(--color-graphite)] transition-colors ${selectedLead?.ai_enabled ? 'bg-[color:var(--color-pulse-green)]' : 'bg-[color:var(--color-graphite)]'}`}>
                  <span className={`inline-block h-5 w-5 rounded-full bg-[color:var(--color-chalk)] transition-transform ${selectedLead?.ai_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loadingMessages ? (
                <div className="text-center text-sm text-[color:var(--color-smoke)]">Загрузка сообщений...</div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[75%] rounded-2xl border border-[color:var(--color-graphite)] px-4 py-2.5 text-sm ${
                        message.sender === 'user'
                          ? 'bg-[color:var(--color-carbon)] text-[color:var(--color-chalk)] rounded-bl-sm'
                          : message.sender === 'ai'
                            ? 'bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)] rounded-br-sm'
                            : 'rounded-br-sm bg-[color:var(--color-graphite)] text-[color:var(--color-chalk)]'
                      }`}>
                        {message.sender === 'operator' && <p className="mb-1 text-[10px] text-[color:var(--color-smoke)]">Оператор</p>}
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        <p className={`mt-1 text-[10px] ${message.sender === 'user' ? 'text-gray-400' : 'text-white/70'}`}>
                          {new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="border-t border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-4 py-3">
              <div className="flex items-end gap-3">
                <button
                  type="button"
                  title="Скоро"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"
                >
                  <Paperclip size={16} />
                </button>
                <div className="flex-1">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Введите сообщение..."
                    rows={1}
                    className="w-full resize-none rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-4 py-2.5 text-sm text-[color:var(--color-chalk)] focus:border-[color:var(--color-ash)] focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-[color:var(--color-smoke)]">Нажмите Enter для отправки · Shift+Enter для новой строки</p>
                </div>
                <button
                  type="button"
                  title="Скоро"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"
                >
                  <Mic size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || isSending}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)] transition-colors hover:bg-[color:var(--color-chalk)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

