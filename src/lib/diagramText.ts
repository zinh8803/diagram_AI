import type { AnalysisRun, DiagramEdgeData, DiagramNodeData, FeatureFlow } from '@/types/codeflow';

type GraphNode = Pick<DiagramNodeData, 'id' | 'label' | 'layer' | 'isHidden'>;
type GraphEdge = Pick<DiagramEdgeData, 'source' | 'target' | 'label' | 'confidence'>;

function aliases(nodes: GraphNode[]) {
  return new Map(nodes.filter(n => !n.isHidden).map((n, i) => [n.id, `n${i}`]));
}

function label(text: string) {
  // Mermaid numeric entities keep filenames and source labels inside the label grammar.
  return text.replace(/[#"&<>|;\r\n]/g, ch => /[\r\n]/.test(ch) ? ' ' : `#${ch.charCodeAt(0)};`);
}

export function generateMermaidForFlow(nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = aliases(nodes);
  const lines = ['flowchart TD'];
  for (const n of nodes) {
    if (ids.has(n.id)) lines.push(`    ${ids.get(n.id)}["${label(n.label)}"]`);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const arrow = e.confidence === 'Inferred' ? '-.->' : '-->';
    lines.push(`    ${ids.get(e.source)} ${arrow}|"${label(e.label)}"| ${ids.get(e.target)}`);
  }
  return lines.join('\n');
}

export function generatePlantUmlForFlow(title: string, nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = aliases(nodes);
  const quote = (text: string) => text.replace(/[\r\n]/g, ' ').replace(/"/g, '<U+0022>');
  const lines = ['@startuml', `title ${quote(title)}`, 'skinparam componentStyle rectangle'];
  for (const n of nodes) {
    if (ids.has(n.id)) lines.push(`component "${quote(n.label)}" as ${ids.get(n.id)} <<${n.layer}>>`);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const arrow = e.confidence === 'Inferred' ? '..>' : '-->';
    lines.push(`${ids.get(e.source)} ${arrow} ${ids.get(e.target)} : ${quote(e.label)}`);
  }
  return [...lines, '@enduml'].join('\n');
}

export function generateSequenceMermaid(flow: FeatureFlow, nodes: DiagramNodeData[], edges: DiagramEdgeData[]) {
  const ids = aliases(nodes);
  const calls = edges.filter(e => !['imports', 'defines', 'foreign_key'].includes(e.type) && ids.has(e.source) && ids.has(e.target));
  if (!calls.length) return '';
  const outgoing = new Map<string, DiagramEdgeData[]>();
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const e of calls) {
    sources.add(e.source);
    targets.add(e.target);
    const list = outgoing.get(e.source) ?? [];
    list.push(e);
    outgoing.set(e.source, list);
  }
  const lines = ['sequenceDiagram', '    autonumber'];
  for (const n of nodes) {
    if (sources.has(n.id) || targets.has(n.id)) lines.push(`    participant ${ids.get(n.id)} as ${label(n.label)}`);
  }
  const visited = new Set<string>();
  const roots = [...sources].filter(id => !targets.has(id));
  for (const root of [...roots, flow.entrySymbolId, ...sources]) {
    const stack = [...(outgoing.get(root) ?? [])].reverse();
    while (stack.length) {
      const edge = stack.pop()!;
      if (visited.has(edge.id)) continue;
      visited.add(edge.id);
      lines.push(`    ${ids.get(edge.source)}->>${ids.get(edge.target)}: ${label(edge.label)}`);
      for (const child of [...(outgoing.get(edge.target) ?? [])].reverse()) {
        if (!visited.has(child.id)) stack.push(child);
      }
    }
  }
  return lines.join('\n');
}

export function generateArchitectureMermaid(run: AnalysisRun) {
  const modules = run.symbols.filter(s => s.category === 'module');
  if (!modules.length) {
    // Older saved analyses have framework symbols only.
    return generateMermaidForFlow(run.symbols, run.relations.map(r => ({ ...r, source: r.sourceId, target: r.targetId })));
  }
  const groups = new Map<string, number>();
  const groupByModule = new Map<string, string>();
  for (const module of modules) {
    const slash = module.filePath.lastIndexOf('/');
    const folder = slash === -1 ? '.' : module.filePath.slice(0, slash);
    groups.set(folder, (groups.get(folder) ?? 0) + 1);
    groupByModule.set(module.id, folder);
  }
  const dependencies = new Map<string, Map<string, number>>();
  for (const edge of run.relations) {
    if (edge.type !== 'imports') continue;
    const source = groupByModule.get(edge.sourceId);
    const target = groupByModule.get(edge.targetId);
    if (!source || !target || source === target) continue;
    const targets = dependencies.get(source) ?? new Map<string, number>();
    targets.set(target, (targets.get(target) ?? 0) + 1);
    dependencies.set(source, targets);
  }
  return generateMermaidForFlow(
    [...groups].map(([id, count]) => ({ id, label: `${id} (${count} file)`, layer: 'source' })),
    [...dependencies].flatMap(([source, targets]) => [...targets].map(([target, count]) => ({
      source, target, label: `${count} import`, confidence: 'Verified' as const,
    })))
  );
}
