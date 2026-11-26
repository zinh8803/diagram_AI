'use client';

import React, { useState } from 'react';
import {
  FileCode2,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  Trash2,
  EyeOff,
  Save,
  Copy,
  Check,
  Layers,
  GitCommit,
  X,
} from 'lucide-react';
import {
  AnalysisRun,
  DiagramEdgeData,
  DiagramNodeData,
} from '@/types/codeflow';

interface CodeInspectorPanelProps {
  selectedNode: DiagramNodeData | null;
  activeRun: AnalysisRun;
  allNodes: DiagramNodeData[];
  allEdges: DiagramEdgeData[];
  onSelectNodeById: (nodeId: string) => void;
  onUpdateNode: (updated: DiagramNodeData) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

export default function CodeInspectorPanel({
  selectedNode,
  activeRun,
  allNodes,
  allEdges,
  onSelectNodeById,
  onUpdateNode,
  onDeleteNode,
  onClose,
}: CodeInspectorPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [copied, setCopied] = useState(false);
  const [showFullFile, setShowFullFile] = useState(false);

  if (!selectedNode) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-slate-950/60 border-l border-slate-800/80">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3 text-indigo-400">
          <FileCode2 className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">
          Truy vết Sơ đồ ↔ Source Code
        </h3>
        <p className="text-xs text-slate-400 mt-1.5 max-w-[240px] leading-relaxed">
          Click vào bất kỳ <span className="text-cyan-400 font-medium">Node</span> nào trên sơ đồ để xem file nguồn, hàm xử lý, dòng code bắt đầu/kết thúc và các thành phần liên quan.
        </p>
      </div>
    );
  }

  const fullFileContent = selectedNode.filePath
    ? activeRun.sourceFiles[selectedNode.filePath] || ''
    : '';
  const allFileLines = fullFileContent ? fullFileContent.split(/\r?\n/) : [];
  const startLine = selectedNode.startLine || 1;
  const endLine = selectedNode.endLine || allFileLines.length;

  const displayStart = showFullFile ? 1 : Math.max(1, startLine - 2);
  const displayEnd = showFullFile
    ? allFileLines.length
    : Math.min(allFileLines.length, endLine + 2);
  const visibleLines = allFileLines.slice(displayStart - 1, displayEnd);

  const incomingEdges = allEdges.filter((e) => e.target === selectedNode.id);
  const outgoingEdges = allEdges.filter((e) => e.source === selectedNode.id);

  function startEdit() {
    if (!selectedNode) return;
    setEditLabel(selectedNode.label);
    setEditDesc(selectedNode.description);
    setIsEditing(true);
  }

  function saveEdit() {
    if (!selectedNode) return;
    onUpdateNode({
      ...selectedNode,
      label: editLabel.trim() || selectedNode.label,
      description: editDesc.trim() || selectedNode.description,
    });
    setIsEditing(false);
  }

  function copySnippet() {
    const text = visibleLines.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="h-full flex flex-col bg-[#0c1220] border-l border-slate-800/90 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/70">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
            {selectedNode.layer} · {selectedNode.category}
          </span>
          {selectedNode.confidence === 'Verified' ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> Verified
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium shrink-0">
              <AlertTriangle className="w-3.5 h-3.5" /> Inferred
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startEdit}
            title="Sửa tên & mô tả node"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onUpdateNode({ ...selectedNode, isHidden: true })}
            title="Ẩn node khỏi sơ đồ"
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDeleteNode(selectedNode.id)}
            title="Xóa node"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title & Edit Form */}
        {isEditing ? (
          <div className="p-3 rounded-xl bg-slate-900 border border-indigo-500/40 space-y-2.5">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Tên thành phần (Node Label)</label>
              <input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Mô tả vai trò</label>
              <textarea
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                onClick={saveEdit}
                className="px-3 py-1 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> Áp dụng
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-base font-bold text-slate-100 break-words">
              {selectedNode.label}
            </h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              {selectedNode.description}
            </p>
          </div>
        )}

        {/* Source Location Metadata Card (Section 7.2) */}
        <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">File nguồn:</span>
            <span className="font-mono text-cyan-300 truncate max-w-[230px]" title={selectedNode.filePath}>
              {selectedNode.filePath || 'Node thủ công (Manual)'}
            </span>
          </div>
          {selectedNode.methodName && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Hàm / Method:</span>
              <span className="font-mono text-indigo-300">{selectedNode.methodName}()</span>
            </div>
          )}
          {selectedNode.startLine && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Vị trí dòng code:</span>
              <span className="font-mono text-emerald-300">
                Line {selectedNode.startLine} → Line {selectedNode.endLine}
              </span>
            </div>
          )}
        </div>

        {/* Source Code Viewer with Highlighted Lines */}
        {selectedNode.filePath && visibleLines.length > 0 && (
          <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#070a12]">
            <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 truncate">
                <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">{selectedNode.filePath}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setShowFullFile(!showFullFile)}
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  {showFullFile ? 'Thu gọn đoạn hàm' : `Xem toàn bộ file (${allFileLines.length} dòng)`}
                </button>
                <button
                  onClick={copySnippet}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="Copy đoạn code"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="p-2.5 overflow-x-auto max-h-[320px] overflow-y-auto font-mono text-[11.5px] leading-5">
              {visibleLines.map((lineText, idx) => {
                const lineNum = displayStart + idx;
                const isTargetRange = lineNum >= startLine && lineNum <= endLine;
                return (
                  <div
                    key={lineNum}
                    className={`flex px-2 py-0.5 rounded ${
                      isTargetRange
                        ? 'bg-indigo-500/15 border-l-2 border-cyan-400 text-slate-100'
                        : 'text-slate-500'
                    }`}
                  >
                    <span className="w-9 select-none text-right pr-3 text-slate-500 shrink-0">
                      {lineNum}
                    </span>
                    <pre className="whitespace-pre">{lineText || ' '}</pre>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connected Nodes (Upstream Callers & Downstream Callees - Section 7.2 & 7.3) */}
        <div className="space-y-3 pt-1">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
              Thành phần gọi đến ({incomingEdges.length})
            </h4>
            {incomingEdges.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Điểm bắt đầu (Entry node)</p>
            ) : (
              <div className="space-y-1.5">
                {incomingEdges.map((edge) => {
                  const caller = allNodes.find((n) => n.id === edge.source);
                  if (!caller) return null;
                  return (
                    <button
                      key={edge.id}
                      onClick={() => onSelectNodeById(caller.id)}
                      className="w-full text-left p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 transition flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">
                          {caller.label}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {edge.label}
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 shrink-0">
                        {caller.layer}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
              <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
              Thành phần được gọi tiếp theo ({outgoingEdges.length})
            </h4>
            {outgoingEdges.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Điểm kết thúc (Terminal node)</p>
            ) : (
              <div className="space-y-1.5">
                {outgoingEdges.map((edge) => {
                  const callee = allNodes.find((n) => n.id === edge.target);
                  if (!callee) return null;
                  return (
                    <button
                      key={edge.id}
                      onClick={() => onSelectNodeById(callee.id)}
                      className="w-full text-left p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 transition flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">
                          {callee.label}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {edge.label}
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 shrink-0">
                        {callee.layer}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
