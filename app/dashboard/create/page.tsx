'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, ChevronDown, ChevronUp, FileText, Globe, Loader, MessageSquare, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { addFileSource, addQASource, addTextSource, addWebsiteSource } from './actions';

interface Source {
  id: string;
  title: string;
  type: 'file' | 'text' | 'website' | 'qa';
  status: 'pending' | 'processing' | 'done' | 'error';
  file_size?: number;
  error_message?: string;
}

interface FunnelStep {
  id: string;
  title: string;
  triggerDescription: string;
  sampleMessage: string;
  order: number;
}

interface WizardState {
  business: {
    scenario: Scenario;
    targetAudience: string;
    firstQuestion: string;
    commonObjections: string[];
  };
  funnel: {
    steps: FunnelStep[];
  };
  behavior: {
    handoffEnabled: boolean;
    handoffTriggersText: string;
    handoffClientMessage: string;
    neverSayPhrasesText: string;
    allowedTools: string[];
    responseDelayMs: number;
    followUpEnabled: boolean;
    splitLongMessages: boolean;
  };
  advanced: {
    model: Model;
    temperature: number;
    topP: number;
  };
}

type Scenario = 'sales' | 'consultant' | 'support';
type Model = 'gemini-3.5-flash' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
type Currency = 'KZT' | 'USD' | 'EUR' | 'RUB';
type Timezone = 'Asia/Almaty' | 'Europe/Moscow' | 'UTC';
type Tone = 'Формальный' | 'Дружелюбный' | 'Нейтральный';
type AddressForm = 'Адаптивное' | 'На "вы"' | 'На "ты"';

const currencies: Currency[] = ['KZT', 'USD', 'EUR', 'RUB'];
const timezones: Timezone[] = ['Asia/Almaty', 'Europe/Moscow', 'UTC'];
const tones: Tone[] = ['Формальный', 'Дружелюбный', 'Нейтральный'];
const addressForms: AddressForm[] = ['Адаптивное', 'На "вы"', 'На "ты"'];
const INLINE_KB_WARNING_THRESHOLD = 18000;

const toolOptions = [
  { value: 'searchKnowledgeBase', label: 'Поиск по базе знаний' },
  { value: 'redirectToOperator', label: 'Перенаправить оператору' },
  { value: 'advanceFunnelStep', label: 'Перейти к следующему шагу' },
  { value: 'getCurrentDate', label: 'Узнать текущую дату' },
  { value: 'add_lead_note', label: 'Добавить заметку' },
  { value: 'update_lead_info', label: 'Обновить данные лида' },
] as const;

const toolLabels: Record<string, string> = Object.fromEntries(toolOptions.map((tool) => [tool.value, tool.label]));

const initialWizardState = (): WizardState => ({
  business: {
    scenario: 'sales' as Scenario,
    targetAudience: '',
    firstQuestion: '',
    commonObjections: [],
  },
  funnel: {
    steps: [],
  },
  behavior: {
    handoffEnabled: true,
    handoffTriggersText: '',
    handoffClientMessage: 'Сейчас подключу специалиста',
    neverSayPhrasesText: '',
    allowedTools: toolOptions.map((tool) => tool.value),
    responseDelayMs: 600,
    followUpEnabled: true,
    splitLongMessages: true,
  },
  advanced: {
    model: 'gemini-2.5-flash' as Model,
    temperature: 0.4,
    topP: 0.9,
  },
});

export default function CreateAgentPage() {
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingFunnel, setIsGeneratingFunnel] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [promptStepIndex, setPromptStepIndex] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [objectionInput, setObjectionInput] = useState('');

  const [agentName, setAgentName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
  const [agentGoal, setAgentGoal] = useState('');
  const [strengths, setStrengths] = useState('');
  const [currency, setCurrency] = useState<Currency>('KZT');
  const [timezone, setTimezone] = useState<Timezone>('Asia/Almaty');
  const [toneOfVoice, setToneOfVoice] = useState<Tone>('Формальный');
  const [addressForm, setAddressForm] = useState<AddressForm>('Адаптивное');
  const [wizardState, setWizardState] = useState<WizardState>(initialWizardState);

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
  const [textInlineInPrompt, setTextInlineInPrompt] = useState(false);
  const [qaInlineInPrompt, setQaInlineInPrompt] = useState(false);
  const [step2ValidationError, setStep2ValidationError] = useState('');

  const scenarioLabels: Record<Scenario, string> = {
    sales: 'ИИ-продажник',
    consultant: 'Консультант',
    support: 'Поддержка',
  };

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

  const updateBusiness = (patch: Partial<WizardState['business']>) => {
    setWizardState((prev) => ({
      ...prev,
      business: {
        ...prev.business,
        ...patch,
      },
    }));
  };

  const updateBehavior = (patch: Partial<WizardState['behavior']>) => {
    setWizardState((prev) => ({
      ...prev,
      behavior: {
        ...prev.behavior,
        ...patch,
      },
    }));
  };

  const updateAdvanced = (patch: Partial<WizardState['advanced']>) => {
    setWizardState((prev) => ({
      ...prev,
      advanced: {
        ...prev.advanced,
        ...patch,
      },
    }));
  };

  const addObjection = () => {
    const value = objectionInput.trim();
    if (!value) return;

    setWizardState((prev) => ({
      ...prev,
      business: {
        ...prev.business,
        commonObjections: [...prev.business.commonObjections, value],
      },
    }));
    setObjectionInput('');
  };

  const removeObjection = (value: string) => {
    setWizardState((prev) => ({
      ...prev,
      business: {
        ...prev.business,
        commonObjections: prev.business.commonObjections.filter((item) => item !== value),
      },
    }));
  };

  const toggleTool = (toolValue: string) => {
    setWizardState((prev) => {
      const allowedTools = prev.behavior.allowedTools.includes(toolValue)
        ? prev.behavior.allowedTools.filter((item) => item !== toolValue)
        : [...prev.behavior.allowedTools, toolValue];

      return {
        ...prev,
        behavior: {
          ...prev.behavior,
          allowedTools,
        },
      };
    });
  };

  const getDefaultFunnelSteps = (): FunnelStep[] => [
    {
      id: 'contact',
      title: 'Контакт и первое понимание',
      triggerDescription: 'После первого сообщения и когда клиент проявил интерес',
      sampleMessage: `Здравствуйте! Я помогу вам быстро разобраться в вашем запросе. ${wizardState.business.firstQuestion || 'Какой у вас сейчас главный вопрос?'}`,
      order: 1,
    },
    {
      id: 'need',
      title: 'Понимание потребности',
      triggerDescription: 'Когда клиент описал задачу или проблему',
      sampleMessage: `Скажите, что для вас сейчас важнее: ${agentGoal || 'получить полезный результат'} или быстрее понять следующий шаг?`,
      order: 2,
    },
    {
      id: 'proposal',
      title: 'Предложение решения',
      triggerDescription: 'Когда клиент готов к следующему шагу',
      sampleMessage: 'Подберу для вас самое подходящее решение и покажу следующий шаг без лишней нагрузки.',
      order: 3,
    },
    {
      id: 'close',
      title: 'Закрытие и следующий шаг',
      triggerDescription: 'Когда клиент согласился перейти к действию',
      sampleMessage: 'Давайте зафиксируем следующий шаг и подготовим всё самое важное для вас.',
      order: 4,
    },
  ];

  const handleGenerateFunnel = async () => {
    if (!agentId) return;

    setIsGeneratingFunnel(true);

    try {
      const data = await fetchJson<Array<Partial<FunnelStep>>>(`/api/agents/${agentId}/generate-funnel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: wizardState.business.scenario,
          goal: agentGoal,
          targetAudience: wizardState.business.targetAudience,
          firstQuestion: wizardState.business.firstQuestion,
          commonObjections: wizardState.business.commonObjections,
          companyDescription,
        }),
      });

      if (Array.isArray(data) && data.length > 0) {
        const steps = data
          .slice(0, 6)
          .map((step, index) => ({
            id: step.id || `stage-${index + 1}`,
            title: step.title || `Этап ${index + 1}`,
            triggerDescription: step.triggerDescription || 'Когда клиент готов перейти дальше',
            sampleMessage: step.sampleMessage || 'Подскажите следующий шаг',
            order: index + 1,
          })) as FunnelStep[];

        setWizardState((prev) => ({
          ...prev,
          funnel: { steps },
        }));
      } else {
        throw new Error('Empty funnel response');
      }
    } catch (error) {
      console.error('Generate funnel failed:', error);
      setWizardState((prev) => ({
        ...prev,
        funnel: { steps: getDefaultFunnelSteps() },
      }));
    } finally {
      setIsGeneratingFunnel(false);
    }
  };

  const moveFunnelStep = (index: number, direction: -1 | 1) => {
    setWizardState((prev) => {
      const nextSteps = [...prev.funnel.steps];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= nextSteps.length) return prev;

      const [movedItem] = nextSteps.splice(index, 1);
      nextSteps.splice(targetIndex, 0, movedItem);

      return {
        ...prev,
        funnel: {
          steps: nextSteps.map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })),
        },
      };
    });
  };

  const updateFunnelStep = (index: number, key: keyof FunnelStep, value: string) => {
    setWizardState((prev) => ({
      ...prev,
      funnel: {
        steps: prev.funnel.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, [key]: value } : step)),
      },
    }));
  };

  const getVoiceSample = () => {
    const base = toneOfVoice === 'Дружелюбный'
      ? 'Здравствуйте! Я помогу вам быстро разобраться и подскажу следующий шаг.'
      : toneOfVoice === 'Нейтральный'
        ? 'Здравствуйте! Я помогу вам структурировать вопрос и предложу практичный следующий шаг.'
        : 'Здравствуйте! Я помогу вам разобраться в вопросе и предложу точный следующий шаг.';

    if (addressForm === 'На "ты"') {
      return `${base} Буду говорить напрямую и по делу.`;
    }

    if (addressForm === 'На "вы"') {
      return `${base} Буду обращаться уважительно и мягко.`;
    }

    return `${base} Буду держать лёгкий и адаптивный стиль.`;
  };

  const buildWizardPayload = () => ({
    agentName,
    companyName,
    companyDescription,
    goal: agentGoal,
    advantages: strengths,
    currency,
    timezone,
    writingStyle: toneOfVoice,
    addressStyle: addressForm,
    business: {
      scenario: wizardState.business.scenario,
      targetAudience: wizardState.business.targetAudience,
      firstQuestion: wizardState.business.firstQuestion,
      commonObjections: wizardState.business.commonObjections,
    },
    funnel: {
      steps: wizardState.funnel.steps.map((step, index) => ({ ...step, order: index + 1 })),
    },
    behavior: {
      handoffTriggers: wizardState.behavior.handoffTriggersText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      neverSayPhrases: wizardState.behavior.neverSayPhrasesText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      allowedTools: wizardState.behavior.allowedTools as Array<'searchKnowledgeBase' | 'redirectToOperator' | 'advanceFunnelStep' | 'getCurrentDate' | 'add_lead_note' | 'update_lead_info' | 'update_lead_status' | 'scheduleMessage' | 'createKaspiInvoice'>,
      responseDelayMs: wizardState.behavior.responseDelayMs,
      followUpEnabled: wizardState.behavior.followUpEnabled,
    },
    channels: {
      enabled: {
        whatsapp: false,
        telegram: false,
        instagram: false,
        web: false,
      },
    },
    advanced: {
      model: wizardState.advanced.model,
      temperature: wizardState.advanced.temperature,
      topP: wizardState.advanced.topP,
    },
  });

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

      const data = await fetchJson<{ companyDescription?: string; goal?: string; advantages?: string; targetAudience?: string; firstQuestion?: string; commonObjections?: string[]; error?: string }>(`/api/agents/${agentId}/auto-fill`, { method: 'POST' });

      if (data.error) {
        throw new Error(data.error);
      }

      const hasAnyAutoFill = Boolean(
        data.companyDescription || data.goal || data.advantages || data.targetAudience || data.firstQuestion || (data.commonObjections && data.commonObjections.length > 0)
      );

      if (hasAnyAutoFill) {
        setCompanyDescription(data.companyDescription || '');
        setAgentGoal(data.goal || '');
        setStrengths(data.advantages || '');
        updateBusiness({
          targetAudience: data.targetAudience || wizardState.business.targetAudience,
          firstQuestion: data.firstQuestion || wizardState.business.firstQuestion,
          commonObjections: data.commonObjections && data.commonObjections.length > 0 ? data.commonObjections : wizardState.business.commonObjections,
        });
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
      await addTextSource(agentId, 'Текст', sourceText, textInlineInPrompt);
      setSources((prev) => [
        ...prev,
        { id: Math.random().toString(), title: 'Текст', type: 'text', status: 'pending' },
      ]);
      setSourceText('');
      setTextInlineInPrompt(false);
      setShowSourceForm(null);
    } catch (error) {
      console.error('Error adding text source:', error);
      alert(error instanceof Error ? error.message : 'Не удалось добавить текст');
    }
  };

  const handleAddQASource = async () => {
    if (!agentId || !qaQuestion.trim() || !qaAnswer.trim()) return;

    try {
      await addQASource(agentId, qaQuestion, qaAnswer, qaInlineInPrompt);
      setSources((prev) => [
        ...prev,
        { id: Math.random().toString(), title: qaQuestion, type: 'qa', status: 'pending' },
      ]);
      setQaQuestion('');
      setQaAnswer('');
      setQaInlineInPrompt(false);
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
      body: JSON.stringify(buildWizardPayload()),
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
      setCurrentStep(4);
      window.setTimeout(() => {
        router.push('/dashboard');
      }, 1200);
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
      <div className={`mb-4 rounded-lg border px-4 py-3 ${statusType === 'success' ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
        {statusMessage}
      </div>
    );
  };

  const renderStepper = () => {
    const steps = [
      { number: 1, label: 'Источники' },
      { number: 2, label: 'Бизнес' },
      { number: 3, label: 'Поведение' },
      { number: 4, label: 'Проверка' },
    ];

    return (
      <div className="mb-10 flex flex-wrap items-start justify-center gap-3 md:justify-between">
        {steps.map((step, index) => {
          const isActive = currentStep === step.number;
          const isCompleted = step.number < currentStep;

          return (
            <div key={step.number} className="flex min-w-[110px] flex-1 basis-[calc(25%-0.75rem)] flex-col items-center text-center sm:basis-auto">
              <div className="flex w-full items-center">
                {index > 0 ? <div className={`h-px flex-1 ${step.number <= currentStep ? 'bg-green-600' : 'bg-gray-300'}`} /> : <div className="flex-1" />}
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${isCompleted ? 'border-green-600 bg-green-600 text-white' : isActive ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-600'}`}>
                  {isCompleted ? <Check size={18} /> : step.number}
                </div>
                {index < steps.length - 1 ? <div className={`h-px flex-1 ${step.number < currentStep ? 'bg-green-600' : 'bg-gray-300'}`} /> : <div className="flex-1" />}
              </div>
              <div className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] ${isCompleted ? 'text-green-600' : isActive ? 'text-blue-600' : 'text-gray-500'}`}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <main className="container mx-auto px-4 py-10">
      <div className="mx-auto max-w-6xl">
        {renderStatusMessage()}
        {renderStepper()}

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
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={textInlineInPrompt}
                        onChange={(e) => setTextInlineInPrompt(e.target.checked)}
                      />
                      <span>Включить в системный промпт как CORE_KNOWLEDGE</span>
                    </label>
                    {textInlineInPrompt && sourceText.length > INLINE_KB_WARNING_THRESHOLD && (
                      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        ⚠️ Содержимое слишком большое для inline-подборки ({sourceText.length} / {INLINE_KB_WARNING_THRESHOLD}). Лучше оставить опцию выключенной и использовать поиск по базе знаний.
                      </div>
                    )}
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
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={qaInlineInPrompt}
                        onChange={(e) => setQaInlineInPrompt(e.target.checked)}
                      />
                      <span>Включить в системный промпт как CORE_KNOWLEDGE</span>
                    </label>
                    {qaInlineInPrompt && (qaQuestion.length + qaAnswer.length) > INLINE_KB_WARNING_THRESHOLD && (
                      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        ⚠️ Содержимое слишком большое для inline-подборки ({qaQuestion.length + qaAnswer.length} / {INLINE_KB_WARNING_THRESHOLD}). Лучше оставить опцию выключенной и использовать поиск по базе знаний.
                      </div>
                    )}
                    <Button variant="primary" onClick={handleAddQASource}>
                      Добавить
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="mb-4 text-lg font-bold">Источники обучения ({sources.length})</h3>
              <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
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

        {currentStep === 2 && (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-8">
              <h1 className="mb-6 text-3xl font-bold">Бизнес-контекст</h1>
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Имя агента</label>
                    <input
                      value={agentName}
                      onChange={(e) => {
                        setAgentName(e.target.value);
                        if (step2ValidationError) {
                          setStep2ValidationError('');
                        }
                      }}
                      placeholder="Например, Sales Assistant"
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Название компании</label>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Например, SatuSystem"
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                {step2ValidationError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {step2ValidationError}
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Сценарий</label>
                  <div className="grid gap-3 md:grid-cols-3">
                    {(['sales', 'consultant', 'support'] as Scenario[]).map((item) => (
                      <label key={item} className={`flex cursor-pointer items-center justify-center rounded-3xl border px-4 py-3 text-sm font-medium ${wizardState.business.scenario === item ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700'}`}>
                        <input
                          type="radio"
                          name="scenario"
                          className="sr-only"
                          checked={wizardState.business.scenario === item}
                          onChange={() => updateBusiness({ scenario: item })}
                        />
                        {scenarioLabels[item]}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Кто ваш идеальный клиент?</label>
                  <textarea
                    value={wizardState.business.targetAudience}
                    onChange={(e) => updateBusiness({ targetAudience: e.target.value })}
                    placeholder="Опишите аудиторию, которую нужно обслуживать"
                    rows={3}
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Что агент должен спросить первым?</label>
                  <input
                    value={wizardState.business.firstQuestion}
                    onChange={(e) => updateBusiness({ firstQuestion: e.target.value })}
                    placeholder="Например, чем вы сейчас занимаетесь?"
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Типовые возражения</label>
                  <div className="flex gap-2">
                    <input
                      value={objectionInput}
                      onChange={(e) => setObjectionInput(e.target.value)}
                      placeholder="Например, слишком дорого"
                      className="flex-1 rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addObjection();
                        }
                      }}
                    />
                    <Button variant="outline" onClick={addObjection}>
                      Добавить
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {wizardState.business.commonObjections.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => removeObjection(item)}
                        className="rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700"
                      >
                        {item} ×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex justify-between">
                  <Button variant="outline" onClick={() => setCurrentStep(1)}>
                    ← Назад
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!agentName.trim()) {
                        setStep2ValidationError('Введите имя агента, чтобы продолжить');
                        return;
                      }

                      setStep2ValidationError('');
                      setCurrentStep(3);
                    }}
                    className="bg-[#111] text-white hover:bg-black"
                  >
                    Продолжить
                    <ArrowRight size={18} className="ml-2" />
                  </Button>
                </div>
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
                    <div className="text-xs font-semibold uppercase text-gray-500">Цель агента</div>
                    <div className="mt-2 min-h-[80px] rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800">
                      {agentGoal || 'Добавьте цель агента...'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">Ключевые преимущества</div>
                    <div className="mt-2 min-h-[80px] rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800">
                      {strengths || 'Подсветите преимущества компании...'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="p-8">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Поведение и ограничения</h2>
                  <p className="mt-2 text-sm text-gray-600">Настройте карту воронки, правила передачи оператору и поведение ответа.</p>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Воронка</h3>
                      <p className="text-sm text-gray-600">Генерируйте структуру по цели, первому вопросу и сценарию.</p>
                    </div>
                    <Button variant="outline" onClick={handleGenerateFunnel} disabled={isGeneratingFunnel}>
                      {isGeneratingFunnel ? 'Генерирую...' : 'Сгенерировать воронку'}
                    </Button>
                  </div>

                  {wizardState.funnel.steps.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
                      Сначала нажмите кнопку, чтобы подготовить шаги воронки.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {wizardState.funnel.steps.map((step, index) => (
                        <div key={step.id} className="rounded-3xl border border-gray-200 bg-white p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="text-sm font-semibold text-gray-700">Шаг {index + 1}</div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => moveFunnelStep(index, -1)}
                                className="rounded-full border border-gray-300 p-2 text-gray-600 hover:border-blue-600 hover:text-blue-600"
                                disabled={index === 0}
                              >
                                <ChevronUp size={16} />
                              </button>
                              <button
                                onClick={() => moveFunnelStep(index, 1)}
                                className="rounded-full border border-gray-300 p-2 text-gray-600 hover:border-blue-600 hover:text-blue-600"
                                disabled={index === wizardState.funnel.steps.length - 1}
                              >
                                <ChevronDown size={16} />
                              </button>
                            </div>
                          </div>
                          <input
                            value={step.title}
                            onChange={(e) => updateFunnelStep(index, 'title', e.target.value)}
                            className="mb-3 w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm"
                            placeholder="Название шага"
                          />
                          <textarea
                            value={step.triggerDescription}
                            onChange={(e) => updateFunnelStep(index, 'triggerDescription', e.target.value)}
                            className="mb-3 w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm"
                            rows={2}
                            placeholder="Когда активируется шаг"
                          />
                          <textarea
                            value={step.sampleMessage}
                            onChange={(e) => updateFunnelStep(index, 'sampleMessage', e.target.value)}
                            className="w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm"
                            rows={3}
                            placeholder="Пример сообщения"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Передача оператору</h3>
                  <div className="mt-4 space-y-4">
                    <label className="flex items-center gap-3 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={wizardState.behavior.handoffEnabled}
                        onChange={(e) => updateBehavior({ handoffEnabled: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Включить передачу человеку
                    </label>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Триггеры передачи (по одному на строку)</label>
                      <textarea
                        value={wizardState.behavior.handoffTriggersText}
                        onChange={(e) => updateBehavior({ handoffTriggersText: e.target.value })}
                        rows={4}
                        className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900"
                        placeholder="Слишком дорого\nНужно подумать"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Сообщение клиенту при передаче</label>
                      <input
                        value={wizardState.behavior.handoffClientMessage}
                        onChange={(e) => updateBehavior({ handoffClientMessage: e.target.value })}
                        className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900"
                        placeholder="Сейчас подключу специалиста"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Инструменты</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {toolOptions.map((tool) => (
                      <label key={tool.value} className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={wizardState.behavior.allowedTools.includes(tool.value)}
                          onChange={() => toggleTool(tool.value)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        {tool.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Фразы, которых агент должен избегать</h3>
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-semibold text-gray-700">Запрещённые фразы (по одной на строку)</label>
                    <textarea
                      value={wizardState.behavior.neverSayPhrasesText}
                      onChange={(e) => updateBehavior({ neverSayPhrasesText: e.target.value })}
                      rows={4}
                      className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900"
                      placeholder="Например: Я искусственный интеллект\nПерехожу в режим ожидания"
                    />
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Поведение ответа</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Задержка ответа (мс)</label>
                      <input
                        type="range"
                        min="0"
                        max="3000"
                        step="100"
                        value={wizardState.behavior.responseDelayMs}
                        onChange={(e) => updateBehavior({ responseDelayMs: Number(e.target.value) })}
                        className="w-full"
                      />
                      <div className="mt-1 text-sm text-gray-600">{wizardState.behavior.responseDelayMs} мс</div>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={wizardState.behavior.followUpEnabled}
                          onChange={(e) => updateBehavior({ followUpEnabled: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Включить follow-up сообщения
                      </label>
                      <label className="flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={wizardState.behavior.splitLongMessages}
                          onChange={(e) => updateBehavior({ splitLongMessages: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Делить длинные сообщения
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((prev) => !prev)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="text-lg font-semibold">Дополнительно</span>
                    {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {showAdvanced && (
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-gray-700">Модель</label>
                        <select
                          value={wizardState.advanced.model}
                          onChange={(e) => updateAdvanced({ model: e.target.value as Model })}
                          className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900"
                        >
                          <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-gray-700">Temperature</label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={wizardState.advanced.temperature}
                          onChange={(e) => updateAdvanced({ temperature: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="mt-1 text-sm text-gray-600">{wizardState.advanced.temperature.toFixed(1)}</div>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-gray-700">Top-p</label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={wizardState.advanced.topP}
                          onChange={(e) => updateAdvanced({ topP: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="mt-1 text-sm text-gray-600">{wizardState.advanced.topP.toFixed(1)}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setCurrentStep(2)}>
                    ← Назад
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setCurrentStep(4)}
                    className="bg-[#111] text-white hover:bg-black"
                  >
                    Продолжить к preview
                    <ArrowRight size={18} className="ml-2" />
                  </Button>
                </div>
              </div>
            </Card>

            <div className="rounded-[2rem] bg-gradient-to-br from-pink-500 via-orange-300 to-pink-500 p-1 shadow-2xl shadow-pink-200/40">
              <div className="rounded-[1.8rem] bg-white p-6">
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
                    {agentName?.trim()?.[0]?.toUpperCase() || 'A'}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{agentName || 'Имя агента'}</div>
                    <div className="text-sm text-gray-500">{companyName || 'Название компании'}</div>
                  </div>
                </div>

                <div className="mt-6 text-lg font-semibold">Бриф агента</div>
                <div className="mt-4 space-y-4 text-sm text-gray-700">
                  <div className="rounded-3xl border border-gray-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase text-gray-500">Сценарий</div>
                    <div className="mt-1 font-medium">{scenarioLabels[wizardState.business.scenario]}</div>
                  </div>
                  <div className="rounded-3xl border border-gray-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase text-gray-500">Цель</div>
                    <div className="mt-1">{agentGoal || 'Пока не указана'}</div>
                  </div>
                  <div className="rounded-3xl border border-gray-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase text-gray-500">Первый вопрос</div>
                    <div className="mt-1">{wizardState.business.firstQuestion || 'Пока не указан'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="p-8">
              <div className="space-y-6">
                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Имя агента</label>
                  <input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Например, Sales Assistant"
                    className="w-full rounded-3xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <h2 className="text-2xl font-bold">Проверка и генерация</h2>
                  <p className="mt-2 text-sm text-gray-600">Проверьте итоговый сценарий, правила передачи и доступные инструменты прежде чем создавать агента.</p>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Образец голоса</h3>
                  <p className="mt-2 text-sm text-gray-700">{getVoiceSample()}</p>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Воронка</h3>
                  <div className="mt-3 space-y-2">
                    {wizardState.funnel.steps.length > 0 ? (
                      wizardState.funnel.steps.map((step, index) => (
                        <div key={step.id} className="rounded-2xl border border-gray-200 bg-white p-3 text-sm text-gray-700">
                          <div className="font-semibold">{index + 1}. {step.title}</div>
                          <div className="mt-1 text-gray-600">{step.triggerDescription}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500">Ещё не сгенерирована</div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Инструменты</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {wizardState.behavior.allowedTools.length > 0 ? (
                      wizardState.behavior.allowedTools.map((tool) => (
                        <span key={tool} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700">{toolLabels[tool] || tool}</span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-500">Инструменты не выбраны</span>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                  <h3 className="text-lg font-semibold">Передача оператору</h3>
                  <div className="mt-3 space-y-2 text-sm text-gray-700">
                    {wizardState.behavior.handoffEnabled ? (
                      <>
                        <div>Включена</div>
                        {wizardState.behavior.handoffTriggersText ? (
                          <div className="rounded-2xl border border-gray-200 bg-white p-3 text-gray-600">{wizardState.behavior.handoffTriggersText}</div>
                        ) : (
                          <div className="text-gray-500">Триггеры не указаны</div>
                        )}
                      </>
                    ) : (
                      <div>Отключена</div>
                    )}
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setCurrentStep(3)}>
                    ← Назад
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleGeneratePrompt}
                    disabled={isGeneratingPrompt}
                    className="bg-[#111] text-white hover:bg-black"
                  >
                    {isGeneratingPrompt ? 'Генерирую промпт...' : 'Создать агента'}
                    <ArrowRight size={18} className="ml-2" />
                  </Button>
                </div>
                {isGeneratingPrompt && (
                  <div className="rounded-3xl bg-blue-50 p-4 text-blue-900">
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
                    <div className="text-xs font-semibold uppercase text-gray-500">Кому помогать</div>
                    <div className="mt-2 rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800">
                      {wizardState.business.targetAudience || 'Целевая аудитория будет уточнена'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">Первый вопрос</div>
                    <div className="mt-2 rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800">
                      {wizardState.business.firstQuestion || 'Пока не задан'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">Скорость ответа</div>
                    <div className="mt-2 rounded-3xl border border-gray-200 bg-slate-50 px-4 py-4 text-sm text-slate-800">
                      {wizardState.behavior.responseDelayMs} мс · {wizardState.behavior.followUpEnabled ? 'follow-up' : 'без follow-up'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
