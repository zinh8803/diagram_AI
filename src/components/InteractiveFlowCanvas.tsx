'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Code2,
  Database,
  Globe,
  Layers,
  Server,
  ShieldCheck,
  Sparkles,
  FileCode,
  Cpu,
  AlertCircle,
  KeyRound,
} from 'lucide-react';
import { DiagramEdgeData, DiagramNodeData } from '@/types/codeflow';

const LAYER_STYLES: Record<
  string,
  { border: string; bg: string; badgeBg: string; badgeText: string; title: string }
> = {
  frontend: {
    border: 'border-emerald-500/60 hover:border-emerald-400',
    bg: 'bg-gradient-to-br from-emerald-950/90 via-slate-900/95 to-slate-900/95',
    badgeBg: 'bg-emerald-500/20 border-emerald-500/40',
    badgeText: 'text-emerald-300',
    title: 'FRONTEND',
  },
  backend: {
    border: 'border-indigo-500/60 hover:border-indigo-400',
    bg: 'bg-gradient-to-br from-indigo-950/90 via-slate-900/95 to-slate-900/95',
    badgeBg: 'bg-indigo-500/20 border-indigo-500/40',
    badgeText: 'text-indigo-300',
    title: 'BACKEND',
  },
  database: {
    border: 'border-amber-500/60 hover:border-amber-400',
    bg: 'bg-gradient-to-br from-amber-950/90 via-slate-900/95 to-slate-900/95',
    badgeBg: 'bg-amber-500/20 border-amber-500/40',
    badgeText: 'text-amber-300',
    title: 'MYSQL DB',
  },
  external: {
    border: 'border-purple-500/60 hover:border-purple-400',
    bg: 'bg-gradient-to-br from-purple-950/90 via-slate-900/95 to-slate-900/95',
    badgeBg: 'bg-purple-500/20 border-purple-500/40',
    badgeText: 'text-purple-300',
    title: 'MANUAL / EXT',
  },
};

function CategoryIcon({ category }: { category: string }) {
  switch (category) {
    case 'page':
    case 'component':
      return <Globe className="w-4 h-4 text-emerald-400" />;
    case 'composable':
    case 'api_client':
      return <Code2 className="w-4 h-4 text-teal-400" />;
    case 'route':
    case 'controller':
      return <Server className="w-4 h-4 text-indigo-400" />;
    case 'validation':
      return <ShieldCheck className="w-4 h-4 text-sky-400" />;
    case 'service':
    case 'job':
      return <Cpu className="w-4 h-4 text-violet-400" />;
    case 'model':
      return <Layers className="w-4 h-4 text-blue-400" />;
    case 'table':
      return <Database className="w-4 h-4 text-amber-400" />;
    default:
      return <FileCode className="w-4 h-4 text-slate-400" />;
  }
}

function CodeFlowCustomNode({ data, selected }: { data: any; selected?: boolean }) {
  const nodeData = data as DiagramNodeData & { isDirectionLR?: boolean };
  const style = LAYER_STYLES[nodeData.layer] || LAYER_STYLES.external;
  const isTableErd = nodeData.category === 'table' && nodeData.metadata?.columns && nodeData.metadata.columns.length > 0;

  return (
    <div
      className={`relative rounded-xl border-2 transition-all duration-150 shadow-xl backdrop-blur-md ${
        style.bg
      } ${style.border} ${
        selected ? 'ring-2 ring-cyan-400 shadow-cyan-500/20 scale-[1.02]' : ''
      } ${isTableErd ? 'min-w-[275px] max-w-[320px]' : 'min-w-[245px] max-w-[285px]'}`}
    >
      <Handle
        type="target"
        position={nodeData.isDirectionLR ? Position.Left : Position.Top}
        className="!w-3 !h-3 !bg-cyan-400 !border-2 !border-slate-950"
      />

      {/* Top Header Bar */}
      <div className="px-3.5 py-2 border-b border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CategoryIcon category={nodeData.category} />
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style.badgeBg} ${style.badgeText}`}
          >
            {nodeData.category}
          </span>
        </div>

        {/* Confidence / Manual Badge */}
        <div className="flex items-center gap-1">
          {nodeData.isManual ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-medium">
              Manual
            </span>
          ) : nodeData.confidence === 'Verified' ? (
            <span
              title="Verified: Có bằng chứng trực tiếp từ source code"
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium flex items-center gap-1"
            >
              ✓ Verified
            </span>
          ) : (
            <span
              title="Inferred: Suy luận từ cấu trúc/ORM"
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium flex items-center gap-1"
            >
              ~ Inferred
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="p-3.5">
        <div className="font-semibold text-sm text-slate-100 leading-snug break-words">
          {nodeData.label}
        </div>

        {nodeData.filePath && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] font-mono text-slate-400 truncate">
            <FileCode className="w-3 h-3 text-slate-500 shrink-0" />
            <span className="truncate">{nodeData.filePath}</span>
            {nodeData.startLine && (
              <span className="text-cyan-400 shrink-0">:L{nodeData.startLine}</span>
            )}
          </div>
        )}

        {/* Special flags: Transaction, Queue, Conditions */}
        {(nodeData.metadata?.hasTransaction ||
          nodeData.metadata?.isAsyncQueue ||
          (nodeData.metadata?.conditions && nodeData.metadata.conditions.length > 0)) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {nodeData.metadata?.hasTransaction && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                DB Transaction
              </span>
            )}
            {nodeData.metadata?.isAsyncQueue && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5" /> Async Queue
              </span>
            )}
            {nodeData.metadata?.conditions && nodeData.metadata.conditions.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-0.5">
                <AlertCircle className="w-2.5 h-2.5" /> Branch Condition
              </span>
            )}
          </div>
        )}

        {/* If Table with Columns, show schema preview inside node */}
        {isTableErd && (
          <div className="mt-2.5 pt-2 border-t border-slate-800/90 space-y-1 max-h-44 overflow-y-auto">
            {nodeData.metadata!.columns!.map((col) => (
              <div
                key={col.name}
                className="flex items-center justify-between text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-950/60"
              >
                <div className="flex items-center gap-1.5 truncate">
                  {col.isPrimary ? (
                    <KeyRound className="w-3 h-3 text-amber-400 shrink-0" />
                  ) : col.isForeign ? (
                    <KeyRound className="w-3 h-3 text-cyan-400 shrink-0" />
                  ) : (
                    <span className="w-3 inline-block" />
                  )}
                  <span className={col.isPrimary ? 'text-amber-200 font-semibold' : 'text-slate-200'}>
                    {col.name}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 ml-2 shrink-0">{col.dataType}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={nodeData.isDirectionLR ? Position.Right : Position.Bottom}
        className="!w-3 !h-3 !bg-indigo-400 !border-2 !border-slate-950"
      />
    </div>
  );
}

const nodeTypes = {
  codeflowNode: CodeFlowCustomNode,
};

interface InteractiveFlowCanvasProps {
  nodesData: DiagramNodeData[];
  edgesData: DiagramEdgeData[];
  direction: 'TB' | 'LR';
  selectedNodeId: string | null;
  onSelectNode: (node: DiagramNodeData | null) => void;
  onGraphChange: (nodes: DiagramNodeData[], edges: DiagramEdgeData[]) => void;
}

export default function InteractiveFlowCanvas({
  nodesData,
  edgesData,
  direction,
  selectedNodeId,
  onSelectNode,
  onGraphChange,
}: InteractiveFlowCanvasProps) {
  const isDirectionLR = direction === 'LR';

  const initialNodes: Node[] = useMemo(
    () =>
      nodesData
        .filter((n) => !n.isHidden)
        .map((n) => ({
          id: n.id,
          type: 'codeflowNode',
          position: n.position,
          selected: n.id === selectedNodeId,
          data: {
            ...n,
            isDirectionLR,
          },
        })),
    [nodesData, isDirectionLR, selectedNodeId]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      edgesData.map((e) => {
        const isInferred = e.confidence === 'Inferred';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: e.type === 'requests' || e.type === 'dispatches',
          style: {
            stroke: isInferred ? '#f59e0b' : e.isManual ? '#a855f7' : '#38bdf8',
            strokeWidth: 2,
            strokeDasharray: isInferred ? '6 4' : undefined,
          },
          labelStyle: {
            fill: '#e2e8f0',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'JetBrains Mono, monospace',
          },
          labelBgStyle: {
            fill: '#0f172a',
            fillOpacity: 0.9,
          },
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 6,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isInferred ? '#f59e0b' : e.isManual ? '#a855f7' : '#38bdf8',
          },
        };
      }),
    [edgesData]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodeDragStop = useCallback(
    (_event: any, draggedNode: Node) => {
      const updated = nodesData.map((n) =>
        n.id === draggedNode.id ? { ...n, position: draggedNode.position } : n
      );
      onGraphChange(updated, edgesData);
    },
    [nodesData, edgesData, onGraphChange]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const newEdgeData: DiagramEdgeData = {
        id: `edge_manual_${Date.now()}`,
        source: connection.source,
        target: connection.target,
        label: 'Manual Link',
        type: 'calls',
        confidence: 'Inferred',
        isManual: true,
      };
      const updatedEdges = [...edgesData, newEdgeData];
      setEdges((eds) => addEdge(connection, eds));
      onGraphChange(nodesData, updatedEdges);
    },
    [nodesData, edgesData, onGraphChange, setEdges]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, clickedNode: Node) => {
      const found = nodesData.find((n) => n.id === clickedNode.id) || null;
      onSelectNode(found);
    },
    [nodesData, onSelectNode]
  );

  return (
    <div className="w-full h-full relative bg-[#070b12]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectNode(null)}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.2}
        maxZoom={1.8}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="#1e293b"
        />
        <Controls className="!bg-slate-900 !border-slate-700 !text-slate-200 [&>button]:!bg-slate-900 [&>button]:!border-slate-800 [&>button:hover]:!bg-slate-800" />
        <MiniMap
          nodeColor={(n) => {
            const layer = (n.data as any)?.layer;
            if (layer === 'frontend') return '#10b981';
            if (layer === 'backend') return '#6366f1';
            if (layer === 'database') return '#f59e0b';
            return '#a855f7';
          }}
          maskColor="rgba(9, 13, 22, 0.75)"
          className="!bg-slate-900/90 !border !border-slate-800 !rounded-lg"
        />
      </ReactFlow>

      {/* Legend Overlay */}
      <div className="absolute bottom-4 left-14 z-10 flex flex-wrap items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 backdrop-blur-md text-xs text-slate-300 shadow-lg">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
          <span>Frontend (Vue/Nuxt)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 inline-block" />
          <span>Backend (Laravel)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
          <span>MySQL Database</span>
        </div>
        <div className="h-3 w-[1px] bg-slate-700 mx-1" />
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-sky-400 inline-block" />
          <span>Verified Relation</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 border-b-2 border-dashed border-amber-400 inline-block" />
          <span>Inferred / Manual</span>
        </div>
      </div>
    </div>
  );
}
