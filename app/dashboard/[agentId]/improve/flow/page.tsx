'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dagre from 'dagre';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState, type Edge, type NodeProps, type OnConnect } from 'reactflow';
import 'reactflow/dist/style.css';
import { Loader2, MessageSquareText, Save, Sparkles, X } from 'lucide-react';
import type { FunnelFlow } from '@/lib/funnel/types';

interface FunnelNodeData {
  title: string;
  content: string;
  onChange: (nodeId: string, field: 'title' | 'content', value: string) => void;
  onDelete: (nodeId: string) => void;
}

function layoutFlow(nodes: Array<{ id: string; position?: { x: number; y: number } }>, edges: Array<{ id: string; from: string; to: string; label?: string }>) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100, marginx: 20, marginy: 20 });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => graph.setNode(node.id, { width: 280, height: 140 }));
  edges.forEach((edge) => graph.setEdge(edge.from, edge.to));

  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: position
        ? { x: position.x - 140, y: position.y - 70 }
        : node.position ?? { x: 0, y: 0 },
    };
  });
}

function EditableNode({ id, data }: NodeProps<FunnelNodeData>) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    if (showDeleteConfirm) {
      data.onDelete(id);
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  return (
    <div className="relative min-w-[240px] rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] p-3 shadow-sm">
      {/* Delete button */}
      <button
        type="button"
        onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
        className="absolute right-2 top-2 rounded-full p-1 text-[color:var(--color-smoke)] transition-all hover:bg-[color:var(--color-obsidian)] hover:text-[color:var(--color-chalk)]"
        title="Удалить шаг"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[var(--radius-cards)] bg-[color:var(--color-carbon)]/95 backdrop-blur-sm">
          <div className="text-center">
            <div className="mb-3 text-xs font-semibold uppercase text-[color:var(--color-smoke)]">Подтверждение</div>
            <div className="mb-4 px-2 text-sm text-[color:var(--color-chalk)]">
              Удалить шаг<br/>«{data.title || 'без названия'}»?
            </div>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg bg-[color:var(--color-obsidian)] px-3 py-1 text-xs font-medium text-[color:var(--color-chalk)] hover:border-[color:var(--color-ash)]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-rose-500 text-white hover:bg-rose-600"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-smoke)]">Шаг</div>
      <input
        value={data.title}
        onChange={(event) => data.onChange(id, 'title', event.target.value)}
        className="hyper-input mb-2 px-2 py-2 text-sm font-medium"
      />
      <textarea
        value={data.content}
        onChange={(event) => data.onChange(id, 'content', event.target.value)}
        rows={4}
        className="hyper-input px-2 py-2 text-sm"
      />
    </div>
  );
}

function FlowCanvas({ agentId }: { agentId: string }) {
  const [flow, setFlow] = useState<FunnelFlow>({ nodes: [], edges: [], entryNodeId: '' });
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<any[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any[]>([]);

  const nodeTypes = useMemo(() => ({ funnelNode: EditableNode }), []);

  const handleNodeValueChange = useCallback((nodeId: string, field: 'title' | 'content', value: string) => {
    setNodes((current) => 
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                [field]: value,
              },
            }
          : node
      )
    );

    setFlow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              [field]: value,
            }
          : node
      ),
    }));
  }, [setFlow, setNodes]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    setFlow((current) => {
      // Find the node to delete
      const nodeToDelete = current.nodes.find((n) => n.id === nodeId);
      if (!nodeToDelete) return current;

      // Remove the node
      const updatedNodes = current.nodes.filter((n) => n.id !== nodeId);

      // Remove all edges connected to this node (both from and to)
      const updatedEdges = current.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);

      // If deleted node was entryNodeId, assign the first remaining node as entry
      let entryNodeId = current.entryNodeId;
      if (entryNodeId === nodeId) {
        entryNodeId = updatedNodes.length > 0 ? updatedNodes[0].id : '';
        if (entryNodeId) {
          // Notify user about the change
          setError(`Стартовый шаг был удалён. Новый стартовый шаг: "${updatedNodes[0].title || updatedNodes[0].id}"`);
        }
      }

      const nextFlow: FunnelFlow = {
        nodes: updatedNodes,
        edges: updatedEdges,
        entryNodeId,
      };

      return nextFlow;
    });
  }, [setError]);

  const applyFlowToCanvas = useCallback((nextFlow: FunnelFlow) => {
    const flowWithVisibleEdges = {
      ...nextFlow,
      edges: nextFlow.edges.length > 0 || nextFlow.nodes.length <= 1
        ? nextFlow.edges
        : nextFlow.nodes.slice(1).map((node, index) => ({
            id: `edge-${nextFlow.nodes[index].id}-${node.id}`,
            from: nextFlow.nodes[index].id,
            to: node.id,
            label: 'следующий шаг',
          })),
    };

    const layoutedNodes = layoutFlow(
      flowWithVisibleEdges.nodes.map((node) => ({
        id: node.id,
        position: node.position ?? { x: 0, y: 0 },
      })),
      flowWithVisibleEdges.edges,
    );

    const layoutedFlow: FunnelFlow = {
      ...nextFlow,
      edges: flowWithVisibleEdges.edges,
      nodes: nextFlow.nodes.map((node, index) => ({
        ...node,
        position: layoutedNodes[index]?.position ?? node.position ?? { x: 0, y: 0 },
      })),
    };

    setFlow(layoutedFlow);
    setNodes(
      layoutedFlow.nodes.map((node) => ({
        id: node.id,
        type: 'funnelNode',
        position: node.position,
        data: {
          title: node.title,
          content: node.content,
          onChange: handleNodeValueChange,
          onDelete: handleNodeDelete,
        },
      })) as any
    );
    setEdges(
      layoutedFlow.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#94A3B8' },
        labelStyle: { fill: '#475569', fontSize: 12 },
        labelBgStyle: { fill: '#F1F5F9' },
      }))
    );
  }, [handleNodeValueChange, setEdges, setNodes]);

  // Update canvas when flow is deleted/modified (by handleNodeDelete)
  useEffect(() => {
    if (flow.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const layoutedNodes = layoutFlow(
      flow.nodes.map((node) => ({
        id: node.id,
        position: node.position ?? { x: 0, y: 0 },
      })),
      flow.edges,
    );

    setNodes(
      flow.nodes.map((node, index) => ({
        id: node.id,
        type: 'funnelNode',
        position: layoutedNodes[index]?.position ?? node.position ?? { x: 0, y: 0 },
        data: {
          title: node.title,
          content: node.content,
          onChange: handleNodeValueChange,
          onDelete: handleNodeDelete,
        },
      })) as any
    );

    setEdges(
      flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#94A3B8' },
        labelStyle: { fill: '#475569', fontSize: 12 },
        labelBgStyle: { fill: '#F1F5F9' },
      }))
    );
  }, [flow, handleNodeValueChange, handleNodeDelete, setNodes, setEdges]);

  useEffect(() => {
    let cancelled = false;

    async function loadFlow() {
      setLoading(true);
      try {
        const res = await fetch(`/api/agents/${agentId}/flow`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить воронку');
        if (!cancelled) {
          applyFlowToCanvas(data.flow ?? { nodes: [], edges: [], entryNodeId: '' });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFlow();
    return () => {
      cancelled = true;
    };
  }, [agentId, applyFlowToCanvas]);

  const onConnect: OnConnect = useCallback(
    (params) => {
      const edge: Edge = {
        id: `${params.source}-${params.target}`,
        source: params.source!,
        target: params.target!,
        animated: true,
        label: 'условие',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#94A3B8' },
        labelStyle: { fill: '#475569', fontSize: 12 },
        labelBgStyle: { fill: '#F1F5F9' },
      };

      setEdges((current) => addEdge(edge, current));
      setFlow((current) => {
        const nextFlow = {
          ...current,
          edges: [
            ...current.edges,
            {
              id: edge.id,
              from: edge.source,
              to: edge.target,
              label: 'условие',
            },
          ],
        };

        applyFlowToCanvas(nextFlow);
        return nextFlow;
      });
    },
    [applyFlowToCanvas, setEdges, setFlow]
  );

  const submitMessage = async () => {
    if (!draft.trim()) return;

    const userMessage = draft.trim();
    setDraft('');
    setMessages((current) => [...current, { role: 'user', text: userMessage }]);
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/agents/${agentId}/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage,
          conversationHistory: messages.concat([{ role: 'user', text: userMessage }]),
          flow,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Не удалось построить граф');
      setMessages((current) => [...current, { role: 'model', text: 'Граф обновлён' }]);
      applyFlowToCanvas(data.flow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const saveFlow = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        flow: {
          nodes: flow.nodes.map((node) => ({
            id: node.id,
            title: node.title,
            content: node.content,
            position: node.position,
          })),
          edges: flow.edges.map((edge) => ({
            id: edge.id,
            from: edge.from,
            to: edge.to,
            label: edge.label,
          })),
          entryNodeId: flow.entryNodeId,
        },
        note: 'Сохранение воронки продаж',
      };

      const res = await fetch(`/api/agents/${agentId}/flow`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Не удалось сохранить граф');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hyper-dashboard-shell flex h-full flex-col">
      <div className="border-b border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[color:var(--color-chalk)]">Конструктор воронки продаж</div>
            <div className="text-sm text-[color:var(--color-smoke)]">Пишите сценарий в чате, а диаграмма будет обновляться автоматически</div>
          </div>
          <button
            type="button"
            onClick={saveFlow}
            disabled={saving}
            className="hyper-primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-6">
        <div className="grid h-full gap-4 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
          <div className="flex h-full flex-col rounded-[var(--radius-2xl)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] shadow-sm">
            <div className="border-b border-[color:var(--color-graphite)] px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-chalk)]">
                <MessageSquareText className="h-4 w-4 text-[color:var(--color-ash)]" />
                Чат с AI
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <div className="rounded-[var(--radius-cards)] border border-dashed border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] p-3 text-sm text-[color:var(--color-smoke)]">
                Например: «Сначала здороваемся, спрашиваем площадь квартиры, потом говорим о доставке, показываем модель пылесоса. Если готов купить — оформляем заказ. Если сомневается — работаем с возражениями». 
              </div>
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`rounded-[var(--radius-cards)] px-3 py-2 text-sm ${message.role === 'user' ? 'ml-auto bg-[color:var(--color-signal-white)] text-[color:var(--color-obsidian)]' : 'bg-[color:var(--color-obsidian)] text-[color:var(--color-chalk)]'}`}>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="border-t border-[color:var(--color-graphite)] p-4">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                placeholder="Опишите, как должен вести диалог агент..."
                className="hyper-input w-full px-3 py-3 text-sm"
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-[color:var(--color-smoke)]">Граф обновляется с сохранением существующих узлов</div>
                <button
                  type="button"
                  onClick={submitMessage}
                  disabled={loading || !draft.trim()}
                  className="hyper-primary-btn inline-flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Отправить
                </button>
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col rounded-[var(--radius-2xl)] border border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[color:var(--color-graphite)] px-4 py-4">
              <div className="text-sm font-semibold text-[color:var(--color-chalk)]">Диаграмма воронки</div>
              <select
                value={flow.entryNodeId}
                onChange={(event) => setFlow((current) => ({ ...current, entryNodeId: event.target.value }))}
                className="rounded-[var(--radius-cards)] border border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] px-3 py-2 text-sm text-[color:var(--color-chalk)]"
              >
                {flow.nodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.title || node.id}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              {loading && flow.nodes.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-smoke)]">Загружаю текущий граф…</div>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  fitView
                  proOptions={{ hideAttribution: true }}
                  className="bg-[color:var(--color-obsidian)]"
                  style={{ background: 'var(--color-obsidian)' }}
                >
                  <Background />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              )}
            </div>
            {error ? <div className="border-t border-[color:var(--color-graphite)] bg-[color:var(--color-carbon)] px-4 py-3 text-sm text-[color:var(--color-ash)]">{error}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FunnelFlowPage({ params }: { params: { agentId: string } }) {
  return (
    <ReactFlowProvider>
      <FlowCanvas agentId={params.agentId} />
    </ReactFlowProvider>
  );
}
