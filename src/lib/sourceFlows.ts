import type { CodeRelation, CodeSymbol, FeatureFlow } from '@/types/codeflow';

export function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// Split large views, keeping outbound edges and their destinations in the view
// that owns the source. Every input node and edge belongs to at least one view.
function partitions(symbols: CodeSymbol[]) {
  const pageSize = 60;
  if (symbols.length <= pageSize) return [{ title: '', members: symbols }];
  const directories = groupBy(symbols, s => s.filePath.slice(0, s.filePath.lastIndexOf('/') + 1) || './');
  return [...directories].flatMap(([dir, members]) => {
    const pages = [];
    for (let i = 0; i < members.length; i += pageSize) {
      const title = members.length > pageSize ? `${dir} · ${i / pageSize + 1}` : dir;
      pages.push({ title, members: members.slice(i, i + pageSize) });
    }
    return pages;
  });
}

export function buildSourceFlows(modules: CodeSymbol[], symbols: CodeSymbol[], relations: CodeRelation[], endpoints: FeatureFlow[]) {
  const flows: FeatureFlow[] = [];
  const byId = new Map(symbols.map(s => [s.id, s]));
  const imports = groupBy(relations.filter(r => r.type === 'imports'), r => r.sourceId);
  for (const { title, members } of partitions(modules)) {
    const edges = members.flatMap(s => imports.get(s.id) ?? []);
    const ids = new Set([...members.map(s => s.id), ...edges.map(e => e.targetId)]);
    flows.push({
      kind: 'modules', id: `flow:modules:${members[0].id}`,
      name: title ? `Phụ thuộc giữa các file · ${title}` : 'Phụ thuộc giữa các file',
      description: 'Mỗi nút là một file. Mũi tên chỉ từ file tham chiếu đến file nội bộ được sử dụng.',
      entrySymbolId: members[0].id, symbolIds: [...ids], relationIds: edges.map(r => r.id), warnings: [],
    });
  }

  const endpointNodes = new Set(endpoints.flatMap(flow => flow.symbolIds));
  const candidates = symbols.filter(s => s.category === 'function' || (s.category !== 'module' && !endpointNodes.has(s.id)));
  const detailFiles = new Set(candidates.map(s => s.filePath));
  const detailEdges = relations.filter(r => r.type !== 'imports' && r.type !== 'foreign_key' &&
    (detailFiles.has(byId.get(r.sourceId)?.filePath ?? '') || detailFiles.has(byId.get(r.targetId)?.filePath ?? '')));
  const neighbors = new Map<string, Set<string>>();
  for (const edge of detailEdges) {
    const a = byId.get(edge.sourceId)?.filePath;
    const b = byId.get(edge.targetId)?.filePath;
    if (!a || !b || a === b) continue;
    const left = neighbors.get(a) ?? new Set();
    const right = neighbors.get(b) ?? new Set();
    left.add(b);
    right.add(a);
    neighbors.set(a, left);
    neighbors.set(b, right);
  }
  const byFile = groupBy(candidates, s => s.filePath);
  const modulesByFile = new Map(modules.map(s => [s.filePath, s]));
  const outgoing = groupBy(detailEdges, r => r.sourceId);
  const seen = new Set<string>();
  const detailFlows: FeatureFlow[] = [];
  for (const file of byFile.keys()) {
    if (seen.has(file)) continue;
    const files = [file];
    seen.add(file);
    for (let i = 0; i < files.length; i++) {
      for (const next of neighbors.get(files[i]) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        files.push(next);
      }
    }
    const members = files.flatMap(path => [...(byFile.get(path) ?? []), ...(modulesByFile.has(path) ? [modulesByFile.get(path)!] : [])]);
    for (const part of partitions(members)) {
      const edges = part.members.flatMap(s => outgoing.get(s.id) ?? []);
      const candidates = part.members.filter(s => s.category === 'function');
      const calls = edges.filter(r => r.type === 'calls');
      const callees = new Set(calls.map(r => r.targetId));
      const callers = new Set(calls.map(r => r.sourceId));
      const root = candidates.find(s => /^(?:main|run|start)$/i.test(s.methodName ?? s.name)) ??
        candidates.find(s => callers.has(s.id) && !callees.has(s.id)) ?? candidates[0] ?? part.members[0];
      const title = part.title || root.filePath;
      const ids = new Set([...part.members.map(s => s.id), ...edges.map(r => r.targetId)]);
      detailFlows.push({
        kind: 'code', id: `flow:code:${part.members[0].id}`,
        name: calls.length ? `Lời gọi hàm · ${title}` : `Khai báo · ${title}`,
        description: `Các khai báo và quan hệ tìm thấy trong mã nguồn. ${calls.length} liên kết gọi hàm.`,
        entrySymbolId: root.id, symbolIds: [...ids], relationIds: edges.map(r => r.id), warnings: [],
      });
    }
  }
  return [...detailFlows.filter(f => f.name.startsWith('Lời gọi hàm')), ...flows, ...detailFlows.filter(f => !f.name.startsWith('Lời gọi hàm'))];
}
