'use client';

import { useState, useEffect, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, Globe, MessageSquare, Plus, ArrowRight, Loader, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  addTextSource,
  addQASource,
  addWebsiteSource,
  addFileSource,
} from './actions';

interface Source {
  id: string;
  title: string;
  type: 'file' | 'text' | 'website' | 'qa';
  status: 'pending' | 'processing' | 'done' | 'error';
  file_size?: number;
  error_message?: string;
}

type Scenario = 'sales' | 'consultant' | 'support';

type Currency = 'KZT' | 'USD' | 'EUR' | 'RUB';
type Timezone = 'Asia/Almaty' | 'Europe/Moscow' | 'UTC';

type Tone = 'Формальный' | 'Дружелюбный' | 'Нейтральный';

type AddressForm = 'Адаптивное' | 'На "вы"' | 'На "ты"';

const currencies: Currency[] = ['KZT', 'USD', 'EUR', 'RUB'];
const timezones: Timezone[] = ['Asia/Almaty', 'Europe/Moscow', 'UTC'];
const tones: Tone[] = ['Формальный', 'Дружелюбный', 'Нейтральный'];
const addressForms: AddressForm[] = ['Адаптивное', 'На "вы"', 'На "ты"'];

export default function CreateAgentPage() {
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [promptStepIndex, setPromptStepIndex] = useState(0);

  const [agentName, setAgentName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
  const [agentGoal, setAgentGoal] = useState('');
  const [strengths, setStrengths] = useState('');
  const [currency, setCurrency] = useState<Currency>('KZT');
  const [timezone, setTimezone] = useState<Timezone>('Asia/Almaty');
  const [toneOfVoice, setToneOfVoice] = useState<Tone>('Формальный');
  const [addressForm, setAddressForm] = useState<AddressForm>('Адаптивное');

  const [sources, setSources] = useState<Source[]>([]);
  const [showSourceForm, setShowSourceForm] = useState<'file' | 'text' | 'website' | 'qa' | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error' | null>(null);

  const scenarioLabels: Record<Scenario, string> = {
    sales: 'ИИ-продажник',
    consultant: 'Консультант',
    support: 'Поддержка',
  };

  const processingSteps = ['Чтение документов', 'Извлечение информации', 'Анализ контента', 'Подготовка конфигурации'];
  const promptAnalysisSteps = ['Анализирую ваш бизнес', 'Изучаю психологию продаж', 'Создаю идеальный скрипт', 'Финализирую детали'];

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, init);
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
    }
  };

  useEffect(() => {
    if (agentId) return;

    const createTempAgent = async () => {
      setIsCreatingAgent(true);
      try {
        const data = await fetchJson<{ agentId?: string; error?: string }>('/api/agents/create', { method: 'POST' });
        if (!data.agentId) {
          throw new Error(data.error || 'Не удалось создать агент');
        }

        setAgentId(data.agentId);
      } catch (error) {
        console.error('Temp agent creation failed:', error);
      } finally {
        setIsCreatingAgent(false);
      }
    };

    createTempAgent();
  }, [agentId]);

  const refreshSources = async () => {
    if (!agentId) return [] as Source[];

    try {
      const data = await fetchJson<{ sources?: Source[] }>(`/api/kb/sources?agentId=${agentId}`);
      if (Array.isArray(data.sources)) {
        setSources(data.sources);
        return data.sources as Source[];
      }
    } catch (error) {
      console.error('Failed to refresh sources:', error);
    }

    return [] as Source[];
  };

  const handleStep1Next = async () => {
    if (!agentId) {
      alert('Агент создаётся, подождите');
      return;
    }

    setProcessing(true);
    setProcessingStep('Ожидаем завершения обработки источников...');

    try {
      const latestSources = await refreshSources();

      if (latestSources.length > 0) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const refreshed = await refreshSources();
          const hasActive = refreshed.some((source) => source.status === 'pending' || source.status === 'processing');

          if (!hasActive) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }

      setIsAutoFilling(true);
      setStatusMessage('AI анализирует материалы...');
      setStatusType(null);

      const data = await fetchJson<{ companyDescription?: string; goal?: string; advantages?: string; error?: string }>(`/api/agents/${agentId}/auto-fill`, { method: 'POST' });

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.companyDescription || data.goal || data.advantages) {
        setCompanyDescription(data.companyDescription || '');
        setAgentGoal(data.goal || '');
        setStrengths(data.advantages || '');
        setStatusMessage('AI заполнил поля шага 2. Вы можете их поправить.');
        setStatusType('success');
      } else {
        setStatusMessage('Источники обработаны, но AI не нашёл достаточно данных для автозаполнения.');
        setStatusType('error');
      }

      setCurrentStep(2);
    } catch (error) {
      console.error('Auto-fill failed:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Не удалось проанализировать материалы');
      setStatusType('error');
    } finally {
      setProcessing(false);
      setProcessingStep('');
      setIsAutoFilling(false);
    }
  };

  const handleAddTextSource = async () => {
    if (!agentId || !sourceText.trim()) return;

    try {
      await addTextSource(agentId, 'Текст', sourceText);
      setSources((prev) => [
        ...prev,
        { id: Math.random().toString(), title: 'Текст', type: 'text', status: 'pending' },
      ]);
      setSourceText('');
      setShowSourceForm(null);
    } catch (error) {
      console.error('Error adding text source:', error);
      alert(error instanceof Error ? error.message : 'Не удалось добавить текст');
    }
  };

  const handleAddQASource = async () => {
    if (!agentId || !qaQuestion.trim() || !qaAnswer.trim()) return;

    try {
      await addQASource(agentId, qaQuestion, qaAnswer);
      setSources((prev) => [
        ...prev,
        { id: Math.random().toString(), title: qaQuestion, type: 'qa', status: 'pending' },
      ]);
      setQaQuestion('');
      setQaAnswer('');
      setShowSourceForm(null);
    } catch (error) {
      console.error('Error adding QA source:', error);
      alert(error instanceof Error ? error.message : 'Не удалось добавить Q&A');
    }
  };

  const handleAddWebsiteSource = async () => {
    if (!agentId || !websiteUrl.trim()) return;

    try {
      await addWebsiteSource(agentId, websiteUrl);
      setSources((prev) => [
        ...prev,
        { id: Math.random().toString(), title: websiteUrl, type: 'website', status: 'pending' },
      ]);
      setWebsiteUrl('');
      setShowSourceForm(null);
    } catch (error) {
      console.error('Error adding website source:', error);
      alert(error instanceof Error ? error.message : 'Не удалось добавить сайт');
    }
  };

  const handleAddFileSource = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!agentId || !file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      await addFileSource(agentId, formData);
      setSources((prev) => [
        ...prev,
        { id: Math.random().toString(), title: file.name, type: 'file', status: 'pending', file_size: file.size },
      ]);
      setShowSourceForm(null);
    } catch (error) {
      console.error('Error adding file source:', error);
      alert(error instanceof Error ? error.message : 'Не удалось загрузить файл');
    }
  };

  const handleGeneratePrompt = async () => {
    if (!agentId) {
      setStatusMessage('Агент не создан. Сначала создайте временного агента.');
      setStatusType('error');
      return;
    }

    if (!agentName.trim()) {
      setStatusMessage('Введите имя агента перед генерацией.');
      setStatusType('error');
      return;
    }

    setIsGeneratingPrompt(true);
    setPromptStepIndex(0);

    const request = fetchJson<{ success?: boolean; error?: string }>(`/api/agents/${agentId}/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName,
        companyName,
        companyDescription,
        goal: agentGoal,
        advantages: strengths,
        currency,
        timezone,
        writingStyle: toneOfVoice,
        addressStyle: addressForm,
      }),
    });

    try {
      for (let i = 0; i < promptAnalysisSteps.length; i += 1) {
        setPromptStepIndex(i);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const data = await request;
      if (!data.success) {
        throw new Error(data.error || 'Не удалось сгенерировать промт');
      }

      setStatusMessage('Системный промт успешно сгенерирован.');
      setStatusType('success');
      setCurrentStep(3);
    } catch (error) {
      console.error('Generate prompt failed:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Произошла ошибка при генерации промта');
      setStatusType('error');
    } finally {
      setIsGeneratingPrompt(false);
      setPromptStepIndex(0);
    }
  };

  const getStatusIcon = (status: Source['status']) => {
    switch (status) {
      case 'pending':
        return <span className="text-yellow-500">⏳</span>;
      case 'processing':
        return <span className="animate-spin">🔄</span>;
      case 'done':
        return <span className="text-green-500">✅</span>;
      case 'error':
        return <span className="text-red-500">❌</span>;
      default:
        return null;
    }
  };

  const renderStatusMessage = () => {
    if (!statusMessage || !statusType) return null;

    return (
      <div className={`rounded-lg border px-4 py-3 mb-4 ${statusType === 'success' ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
        {statusMessage}
      </div>
    );
  };

  const renderStepper = () => (
    <div className="mb-10 flex items-center justify-between gap-4">
      {[1, 2, 3].map((step) => {
        const isActive = currentStep === step;
        const isCompleted = step < currentStep;

        return (
          <div key={step} className="flex items-center gap-4 flex-1">
            <div className="relative">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full ${isCompleted ? 'bg-green-600 text-white' : isActive ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'}`}>
                {isCompleted ? <Check size={20} /> : step}
              </div>
              {step < 3 && (
                <div className={`absolute right-[-50%] top-1/2 h-1 w-[120%] ${step < currentStep ? 'bg-green-600' : 'bg-gray-300'}`} />
              )}
            </div>
            <div className="min-w-[70px] text-xs font-semibold uppercase text-gray-500">
              {step === 1 ? 'Источники' : step === 2 ? 'Настройка' : 'Готово'}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <main className="container mx-auto px-4 py-10">
      <div className="mx-auto max-w-6xl">
        {renderStatusMessage()}
        {renderStepper()}

        {currentStep === 2 && (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-8">
              <h1 className="mb-6 text-3xl font-bold">Настройка агента</h1>
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Имя агента</label>
                  <input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="например, Айгерим"
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Название компании</label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Ваша компания"
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">О вашей компании</label>
                  <textarea
                    value={companyDescription}
                    onChange={(e) => setCompanyDescription(e.target.value)}
                    placeholder="Кратко опишите, чем занимается ваша компания..."
                    rows={4}
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Основная цель</label>
                  <input
                    value={agentGoal}
                    onChange={(e) => setAgentGoal(e.target.value)}
                    placeholder="например, Забронировать демо"
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Ключевые преимущества</label>
                  <textarea
                    value={strengths}
                    onChange={(e) => setStrengths(e.target.value)}
                    placeholder="Перечислите 2-3 основных преимущества..."
                    rows={3}
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Валюта</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as Currency)}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    >
                      {currencies.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Часовой пояс</label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value as Timezone)}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    >
                      {timezones.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Стиль письма</label>
                    <select
                      value={toneOfVoice}
                      onChange={(e) => setToneOfVoice(e.target.value as Tone)}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    >
                      {tones.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Обращение</label>
                    <select
                      value={addressForm}
                      onChange={(e) => setAddressForm(e.target.value as AddressForm)}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    >
                      {addressForms.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Button
                    className="rounded-3xl bg-[#111] px-7 py-3 font-semibold text-white shadow-xl shadow-black/10 hover:bg-black"
                    onClick={handleGeneratePrompt}
                    disabled={isGeneratingPrompt}
                  >
                    {isGeneratingPrompt ? 'Генерирую промпт...' : 'Создать агента'}
                    <ArrowRight size={18} className="ml-2" />
                  </Button>
                </div>
                {isGeneratingPrompt && (
                  <div className="mt-4 rounded-3xl bg-blue-50 p-4 text-blue-900">
                    <div className="font-semibold">{promptAnalysisSteps[promptStepIndex]}</div>
                  </div>
                )}
              </div>
            </Card>

            <div className="rounded-[2rem] bg-gradient-to-br from-pink-500 via-orange-300 to-pink-500 p-1 shadow-2xl shadow-pink-200/40">
              <div className="rounded-[1.8rem] bg-white p-6">
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
                    {agentName?.[0]?.toUpperCase() || 'A'}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{agentName || 'Имя агента'}</div>
                    <div className="text-sm text-gray-500">{companyName || 'Название компании'}</div>
                  </div>
                </div>

                <div className="mt-8 space-y-5">
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">Моя цель</div>
                    <div className="mt-2 rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800 min-h-[80px]">
                      {agentGoal || 'Опишите цель агента...'}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">О вашей компании</div>
                    <div className="mt-2 rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800 min-h-[80px]">
                      {companyDescription || 'Кратко опишите, чем занимается ваша компания...'}
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex items-center justify-between rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <span>{timezone}</span>
                  <span>{currency}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="p-6">
              <h3 className="mb-4 text-lg font-bold">Добавить источник</h3>

              <div className="space-y-3">
                <button
                  onClick={() => setShowSourceForm(showSourceForm === 'file' ? null : 'file')}
                  className="flex w-full items-center gap-3 rounded-3xl border border-gray-300 px-4 py-3 text-left transition hover:border-blue-600"
                >
                  <Upload size={20} />
                  <span className="flex-1">Файл</span>
                  <Plus size={18} />
                </button>
                <button
                  onClick={() => setShowSourceForm(showSourceForm === 'text' ? null : 'text')}
                  className="flex w-full items-center gap-3 rounded-3xl border border-gray-300 px-4 py-3 text-left transition hover:border-blue-600"
                >
                  <FileText size={20} />
                  <span className="flex-1">Текст</span>
                  <Plus size={18} />
                </button>
                <button
                  onClick={() => setShowSourceForm(showSourceForm === 'website' ? null : 'website')}
                  className="flex w-full items-center gap-3 rounded-3xl border border-gray-300 px-4 py-3 text-left transition hover:border-blue-600"
                >
                  <Globe size={20} />
                  <span className="flex-1">Веб-сайт</span>
                  <Plus size={18} />
                </button>
                <button
                  onClick={() => setShowSourceForm(showSourceForm === 'qa' ? null : 'qa')}
                  className="flex w-full items-center gap-3 rounded-3xl border border-gray-300 px-4 py-3 text-left transition hover:border-blue-600"
                >
                  <MessageSquare size={20} />
                  <span className="flex-1">Вопрос-ответ</span>
                  <Plus size={18} />
                </button>
              </div>

              <div className="mt-6 space-y-4">
                {showSourceForm === 'file' && (
                  <div>
                    <input type="file" onChange={handleAddFileSource} accept=".pdf,.docx,.txt,.md" />
                  </div>
                )}

                {showSourceForm === 'text' && (
                  <div className="space-y-3">
                    <textarea
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Введите текст..."
                      rows={5}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                    <Button variant="primary" onClick={handleAddTextSource}>
                      Добавить
                    </Button>
                  </div>
                )}

                {showSourceForm === 'website' && (
                  <div className="space-y-3">
                    <input
                      type="url"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                    <Button variant="primary" onClick={handleAddWebsiteSource}>
                      Добавить
                    </Button>
                  </div>
                )}

                {showSourceForm === 'qa' && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={qaQuestion}
                      onChange={(e) => setQaQuestion(e.target.value)}
                      placeholder="Вопрос"
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                    <textarea
                      value={qaAnswer}
                      onChange={(e) => setQaAnswer(e.target.value)}
                      placeholder="Ответ"
                      rows={4}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                    <Button variant="primary" onClick={handleAddQASource}>
                      Добавить
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="mb-4 text-lg font-bold">Источники обучения ({sources.length})</h3>
              <div className="space-y-3 max-h-[30rem] overflow-y-auto pr-1">
                {sources.length === 0 ? (
                  <p className="text-sm text-gray-500">Пока источников нет</p>
                ) : (
                  sources.map((source) => (
                    <div key={source.id} className="flex items-center gap-3 rounded-3xl border border-gray-200 p-4">
                      {getStatusIcon(source.status)}
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900">{source.title}</p>
                        {source.file_size && <p className="text-xs text-gray-500">{(source.file_size / 1024).toFixed(1)} KB</p>}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {processing && (
                <div className="mt-6 rounded-3xl bg-blue-50 p-4 text-blue-900">
                  <div className="mb-3 flex items-center gap-2 font-semibold">
                    <Loader className="animate-spin" size={18} />
                    {processingStep}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200">
                    <div className="h-full w-1/2 animate-pulse bg-blue-600" />
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  ← Назад
                </Button>
                <Button
                  variant="primary"
                  onClick={handleStep1Next}
                  disabled={!agentId || isCreatingAgent || isAutoFilling || processing}
                  className="bg-[#111] text-white hover:bg-black"
                >
                  {isCreatingAgent ? 'Создаю агента...' : isAutoFilling ? 'AI анализирует материалы...' : 'Проанализировать и продолжить'}
                  <ArrowRight size={18} className="ml-2" />
                </Button>
              </div>

              {isAutoFilling && (
                <div className="mt-4 flex items-center gap-2 rounded-3xl bg-amber-50 p-4 text-amber-900">
                  <Loader className="animate-spin" size={18} />
                  AI анализирует материалы...
                </div>
              )}
            </Card>
          </div>
        )}

        {currentStep === 3 && (
          <Card className="p-8 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
              <Check size={36} />
            </div>
            <h2 className="mb-4 text-3xl font-bold">Готово!</h2>
            <p className="mb-2 text-gray-600">Агент <strong>{agentName}</strong> успешно создан.</p>
            <p className="mb-6 text-gray-600">Обработано источников: <strong>{sources.length}</strong></p>
            <Button
              variant="primary"
              className="bg-[#111] text-white hover:bg-black"
              onClick={() => router.push(`/dashboard/${agentId}/knowledge`)}
            >
              Перейти к агенту <ArrowRight size={18} className="ml-2" />
            </Button>
          </Card>
        )}
      </div>
    </main>
  );
}
