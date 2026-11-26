'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Network,
  FolderGit2,
  Upload,
  Search,
  Layers,
  Database,
  GitBranch,
  FileCode,
  Download,
  Share2,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Eye,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ArrowRightLeft,
  History,
  Lock,
  Globe,
  Code2,
  X,
  Check,
  Terminal,
} from 'lucide-react';
import InteractiveFlowCanvas from '@/components/InteractiveFlowCanvas';
import CodeInspectorPanel from '@/components/CodeInspectorPanel';
import MermaidViewer from '@/components/MermaidViewer';
import {
  DiagramEdgeData,
  DiagramNodeData,
  Project,
} from '@/types/codeflow';
import {
  generateMermaidForFlow,
  generatePlantUmlForFlow,
  generateSequenceMermaid,
} from '@/lib/analyzer';

type ActiveTab = 'flowchart' | 'sequence' | 'erd' | 'architecture' | 'code_search';

export default function CodeFlowWorkspacePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [activeRunId, setActiveRunId] = useState<string>('');
  const [activeFlowId, setActiveFlowId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('flowchart');

  // Canvas state with Undo/Redo history (Section 8.1)
  const [nodes, setNodes] = useState<DiagramNodeData[]>([]);
  const [edges, setEdges] = useState<DiagramEdgeData[]>([]);
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [selectedNode, setSelectedNode] = useState<DiagramNodeData | null>(null);
  const [historyStack, setHistoryStack] = useState<{ nodes: DiagramNodeData[]; edges: DiagramEdgeData[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [activeVersionNum, setActiveVersionNum] = useState<number>(1);

  // Search & Trace (Section 7.1 & 7.3)
  const [searchQuery, setSearchQuery] = useState('');
  const [codeTraceQuery, setCodeTraceQuery] = useState('');
  const [selectedFileInExplorer, setSelectedFileInExplorer] = useState<string>('');

  // Modals
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // New project form state
  const [uploadMode, setUploadMode] = useState<'zip' | 'local'>('zip');
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjBranch, setNewProjBranch] = useState('main');
  const [newProjLocalPath, setNewProjLocalPath] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Manual node modal state
  const [manualNodeLabel, setManualNodeLabel] = useState('');
  const [manualNodeLayer, setManualNodeLayer] = useState<'frontend' | 'backend' | 'database' | 'external'>('backend');
  const [manualNodeDesc, setManualNodeDesc] = useState('');

  // Load initial projects
  useEffect(() => {
    fetchProjects();
  }, []);

  function notify(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  async function fetchProjects() {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (data.projects && data.projects.length > 0) {
      setProjects(data.projects);
      const firstProj = data.projects[0] as Project;
      selectProject(firstProj);
    }
  }

  function selectProject(proj: Project, runIdOverride?: string) {
    setActiveProjectId(proj.id);
    const targetRun =
      proj.analysisRuns.find((r) => r.id === runIdOverride) ||
      proj.analysisRuns[0];

    if (targetRun) {
      setActiveRunId(targetRun.id);
      const firstFile = Object.keys(targetRun.sourceFiles)[0] || '';
      setSelectedFileInExplorer(firstFile);

      if (targetRun.featureFlows.length > 0) {
        const firstFlow = targetRun.featureFlows[0];
        loadFlowDiagram(proj, targetRun.id, firstFlow.id);
      }
    }
  }

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  );

  const activeRun = useMemo(
    () => activeProject?.analysisRuns.find((r) => r.id === activeRunId) || activeProject?.analysisRuns[0],
    [activeProject, activeRunId]
  );

  const activeFlow = useMemo(
    () => activeRun?.featureFlows.find((f) => f.id === activeFlowId) || activeRun?.featureFlows[0],
    [activeRun, activeFlowId]
  );

  const activeDiagram = useMemo(() => {
    if (!activeProject || !activeRun) return undefined;
    if (activeTab === 'erd') {
      return activeProject.diagrams.find(
        (d) => d.analysisRunId === activeRun.id && d.type === 'erd'
      );
    }
    return activeProject.diagrams.find(
      (d) => d.analysisRunId === activeRun.id && d.featureFlowId === activeFlow?.id
    );
  }, [activeProject, activeRun, activeFlow, activeTab]);

  function loadFlowDiagram(proj: Project, runId: string, flowId: string, verNum?: number) {
    setActiveFlowId(flowId);
    setSelectedNode(null);
    const diag = proj.diagrams.find(
      (d) => d.analysisRunId === runId && d.featureFlowId === flowId
    );
    if (diag && diag.versions.length > 0) {
      const targetVer =
        diag.versions.find((v) => v.versionNumber === verNum) ||
        diag.versions[diag.versions.length - 1];
      setNodes(targetVer.nodes);
      setEdges(targetVer.edges);
      setDirection(diag.direction);
      setActiveVersionNum(targetVer.versionNumber);
      setHistoryStack([{ nodes: targetVer.nodes, edges: targetVer.edges }]);
      setHistoryIndex(0);
    }
  }

  function loadErdDiagram() {
    if (!activeProject || !activeRun) return;
    setActiveTab('erd');
    setSelectedNode(null);
    const erdDiag = activeProject.diagrams.find(
      (d) => d.analysisRunId === activeRun.id && d.type === 'erd'
    );
    if (erdDiag && erdDiag.versions.length > 0) {
      const ver = erdDiag.versions[erdDiag.versions.length - 1];
      setNodes(ver.nodes);
      setEdges(ver.edges);
      setDirection('LR');
      setActiveVersionNum(ver.versionNumber);
      setHistoryStack([{ nodes: ver.nodes, edges: ver.edges }]);
      setHistoryIndex(0);
    }
  }

  function pushGraphState(newNodes: DiagramNodeData[], newEdges: DiagramEdgeData[]) {
    setNodes(newNodes);
    setEdges(newEdges);
    const nextHistory = historyStack.slice(0, historyIndex + 1);
    nextHistory.push({ nodes: newNodes, edges: newEdges });
    setHistoryStack(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  }

  function handleUndo() {
    if (historyIndex > 0) {
      const prev = historyStack[historyIndex - 1];
      setNodes(prev.nodes);
      setEdges(prev.edges);
      setHistoryIndex(historyIndex - 1);
    }
  }

  function handleRedo() {
    if (historyIndex < historyStack.length - 1) {
      const next = historyStack[historyIndex + 1];
      setNodes(next.nodes);
      setEdges(next.edges);
      setHistoryIndex(historyIndex + 1);
    }
  }

  function handleShowAllHiddenNodes() {
    const restored = nodes.map((n) => ({ ...n, isHidden: false }));
    pushGraphState(restored, edges);
    notify('Đã hiển thị lại tất cả các node bị ẩn.');
  }

  function handleAddManualNode(e: React.FormEvent) {
    e.preventDefault();
    if (!manualNodeLabel.trim()) return;
    const newNode: DiagramNodeData = {
      id: `manual_${Date.now()}`,
      label: manualNodeLabel.trim(),
      subtitle: 'Manual Node',
      category: 'manual',
      layer: manualNodeLayer,
      description: manualNodeDesc.trim() || 'Node được thêm thủ công bởi developer.',
      confidence: 'Inferred',
      isManual: true,
      position: { x: 250, y: 180 },
    };
    pushGraphState([...nodes, newNode], edges);
    setManualNodeLabel('');
    setManualNodeDesc('');
    setShowAddNodeModal(false);
    notify(`Đã thêm node thủ công "${newNode.label}".`);
  }

  async function handleSaveDiagramVersion() {
    if (!activeProject || !activeDiagram) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_diagram_version',
        projectId: activeProject.id,
        diagramId: activeDiagram.id,
        versionName: `Bản chỉnh sửa v${activeDiagram.versions.length + 1} (${new Date().toLocaleTimeString('vi-VN')})`,
        nodes,
        edges,
        direction,
      }),
    });
    const data = await res.json();
    if (data.project) {
      setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
      setActiveVersionNum(data.diagram.currentVersion);
      notify(`Đã lưu phiên bản sơ đồ mới (v${data.diagram.currentVersion}) mà không ghi đè bản phân tích gốc!`);
    }
  }

  async function handleReanalyzeProject() {
    if (!activeProject) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reanalyze',
          projectId: activeProject.id,
        }),
      });
      const data = await res.json();
      if (data.project && data.newRun) {
        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
        selectProject(data.project, data.newRun.id);
        notify(`Phân tích lại thành công! Đã tạo phiên bản phân tích mới: ${data.newRun.versionTag}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCreateProjectSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsAnalyzing(true);
    try {
      let res: Response;
      if (uploadMode === 'zip') {
        if (!zipFile) {
          notify('Vui lòng chọn file ZIP source code!');
          setIsAnalyzing(false);
          return;
        }
        const fd = new FormData();
        fd.append('name', newProjName || zipFile.name.replace(/\.zip$/i, ''));
        fd.append('description', newProjDesc || 'Dự án upload từ file ZIP');
        fd.append('defaultBranch', newProjBranch || 'main');
        fd.append('zipFile', zipFile);
        res = await fetch('/api/projects', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_from_local',
            name: newProjName,
            description: newProjDesc,
            localPath: newProjLocalPath,
            defaultBranch: newProjBranch,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Không thể phân tích project');
        return;
      }

      if (data.project) {
        setProjects((prev) => [data.project, ...prev]);
        selectProject(data.project);
        setShowNewProjectModal(false);
        setNewProjName('');
        setNewProjDesc('');
        setZipFile(null);
        notify(`Đã phân tích thành công dự án "${data.project.name}"!`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }

  // Filtered Feature Flows in sidebar (Section 7.1)
  const filteredFlows = useMemo(() => {
    if (!activeRun) return [];
    if (!searchQuery.trim()) return activeRun.featureFlows;
    const q = searchQuery.toLowerCase();
    return activeRun.featureFlows.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.endpointPath?.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
    );
  }, [activeRun, searchQuery]);

  // Dynamic Mermaid & PlantUML codes for current view
  const currentMermaidCode = useMemo(() => {
    if (!activeRun) return '';
    if (activeTab === 'sequence' && activeFlow) {
      return generateSequenceMermaid(activeFlow, nodes, edges);
    }
    if (activeTab === 'erd') {
      const erdDiag = activeProject?.diagrams.find(
        (d) => d.analysisRunId === activeRun.id && d.type === 'erd'
      );
      return erdDiag?.versions[erdDiag.versions.length - 1]?.mermaidCode || '';
    }
    return generateMermaidForFlow(nodes, edges);
  }, [activeRun, activeTab, activeFlow, nodes, edges, activeProject]);

  const currentPlantUmlCode = useMemo(() => {
    return generatePlantUmlForFlow(activeFlow?.name || 'CodeFlow Diagram', nodes, edges);
  }, [activeFlow, nodes, edges]);

  // Architecture Overview Mermaid (Section 6.4)
  const architectureMermaidCode = useMemo(() => {
    if (!activeRun) return '';
    const feSyms = activeRun.symbols.filter((s) => s.layer === 'frontend');
    const beSyms = activeRun.symbols.filter((s) => s.layer === 'backend');
    const dbSyms = activeRun.symbols.filter((s) => s.layer === 'database');

    const lines: string[] = ['flowchart TB'];
    const clean = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

    lines.push('    subgraph FE["Frontend Layer (Vue.js / Nuxt)"]');
    for (const s of feSyms) {
      lines.push(`        ${clean(s.id)}["${s.label}"]`);
    }
    lines.push('    end');

    lines.push('    subgraph BE["Backend Layer (PHP Laravel)"]');
    for (const s of beSyms) {
      lines.push(`        ${clean(s.id)}["${s.label}"]`);
    }
    lines.push('    end');

    lines.push('    subgraph DB["Database Layer (MySQL)"]');
    for (const s of dbSyms) {
      lines.push(`        ${clean(s.id)}[("${s.name}")]`);
    }
    lines.push('    end');

    for (const r of activeRun.relations) {
      if (r.type === 'foreign_key') continue;
      lines.push(`    ${clean(r.sourceId)} -->|"${r.label}"| ${clean(r.targetId)}`);
    }

    return lines.join('\n');
  }, [activeRun]);

  // Trace from Code -> Diagram (Section 7.3)
  const traceSymbolsMatchingCode = useMemo(() => {
    if (!activeRun) return [];
    const q = codeTraceQuery.toLowerCase().trim();
    return activeRun.symbols.filter((s) => {
      const matchesFile = selectedFileInExplorer ? s.filePath === selectedFileInExplorer : true;
      const matchesQuery = q
        ? s.name.toLowerCase().includes(q) ||
          s.filePath.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
        : matchesFile;
      return matchesQuery;
    });
  }, [activeRun, codeTraceQuery, selectedFileInExplorer]);

  function downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Đã xuất file ${filename}`);
  }

  function handleExportSvg() {
    const svgEl = document.querySelector('.mermaid-svg-wrapper svg') || document.querySelector('.react-flow__viewport');
    if (svgEl && svgEl.tagName.toLowerCase() === 'svg') {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgEl);
      downloadFile(svgString, `${activeFlow?.id || 'codeflow'}.svg`, 'image/svg+xml');
    } else {
      // Export clean standalone SVG generated from nodes & edges
      const svgLines = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" style="background:#090d16;font-family:sans-serif">`,
      ];
      for (const e of edges) {
        const src = nodes.find((n) => n.id === e.source);
        const tgt = nodes.find((n) => n.id === e.target);
        if (src && tgt) {
          svgLines.push(
            `<line x1="${src.position.x + 120}" y1="${src.position.y + 40}" x2="${tgt.position.x + 120}" y2="${tgt.position.y}" stroke="#38bdf8" stroke-width="2" />`
          );
        }
      }
      for (const n of nodes) {
        const fill = n.layer === 'frontend' ? '#064e3b' : n.layer === 'backend' ? '#1e1b4b' : '#451a03';
        const stroke = n.layer === 'frontend' ? '#10b981' : n.layer === 'backend' ? '#6366f1' : '#f59e0b';
        svgLines.push(
          `<g transform="translate(${n.position.x}, ${n.position.y})">`,
          `<rect width="240" height="68" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`,
          `<text x="14" y="26" fill="#f8fafc" font-size="13" font-weight="bold">${n.label.replace(/[<>&]/g, '')}</text>`,
          `<text x="14" y="48" fill="#94a3b8" font-size="11">${(n.filePath || '').replace(/[<>&]/g, '')}:${n.startLine || ''}</text>`,
          `</g>`
        );
      }
      svgLines.push('</svg>');
      downloadFile(svgLines.join('\n'), `${activeFlow?.id || 'codeflow'}.svg`, 'image/svg+xml');
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-indigo-600/95 border border-indigo-400/40 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* TOP NAVIGATION BAR */}
      <header className="h-14 px-4 border-b border-slate-800/90 bg-[#0b101d] flex items-center justify-between gap-4 shrink-0">
        {/* Brand & Project Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Network className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-tight text-white">CodeFlow</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                  v1.0 MVP
                </span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block">
                Code-to-Diagram & Source Traceability
              </p>
            </div>
          </div>

          <div className="h-5 w-[1px] bg-slate-800 mx-1" />

          {/* Project Select */}
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-indigo-400" />
            <select
              value={activeProjectId}
              onChange={(e) => {
                const proj = projects.find((p) => p.id === e.target.value);
                if (proj) selectProject(proj);
              }}
              className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} [{p.sourceType}]
                </option>
              ))}
            </select>

            {/* Analysis Run Version Selector (Section 5.1 & 10) */}
            {activeProject && activeProject.analysisRuns.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
                <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                <select
                  value={activeRun?.id || ''}
                  onChange={(e) => selectProject(activeProject, e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none text-xs"
                >
                  {activeProject.analysisRuns.map((r, idx) => (
                    <option key={r.id} value={r.id} className="bg-slate-900">
                      Run #{activeProject.analysisRuns.length - idx}: {r.versionTag}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload ZIP / Tạo Project</span>
            </button>

            <button
              onClick={handleReanalyzeProject}
              disabled={isAnalyzing}
              title="Phân tích lại project khi source code thay đổi (Giữ nguyên các sơ đồ cũ)"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Right Status & Export / Share Controls */}
        <div className="flex items-center gap-2">
          {activeRun && (
            <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px]">
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {activeRun.status}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-300">
                <strong className="text-white">{activeRun.stats.filesScanned}</strong> files
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-300">
                <strong>{activeRun.stats.verifiedRelations}</strong> Verified
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-amber-300">
                <strong>{activeRun.stats.inferredRelations}</strong> Inferred
              </span>
            </div>
          )}

          <button
            onClick={() => setShowShareModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Chia sẻ</span>
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Sơ đồ</span>
          </button>
        </div>
      </header>

      {/* MAIN 3-COLUMN WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR: Feature Flows, Structure Summary & Warnings */}
        <aside className="w-72 border-r border-slate-800/90 bg-[#0b101b] flex flex-col shrink-0">
          {/* Search Feature Input (Section 7.1) */}
          <div className="p-3 border-b border-slate-800/80">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm chức năng, API (VD: chi tiêu, login)..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Detected Stack Pill Row */}
          {activeRun && (
            <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-950/40 flex flex-wrap gap-1">
              {activeRun.detectedFrameworks.frontend.map((fw) => (
                <span
                  key={fw}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                >
                  {fw}
                </span>
              ))}
              {activeRun.detectedFrameworks.backend.map((fw) => (
                <span
                  key={fw}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                >
                  {fw}
                </span>
              ))}
              {activeRun.detectedFrameworks.database.map((fw) => (
                <span
                  key={fw}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
                >
                  {fw}
                </span>
              ))}
            </div>
          )}

          {/* Feature Flows List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                <span>Luồng nghiệp vụ & API ({filteredFlows.length})</span>
              </div>
              <div className="space-y-1.5">
                {filteredFlows.map((flow) => {
                  const isSelected =
                    activeFlow?.id === flow.id &&
                    (activeTab === 'flowchart' || activeTab === 'sequence');
                  return (
                    <button
                      key={flow.id}
                      onClick={() => {
                        if (activeProject && activeRun) {
                          if (activeTab !== 'flowchart' && activeTab !== 'sequence') {
                            setActiveTab('flowchart');
                          }
                          loadFlowDiagram(activeProject, activeRun.id, flow.id);
                        }
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition ${
                        isSelected
                          ? 'bg-indigo-600/20 border-indigo-500/60 text-white shadow-md'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            flow.httpMethod === 'POST'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : flow.httpMethod === 'DELETE'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-sky-500/20 text-sky-300'
                          }`}
                        >
                          {flow.httpMethod}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 truncate flex-1">
                          {flow.endpointPath}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {flow.symbolIds.length} nodes
                        </span>
                      </div>
                      <div className="text-xs font-semibold leading-snug">{flow.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick System Views */}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Sơ đồ hệ thống & Truy vết
              </div>
              <div className="space-y-1.5">
                <button
                  onClick={loadErdDiagram}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-between transition ${
                    activeTab === 'erd'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-amber-400" />
                    <span>Sơ đồ ERD Database MySQL</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                    {activeRun?.stats.tablesCount || 0} bảng
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('architecture')}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-between transition ${
                    activeTab === 'architecture'
                      ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Kiến trúc tổng thể (FE → BE → DB)</span>
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('code_search')}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-between transition ${
                    activeTab === 'code_search'
                      ? 'bg-purple-500/20 border-purple-500/60 text-purple-200'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Truy vết từ Code → Sơ đồ</span>
                  </span>
                </button>
              </div>
            </div>

            {/* Analysis Progress Stages & Security Policy Box */}
            {activeRun && (
              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                  <span>Tiến trình 6 bước phân tích</span>
                  <span className="text-[10px] text-emerald-400">100%</span>
                </div>
                <div className="space-y-1">
                  {activeRun.stages.map((st) => (
                    <div key={st.stage} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        {st.stage}. {st.name}
                      </span>
                      <span className="text-slate-500 font-mono text-[10px]">{st.detail}</span>
                    </div>
                  ))}
                </div>
                {activeRun.warnings.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 text-[11px] text-amber-300 space-y-1">
                    <div className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Cảnh báo ({activeRun.warnings.length}):
                    </div>
                    {activeRun.warnings.map((w, i) => (
                      <p key={i} className="text-[10px] text-amber-200/80 leading-normal">
                        • {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER WORKSPACE: Diagram Tabs, Editor Toolbar & Canvas */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#070b12]">
          {/* Diagram Type Switcher & Editing Toolbar */}
          <div className="h-12 px-4 border-b border-slate-800/90 bg-slate-950/80 flex items-center justify-between gap-2 shrink-0">
            {/* View Mode Tabs */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => {
                  setActiveTab('flowchart');
                  if (activeProject && activeRun && activeFlow) {
                    loadFlowDiagram(activeProject, activeRun.id, activeFlow.id);
                  }
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  activeTab === 'flowchart'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                1. Flowchart (Luồng xử lý)
              </button>
              <button
                onClick={() => setActiveTab('sequence')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  activeTab === 'sequence'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                2. Sequence Diagram
              </button>
              <button
                onClick={loadErdDiagram}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  activeTab === 'erd'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                3. ERD (MySQL Schema)
              </button>
              <button
                onClick={() => setActiveTab('architecture')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  activeTab === 'architecture'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                4. Kiến trúc tổng thể
              </button>
              <button
                onClick={() => setActiveTab('code_search')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  activeTab === 'code_search'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                5. Truy vết Code → Sơ đồ
              </button>
            </div>

            {/* Interactive Canvas Controls (Section 8.1) */}
            {(activeTab === 'flowchart' || activeTab === 'erd') && (
              <div className="flex items-center gap-1.5">
                {/* Version Selector */}
                {activeDiagram && activeDiagram.versions.length > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
                    <History className="w-3.5 h-3.5 text-indigo-400" />
                    <select
                      value={activeVersionNum}
                      onChange={(e) => {
                        const vNum = Number(e.target.value);
                        const ver = activeDiagram.versions.find((v) => v.versionNumber === vNum);
                        if (ver) {
                          setActiveVersionNum(vNum);
                          setNodes(ver.nodes);
                          setEdges(ver.edges);
                        }
                      }}
                      className="bg-transparent text-xs focus:outline-none"
                    >
                      {activeDiagram.versions.map((v) => (
                        <option key={v.id} value={v.versionNumber} className="bg-slate-900">
                          v{v.versionNumber}: {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={() => setShowAddNodeModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs flex items-center gap-1 transition"
                  title="Thêm node thủ công (Được đánh dấu Manual)"
                >
                  <Plus className="w-3.5 h-3.5 text-purple-400" />
                  <span>Thêm Node</span>
                </button>

                <button
                  onClick={() => setDirection(direction === 'TB' ? 'LR' : 'TB')}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs flex items-center gap-1 transition"
                  title="Đổi hướng hiển thị TB / LR"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{direction === 'TB' ? 'Dọc (TB)' : 'Ngang (LR)'}</span>
                </button>

                {nodes.some((n) => n.isHidden) && (
                  <button
                    onClick={handleShowAllHiddenNodes}
                    className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> Hiện node ẩn
                  </button>
                )}

                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 disabled:opacity-40"
                  title="Undo"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= historyStack.length - 1}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 disabled:opacity-40"
                  title="Redo"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleSaveDiagramVersion}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1 transition"
                  title="Lưu thành phiên bản sơ đồ mới (Không ghi đè bản gốc)"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Lưu Version</span>
                </button>
              </div>
            )}
          </div>

          {/* Active Diagram Banner */}
          {activeFlow && (activeTab === 'flowchart' || activeTab === 'sequence') && (
            <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/70 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 truncate">
                <span className="font-semibold text-slate-200">{activeFlow.name}</span>
                <span className="text-slate-500">—</span>
                <span className="text-slate-400 truncate">{activeFlow.description}</span>
              </div>
              <span className="text-[11px] text-cyan-400 shrink-0 font-mono">
                Click vào node để xem source code →
              </span>
            </div>
          )}

          {/* MAIN VIEW CONTENT */}
          <div className="flex-1 relative overflow-hidden">
            {(activeTab === 'flowchart' || activeTab === 'erd') && (
              <InteractiveFlowCanvas
                nodesData={nodes}
                edgesData={edges}
                direction={direction}
                selectedNodeId={selectedNode?.id || null}
                onSelectNode={(n) => setSelectedNode(n)}
                onGraphChange={pushGraphState}
              />
            )}

            {activeTab === 'sequence' && (
              <div className="w-full h-full flex flex-col">
                <div className="flex-1 overflow-auto">
                  <MermaidViewer code={currentMermaidCode} idSuffix="seq" />
                </div>
                {/* Quick clickable chips below sequence diagram to inspect any participant's source code */}
                <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2 overflow-x-auto">
                  <span className="text-xs text-slate-400 shrink-0">
                    Truy vết các bước trong Sequence Diagram:
                  </span>
                  {nodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setSelectedNode(n)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono border shrink-0 transition ${
                        selectedNode?.id === n.id
                          ? 'bg-indigo-600 text-white border-indigo-400'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'architecture' && (
              <MermaidViewer code={architectureMermaidCode} idSuffix="arch" />
            )}

            {/* SECTION 7.3: TRACE FROM CODE TO DIAGRAM */}
            {activeTab === 'code_search' && activeRun && (
              <div className="w-full h-full flex overflow-hidden bg-[#0a0f1a]">
                {/* File Tree & Function Filter */}
                <div className="w-80 border-r border-slate-800 p-4 flex flex-col gap-3 overflow-y-auto">
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-cyan-400" />
                    <span>Tìm File hoặc Function</span>
                  </h3>
                  <input
                    type="text"
                    value={codeTraceQuery}
                    onChange={(e) => setCodeTraceQuery(e.target.value)}
                    placeholder="Nhập tên hàm, class, bảng, file..."
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-indigo-500"
                  />

                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mt-1">
                    Danh sách File trong Project ({Object.keys(activeRun.sourceFiles).length})
                  </div>
                  <div className="space-y-1 flex-1 overflow-y-auto">
                    {Object.keys(activeRun.sourceFiles).map((filePath) => (
                      <button
                        key={filePath}
                        onClick={() => {
                          setSelectedFileInExplorer(filePath);
                          setCodeTraceQuery('');
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono truncate transition ${
                          selectedFileInExplorer === filePath
                            ? 'bg-indigo-600/25 text-cyan-300 border border-indigo-500/40'
                            : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                        }`}
                      >
                        {filePath}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Traceability Results for Selected File / Query */}
                <div className="flex-1 p-6 overflow-y-auto space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Kết quả truy vết Code → Sơ đồ ({traceSymbolsMatchingCode.length} thành phần)
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Hiển thị các sơ đồ có chứa file/function này, các thành phần gọi đến nó, được nó gọi, các API và bảng MySQL liên quan.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {traceSymbolsMatchingCode.map((sym) => {
                      const containingFlows = activeRun.featureFlows.filter((f) =>
                        f.symbolIds.includes(sym.id)
                      );
                      const callers = activeRun.relations
                        .filter((r) => r.targetId === sym.id)
                        .map((r) => activeRun.symbols.find((s) => s.id === r.sourceId))
                        .filter(Boolean);
                      const callees = activeRun.relations
                        .filter((r) => r.sourceId === sym.id)
                        .map((r) => activeRun.symbols.find((s) => s.id === r.targetId))
                        .filter(Boolean);

                      return (
                        <div
                          key={sym.id}
                          className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                  {sym.layer} · {sym.category}
                                </span>
                                <h4 className="text-sm font-bold text-slate-100">{sym.label}</h4>
                              </div>
                              <p className="text-xs font-mono text-cyan-400 mt-1">
                                {sym.filePath} (Dòng {sym.startLine} → {sym.endLine})
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                if (containingFlows.length > 0 && activeProject) {
                                  setActiveTab('flowchart');
                                  loadFlowDiagram(activeProject, activeRun.id, containingFlows[0].id);
                                  setTimeout(() => {
                                    setSelectedNode({
                                      id: sym.id,
                                      symbolId: sym.id,
                                      label: sym.label,
                                      category: sym.category,
                                      layer: sym.layer,
                                      filePath: sym.filePath,
                                      startLine: sym.startLine,
                                      endLine: sym.endLine,
                                      methodName: sym.methodName,
                                      description: sym.description,
                                      confidence: sym.confidence,
                                      position: { x: 0, y: 0 },
                                      metadata: sym.metadata,
                                    });
                                  }, 80);
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shrink-0"
                            >
                              Mở trong Sơ đồ & Code Inspector
                            </button>
                          </div>

                          <p className="text-xs text-slate-300">{sym.description}</p>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80 text-xs">
                            <div>
                              <span className="text-slate-400 block mb-1 font-medium">
                                Xuất hiện trong các Sơ đồ / API:
                              </span>
                              {containingFlows.length === 0 ? (
                                <span className="text-slate-500 italic">Sơ đồ ERD / Hệ thống</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {containingFlows.map((cf) => (
                                    <span
                                      key={cf.id}
                                      className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px]"
                                    >
                                      {cf.httpMethod} {cf.endpointPath}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <span className="text-slate-400 block mb-1 font-medium">
                                Thành phần gọi đến nó ({callers.length}):
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {callers.map((c) => (
                                  <span
                                    key={c!.id}
                                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[11px]"
                                  >
                                    {c!.label}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div>
                              <span className="text-slate-400 block mb-1 font-medium">
                                Thành phần được nó gọi ({callees.length}):
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {callees.map((c) => (
                                  <span
                                    key={c!.id}
                                    className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[11px]"
                                  >
                                    {c!.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* RIGHT SIDEBAR: CODE INSPECTOR & TRACEABILITY PANEL (Section 7.2) */}
        <aside className="w-96 shrink-0">
          {activeRun && (
            <CodeInspectorPanel
              selectedNode={selectedNode}
              activeRun={activeRun}
              allNodes={nodes}
              allEdges={edges}
              onSelectNodeById={(id) => {
                const target = nodes.find((n) => n.id === id) || null;
                setSelectedNode(target);
              }}
              onUpdateNode={(updated) => {
                const nextNodes = nodes.map((n) => (n.id === updated.id ? updated : n));
                pushGraphState(nextNodes, edges);
                setSelectedNode(updated.isHidden ? null : updated);
              }}
              onDeleteNode={(nodeId) => {
                const nextNodes = nodes.filter((n) => n.id !== nodeId);
                const nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
                pushGraphState(nextNodes, nextEdges);
                setSelectedNode(null);
                notify('Đã xóa node khỏi sơ đồ hiện tại.');
              }}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </aside>
      </div>

      {/* MODAL 1: CREATE PROJECT / UPLOAD ZIP / LOCAL PATH */}
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#0e1526] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-400" />
                <span>Tạo Project & Phân tích Source Code</span>
              </h3>
              <button
                onClick={() => setShowNewProjectModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-900 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setUploadMode('zip')}
                  className={`py-2 rounded-lg font-medium transition ${
                    uploadMode === 'zip'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Phương thức 1: Upload File ZIP
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('local')}
                  className={`py-2 rounded-lg font-medium transition ${
                    uploadMode === 'local'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Phương thức 2: Đường dẫn Thư mục
                </button>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Tên dự án (Project Name)</label>
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="VD: E-Commerce Laravel + Vue"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Mô tả dự án</label>
                <input
                  type="text"
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  placeholder="Mô tả ngắn gọn về hệ thống..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {uploadMode === 'zip' ? (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Chọn file ZIP Source Code (Laravel / Vue / Nuxt / MySQL)
                  </label>
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Đường dẫn thư mục Source Code trên máy
                  </label>
                  <input
                    type="text"
                    value={newProjLocalPath}
                    onChange={(e) => setNewProjLocalPath(e.target.value)}
                    placeholder="VD: c:\vinhnq\diagram-AI\sample-projects\sharespend"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-[11px] text-emerald-200 space-y-1">
                <div className="font-semibold">Cam kết bảo mật theo Đặc tả Mục 5.2 & 14.1:</div>
                <p>• Tự động bỏ qua thư mục <code className="text-emerald-300">node_modules, vendor, dist, .git</code>.</p>
                <p>• Tuyệt đối không đọc các file <code className="text-emerald-300">.env, private key, credential, secret</code>.</p>
                <p>• Chỉ phân tích cú pháp tĩnh (Static AST/Regex), không thực thi code của người dùng.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewProjectModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isAnalyzing}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isAnalyzing ? 'Đang phân tích...' : 'Bắt đầu phân tích'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD MANUAL NODE (Section 8.1 & 8.2) */}
      {showAddNodeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0e1526] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Thêm Node Thủ công vào Sơ đồ</h3>
              <button onClick={() => setShowAddNodeModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddManualNode} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Tên thành phần (Node Label)</label>
                <input
                  type="text"
                  required
                  value={manualNodeLabel}
                  onChange={(e) => setManualNodeLabel(e.target.value)}
                  placeholder="VD: Redis Cache / External Payment Gateway"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Phân lớp (Layer)</label>
                <select
                  value={manualNodeLayer}
                  onChange={(e) => setManualNodeLayer(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                >
                  <option value="frontend">Frontend</option>
                  <option value="backend">Backend</option>
                  <option value="database">Database</option>
                  <option value="external">External Service / Manual</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Mô tả chi tiết</label>
                <textarea
                  rows={3}
                  value={manualNodeDesc}
                  onChange={(e) => setManualNodeDesc(e.target.value)}
                  placeholder="Ghi chú vai trò của thành phần này..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <p className="text-[11px] text-purple-300 bg-purple-950/40 border border-purple-800/40 p-2.5 rounded-lg">
                Quy tắc 8.2: Node thêm thủ công sẽ được gắn nhãn <strong>Manual</strong> để phân biệt rõ với các node được trích xuất từ source code gốc.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddNodeModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
                >
                  Thêm vào Canvas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EXPORT DIAGRAM (Section 9: SVG, Mermaid, PlantUML, JSON) */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#0e1526] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Xuất Sơ đồ (Export SVG, Mermaid, PlantUML, JSON)</span>
              </h3>
              <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  onClick={handleExportSvg}
                  className="p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-center space-y-1 transition"
                >
                  <div className="font-bold text-emerald-400 text-sm">SVG Vector</div>
                  <div className="text-[11px] text-slate-400">Tải file ảnh .svg</div>
                </button>
                <button
                  onClick={() =>
                    downloadFile(
                      currentMermaidCode,
                      `${activeFlow?.id || 'diagram'}.mmd`,
                      'text/plain'
                    )
                  }
                  className="p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-center space-y-1 transition"
                >
                  <div className="font-bold text-cyan-400 text-sm">Mermaid (.mmd)</div>
                  <div className="text-[11px] text-slate-400">Nhúng Markdown/GitHub</div>
                </button>
                <button
                  onClick={() =>
                    downloadFile(
                      currentPlantUmlCode,
                      `${activeFlow?.id || 'diagram'}.puml`,
                      'text/plain'
                    )
                  }
                  className="p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-center space-y-1 transition"
                >
                  <div className="font-bold text-amber-400 text-sm">PlantUML (.puml)</div>
                  <div className="text-[11px] text-slate-400">Chuẩn tài liệu kỹ thuật</div>
                </button>
                <button
                  onClick={() =>
                    downloadFile(
                      JSON.stringify({ flow: activeFlow, nodes, edges }, null, 2),
                      `${activeFlow?.id || 'diagram'}.json`,
                      'application/json'
                    )
                  }
                  className="p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-center space-y-1 transition"
                >
                  <div className="font-bold text-purple-400 text-sm">JSON Graph</div>
                  <div className="text-[11px] text-slate-400">Đầy đủ metadata & code</div>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-slate-300">Mã nguồn Mermaid sinh tự động:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentMermaidCode);
                      notify('Đã copy mã Mermaid vào clipboard!');
                    }}
                    className="text-cyan-400 hover:underline"
                  >
                    Copy Mermaid
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 max-h-48 overflow-auto">
                  {currentMermaidCode}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: SHARE DIAGRAM WITH PRIVATE/PUBLIC PERMISSION (Section 9) */}
      {showShareModal && activeDiagram && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0e1526] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-cyan-400" />
                <span>Chia sẻ & Quyền truy cập Sơ đồ</span>
              </h3>
              <button onClick={() => setShowShareModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-2">
                <label className="block text-slate-300 font-medium">Chế độ quyền truy cập (Mặc định: Private)</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      if (!activeProject) return;
                      const res = await fetch('/api/projects', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'save_diagram_version',
                          projectId: activeProject.id,
                          diagramId: activeDiagram.id,
                          nodes,
                          edges,
                          visibility: 'Private',
                        }),
                      });
                      const data = await res.json();
                      if (data.project) {
                        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
                        notify('Đã chuyển sơ đồ sang chế độ Private.');
                      }
                    }}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                      activeDiagram.visibility === 'Private'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Lock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Private</div>
                      <div className="text-[10px] text-slate-400">Chỉ chủ sở hữu project được xem</div>
                    </div>
                  </button>

                  <button
                    onClick={async () => {
                      if (!activeProject) return;
                      const res = await fetch('/api/projects', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'save_diagram_version',
                          projectId: activeProject.id,
                          diagramId: activeDiagram.id,
                          nodes,
                          edges,
                          visibility: 'Public',
                        }),
                      });
                      const data = await res.json();
                      if (data.project) {
                        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
                        notify('Đã bật chia sẻ Public link cho sơ đồ.');
                      }
                    }}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                      activeDiagram.visibility === 'Public'
                        ? 'bg-emerald-600/20 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Globe className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Public Link</div>
                      <div className="text-[10px] text-slate-400">Bất kỳ ai có link đều xem được</div>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Đường dẫn chia sẻ sơ đồ:</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`https://codeflow.local/share/${activeDiagram.shareToken}`}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-300"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `https://codeflow.local/share/${activeDiagram.shareToken}`
                      );
                      notify('Đã copy link chia sẻ!');
                    }}
                    className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
