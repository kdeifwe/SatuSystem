export interface FlowNodeLike {
  id?: string;
  title?: string;
  content?: string;
  position?: { x?: number; y?: number };
}

export interface FlowEdgeLike {
  id?: string;
  from?: string;
  to?: string;
  label?: string;
}

export interface DialogueFlowLike {
  entryNodeId?: string;
  nodes?: FlowNodeLike[];
  edges?: FlowEdgeLike[];
  sales_steps?: string[];
  objections?: Record<string, string>;
}

export type StandardCondition = 'answers_received' | 'yes' | 'no' | 'unclear' | 'price_asked' | 'price_presented' | 'values_presented' | 'purchase_confirmed' | 'objection_resolved' | 'objection_raised' | 'default' | 'no_match';

export interface MigrationIssue {
  agentName: string;
  kind: 'node_message_type' | 'edge_condition' | 'node_extract_fields';
  nodeId?: string;
  edgeId?: string;
  label?: string;
  message: string;
}

export interface ConvertedTransition {
  condition: StandardCondition | null;
  target: string | null;
}

export interface ConvertedNode {
  id: string;
  title: string;
  message_type: 'script' | 'dynamic';
  script_parts?: string[];
  instruction?: string;
  extract_fields: string[];
  transitions: ConvertedTransition[];
  fallback_condition: StandardCondition | null;
  fallback_target: string | null;
  max_retries_before_handoff: number;
  position: { x: number; y: number };
}

export interface ConvertedDialogueFlow {
  entryNodeId: string;
  nodes: ConvertedNode[];
}

export interface MigrationConversionResult {
  flow: ConvertedDialogueFlow;
  issues: string[];
  textLengthSummary: Array<{
    nodeId: string;
    sourceLength: number;
    renderedLength: number;
    delta: number;
    status: 'ok' | 'review';
  }>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function detectExtractFields(content: string): string[] {
  const fields = new Set<string>();
  const normalized = content.trim();

  if (/(имя|есім|client[-_\s]?name|client_name)/i.test(normalized)) {
    fields.add('client_name');
  }

  if (/(сынып|grade|class|school[-_\s]?grade)/i.test(normalized)) {
    fields.add('grade');
  }

  return Array.from(fields);
}

function resolveExtractFields(agentName: string, nodeId: string, content: string): string[] {
  const normalizedAgent = agentName.trim().toLowerCase();

  if (normalizedAgent.includes('айгерим') || normalizedAgent.includes('aigerim') || normalizedAgent.includes('juz40')) {
    switch (nodeId) {
      case 'n1':
        return ['client_name', 'grade'];
      case 'n2':
        return ['subjects', 'specialty'];
      case 'n3':
        return ['manager_contact_status'];
      case 'n4':
      case 'n5':
      case 'n7':
        return [];
      case 'n6':
        return ['objection_reason'];
      default:
        break;
    }
  }

  if (normalizedAgent.includes('али') || normalizedAgent.includes('ali')) {
    switch (nodeId) {
      case 'step-1':
        return ['purpose'];
      case 'step-2':
        return ['apartment_size'];
      case 'step-3':
        return ['city'];
      case 'step-4':
      case 'step-5':
      case 'step-7':
      case 'step-8':
        return [];
      case 'step-6':
      case 'step-9':
        return ['objection_reason'];
      default:
        break;
    }
  }

  if (normalizedAgent.includes('live funnel') || normalizedAgent.includes('funnel test')) {
    return [];
  }

  return detectExtractFields(content);
}

function detectNodeMessageType(content: string): 'script' | 'dynamic' {
  const normalized = content.trim();
  return /^отправь клиенту текст:/i.test(normalized) ? 'script' : 'dynamic';
}

function extractScriptParts(content: string): string[] {
  const normalized = content.trim();
  const quotedMatch = normalized.match(/^отправь клиенту текст:\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return [quotedMatch[1]];
  }

  const simpleMatch = normalized.match(/^отправь клиенту текст:\s*(.+?)(?:\s+и дождись.*)?$/i);
  if (simpleMatch?.[1]) {
    return [simpleMatch[1].trim()];
  }

  return [normalized.replace(/^отправь клиенту текст:\s*/i, '').trim()];
}

function getNodeSourceText(content: string, messageType: 'script' | 'dynamic'): string {
  if (messageType === 'script') {
    return extractScriptParts(content).join('\n');
  }
  return content.trim();
}

function mapEdgeCondition(label: string): { condition: StandardCondition | null; shouldReview: boolean } {
  const normalized = label.trim().toLowerCase();
  if (!normalized || /^(continue|продолжить|next|default)$/i.test(normalized)) {
    return { condition: 'default', shouldReview: false };
  }

  if (/ответ|received|answered|response/i.test(normalized)) {
    return { condition: 'answers_received', shouldReview: false };
  }
  if (/купил|куп|purchase|buy|confirmed|confirm|закрыл/i.test(normalized)) {
    return { condition: 'purchase_confirmed', shouldReview: false };
  }
  if (/цена|price|priced/i.test(normalized)) {
    if (/(озвуч|said|stated|announced|presented|назвал)/i.test(normalized)) {
      return { condition: 'price_presented', shouldReview: false };
    }
    return { condition: 'price_asked', shouldReview: false };
  }
  if (/ценност|values|presented|представ/i.test(normalized)) {
    return { condition: 'values_presented', shouldReview: false };
  }
  if (/обработ|resolved|resolved/i.test(normalized)) {
    return { condition: 'objection_resolved', shouldReview: false };
  }
  if (/(saw cheaper|need to think|too expensive|not needed now|not needed|не нужен|не нужно|дорого|дешевле|decline|reject)/i.test(normalized)) {
    return { condition: 'objection_raised', shouldReview: false };
  }
  if (/да|yes|agree|готов|интерес|соглас/i.test(normalized)) {
    return { condition: 'yes', shouldReview: false };
  }
  if (/нет|no|not|отказ|decline|reject/i.test(normalized)) {
    return { condition: 'no', shouldReview: false };
  }
  if (/сом|unclear|мб|maybe|later|подум/i.test(normalized)) {
    return { condition: 'unclear', shouldReview: false };
  }

  return { condition: null, shouldReview: true };
}

function dedupeTransitions(transitions: ConvertedTransition[]): ConvertedTransition[] {
  const seen = new Set<string>();
  return transitions.filter((transition) => {
    const key = `${transition.condition ?? ''}::${transition.target ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildLegacyFlow(flow: DialogueFlowLike): ConvertedDialogueFlow {
  const salesSteps = Array.isArray(flow.sales_steps)
    ? flow.sales_steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
    : [];

  const nodes: ConvertedNode[] = salesSteps.map((step, index) => ({
    id: `step-${index + 1}`,
    title: `Шаг ${index + 1}`,
    message_type: 'dynamic',
    instruction: step,
    extract_fields: [],
    transitions: [],
    fallback_condition: null,
    fallback_target: null,
    max_retries_before_handoff: 1,
    position: { x: index * 320, y: 0 },
  }));

  return {
    entryNodeId: nodes[0]?.id ?? '',
    nodes,
  };
}

export function convertDialogueFlowForMigration(flow: DialogueFlowLike | null | undefined, agentName: string): MigrationConversionResult {
  const source = flow && typeof flow === 'object' ? flow : {};
  const issues: MigrationIssue[] = [];

  if (Array.isArray(source.nodes) && source.nodes.length > 0) {
    const nodes = source.nodes.map((node, index) => {
      const id = typeof node?.id === 'string' && node.id.trim() ? node.id : `node-${index + 1}`;
      const title = typeof node?.title === 'string' && node.title.trim() ? node.title : `Узел ${index + 1}`;
      const content = normalizeText(node?.content);
      const messageType = detectNodeMessageType(content);
      if (!content) {
        issues.push({
          agentName,
          kind: 'node_message_type',
          nodeId: id,
          message: `У узла ${id} нет текста для преобразования`,
        });
      }

      const rendered = messageType === 'script'
        ? { script_parts: extractScriptParts(content) }
        : { instruction: content };

      const extractFields = resolveExtractFields(agentName, id, content);

      return {
        id,
        title,
        message_type: messageType,
        ...rendered,
        extract_fields: extractFields,
        transitions: [] as ConvertedTransition[],
        fallback_condition: null as StandardCondition | null,
        fallback_target: null as string | null,
        max_retries_before_handoff: 1,
        position: {
          x: typeof node?.position?.x === 'number' ? node.position.x : index * 320,
          y: typeof node?.position?.y === 'number' ? node.position.y : 0,
        },
      } as ConvertedNode;
    });

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    for (const edge of source.edges ?? []) {
      const edgeId = typeof edge?.id === 'string' && edge.id.trim() ? edge.id : '';
      const from = typeof edge?.from === 'string' && edge.from.trim() ? edge.from : '';
      const to = typeof edge?.to === 'string' && edge.to.trim() ? edge.to : '';
      const label = normalizeText(edge?.label);
      const mapping = mapEdgeCondition(label);

      if (!mapping.condition && label && mapping.shouldReview) {
        issues.push({
          agentName,
          kind: 'edge_condition',
          edgeId,
          label,
          message: `Ребро ${edgeId || from || to || 'unknown'} имеет спорную метку "${label}"`,
        });
      }

      const fromNode = from ? nodeMap.get(from) : undefined;
      if (fromNode && to) {
        fromNode.transitions.push({
          condition: mapping.condition,
          target: to,
        });
      }
    }

    for (const node of nodes) {
      node.transitions = dedupeTransitions(node.transitions);
      if (node.transitions.length > 0) {
        node.fallback_condition = 'no_match';
        node.fallback_target = node.id;
      } else {
        node.fallback_condition = null;
        node.fallback_target = null;
      }
    }

    function statusFromDelta(delta: number): 'ok' | 'review' {
      return delta === 0 ? 'ok' : 'review';
    }

    const textLengthSummary = nodes.map((node) => {
      const sourceText = getNodeSourceText(normalizeText(source.nodes?.find((candidate) => (typeof candidate?.id === 'string' && candidate.id.trim() ? candidate.id : '') === node.id)?.content), node.message_type);
      const renderedText = node.message_type === 'script'
        ? (node.script_parts ?? []).join('\n')
        : (node.instruction ?? '');
      const sourceLength = sourceText.length;
      const renderedLength = renderedText.length;
      const delta = renderedLength - sourceLength;
      return {
        nodeId: node.id,
        sourceLength,
        renderedLength,
        delta,
        status: statusFromDelta(delta),
      };
    });

    return {
      flow: {
        entryNodeId: typeof source.entryNodeId === 'string' && source.entryNodeId.trim() ? source.entryNodeId : nodes[0]?.id ?? '',
        nodes,
      },
      issues: issues.map((issue) => `${issue.kind === 'edge_condition' ? 'edge' : 'node'}: ${issue.message}`),
      textLengthSummary,
    };
  }

  return {
    flow: buildLegacyFlow(source),
    issues: [
      `${agentName}: legacy dialogue_flow без узлов/рёбер — будет преобразован в линейный граф по шагам`,
    ],
    textLengthSummary: [],
  };
}
