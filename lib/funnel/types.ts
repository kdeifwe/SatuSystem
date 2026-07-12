export interface FunnelNode {
  id: string;
  title: string;
  content: string;
  position: { x: number; y: number };
  message_type?: string;
  script_parts?: string[];
}

export interface FunnelEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface FunnelFlow {
  nodes: FunnelNode[];
  edges: FunnelEdge[];
  entryNodeId: string;
}
