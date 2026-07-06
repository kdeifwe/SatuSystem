import type { FunnelFlow, FunnelNode, FunnelEdge } from './types';

interface LegacyDialogueFlow {
  sales_steps?: string[];
  objections?: Record<string, string>;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'step';
}

export function normalizeFunnelFlow(value: unknown): FunnelFlow | null {
  if (!value) return null;

  if (typeof value === 'string') {
    try {
      return normalizeFunnelFlow(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (typeof value !== 'object') return null;

  const candidate = value as Partial<FunnelFlow> & LegacyDialogueFlow;
  if (Array.isArray(candidate.nodes) && candidate.nodes.length > 0) {
    return {
      nodes: candidate.nodes as FunnelFlow['nodes'],
      edges: Array.isArray(candidate.edges) ? (candidate.edges as FunnelFlow['edges']) : [],
      entryNodeId: typeof candidate.entryNodeId === 'string' ? candidate.entryNodeId : candidate.nodes[0]?.id ?? '',
    };
  }

  const salesSteps = Array.isArray(candidate.sales_steps)
    ? candidate.sales_steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
    : [];

  if (salesSteps.length === 0) return null;

  const nodes: FunnelNode[] = salesSteps.map((step, index) => ({
    id: `step-${index + 1}`,
    title: `Шаг ${index + 1}`,
    content: `Следуй этому шагу диалога: ${step}`,
    position: { x: index * 320, y: 0 },
  }));

  const edges: FunnelEdge[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    edges.push({
      id: `edge-${index + 1}`,
      from: nodes[index].id,
      to: nodes[index + 1].id,
      label: 'продолжить',
    });
  }

  const purchaseNodeIndex = nodes.findIndex((node) => /заказ|куп|purchase|buy|order|предлож/i.test(node.content));
  const purchaseNodeId = purchaseNodeIndex >= 0 ? nodes[purchaseNodeIndex].id : nodes[Math.max(0, nodes.length - 2)]?.id;

  const objections = candidate.objections && typeof candidate.objections === 'object'
    ? Object.entries(candidate.objections).filter(([, value]) => typeof value === 'string')
    : [];

  if (purchaseNodeId && objections.length > 0) {
    const objectionsNodeId = `step-${nodes.length + 1}`;
    const objectionsNode: FunnelNode = {
      id: objectionsNodeId,
      title: 'Обработка возражений',
      content: 'Сначала пойми причину возражения, затем ответь кратко и предложи следующий шаг.',
      position: { x: 320 * (nodes.length + 1), y: 0 },
    };

    nodes.push(objectionsNode);

    if (purchaseNodeId) {
      objections.forEach(([key], index) => {
        edges.push({
          id: `edge-${nodes.length + index + 1}`,
          from: purchaseNodeId,
          to: objectionsNodeId,
          label: key.replace(/_/g, ' '),
        });
      });
    }

    const lastNodeId = nodes[nodes.length - 2]?.id;
    if (lastNodeId && lastNodeId !== objectionsNodeId) {
      edges.push({
        id: `edge-objections-next`,
        from: objectionsNodeId,
        to: lastNodeId,
        label: 'обработано',
      });
    }
  }

  return {
    nodes,
    edges,
    entryNodeId: nodes[0]?.id ?? '',
  };
}

export function normalizeFlowOrNull(value: unknown): FunnelFlow | null {
  return normalizeFunnelFlow(value);
}
