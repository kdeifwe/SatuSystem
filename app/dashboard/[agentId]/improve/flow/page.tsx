'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dagre from 'dagre';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState, type Edge, type NodeProps, type OnConnect } from 'reactflow';
import 'reactflow/dist/style.css';
import { Loader2, MessageSquareText, Save, Sparkles } from 'lucide-react';
import type { FunnelFlow } from '@/lib/funnel/types';

interface FunnelNodeData {
  title: string;
  content: string;
  onChange: (nodeId: string, field: 'title' | 'content', value: string) => void;
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
  return (
    <div className="min-w-[240px] rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Шаг</div>
      <input
        value={data.title}
        onChange={(event) => data.onChange(id, 'title', event.target.value)}
        className="mb-2 w-full rounded-xl border border-slate-200 px-2 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-400"
      />
      <textarea
        value={data.content}
        onChange={(event) => data.onChange(id, 'content', event.target.value)}
        rows={4}
        className="w-full rounded-xl border border-slate-200 px-2 py-2 text-sm text-slate-700 outline-none focus:border-blue-400"
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
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Конструктор воронки продаж</div>
            <div className="text-sm text-slate-500">Пишите сценарий в чате, а диаграмма будет обновляться автоматически</div>
          </div>
          <button
            type="button"
            onClick={saveFlow}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-6">
        <div className="grid h-full gap-4 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
          <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <MessageSquareText className="h-4 w-4 text-blue-600" />
                Чат с AI
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Например: «Сначала здороваемся, спрашиваем площадь квартиры, потом говорим о доставке, показываем модель пылесоса. Если готов купить — оформляем заказ. Если сомневается — работаем с возражениями». 
              </div>
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`rounded-2xl px-3 py-2 text-sm ${message.role === 'user' ? 'ml-auto bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200 p-4">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                placeholder="Опишите, как должен вести диалог агент..."
                className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-blue-400"
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-slate-500">Граф обновляется с сохранением существующих узлов</div>
                <button
                  type="button"
                  onClick={submitMessage}
                  disabled={loading || !draft.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Отправить
                </button>
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">Диаграмма воронки</div>
              <select
                value={flow.entryNodeId}
                onChange={(event) => setFlow((current) => ({ ...current, entryNodeId: event.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                {flow.nodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.title || node.id}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              {loading && flow.nodes.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Загружаю текущий граф…</div>
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
                >
                  <Background />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              )}
            </div>
            {error ? <div className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
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
