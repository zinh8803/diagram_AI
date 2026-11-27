import type { CodeSymbol } from '@/types/codeflow';
import type { CallGraphIndex } from './callGraph';

type Binding =
  | { kind: 'function'; symbol: CodeSymbol }
  | { kind: 'namespace'; scope: Scope }
  | { kind: 'import'; specifier: string; member?: string; prefix?: string[] };

interface Scope {
  name: string;
  kind: 'module' | 'class' | 'function';
  module: CodeSymbol;
  owner: CodeSymbol;
  indent: number;
  parent?: Scope;
  bindings: Map<string, Binding | null>;
}

function bind(scope: Scope, name: string, binding: Binding | null) {
  scope.bindings.set(name, scope.bindings.has(name) ? null : binding);
}

/** Preserve offsets and newlines while skipping comments, normal strings and docstrings. */
function maskLiterals(content: string): string {
  const fragments: string[] = [];
  const marker = /[#'"]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(content))) {
    fragments.push(content.slice(cursor, match.index));
    const quote = match[0];
    if (quote === '#') {
      const newline = content.indexOf('\n', match.index);
      cursor = newline === -1 ? content.length : newline;
    } else {
      const width = content.startsWith(quote.repeat(3), match.index) ? 3 : 1;
      const delimiter = quote.repeat(width);
      cursor = match.index + width;
      while (cursor < content.length) {
        if (content.startsWith(delimiter, cursor)) { cursor += width; break; }
        if (width === 1 && content[cursor] === '\n') break;
        cursor += content[cursor] === '\\' ? 2 : 1;
      }
    }
    fragments.push(content.slice(match.index, cursor).replace(/[^\n]/g, ' '));
    marker.lastIndex = cursor;
  }
  fragments.push(content.slice(cursor));
  return fragments.join('');
}

function bracketChange(code: string) {
  let depth = 0;
  for (const ch of code) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
  }
  return depth;
}

function beforeTopLevel(code: string, delimiter: string, start = 0) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (!depth && code[i] === delimiter) return i;
    depth += bracketChange(code[i]);
  }
  return code.length;
}

function recordImports(scope: Scope, statement: string) {
  const parts = statement.trim().match(/^(?:from\s+([.\w]+)\s+)?import\s+([\s\S]+)$/);
  if (!parts) return false;
  const from = parts[1];
  const list = parts[2].replace(/[()\\]/g, ' ').split(',');
  for (const item of list) {
    const match = item.trim().match(/^([.\w]+)(?:\s+as\s+(\w+))?$/);
    if (!match) continue;
    const [, path, alias] = match;
    const segments = path.split('.');
    const name = alias || segments[0];
    bind(scope, name, { kind: 'import', specifier: from || path,
      member: from ? path : undefined, prefix: from || alias ? [] : segments.slice(1) });
  }
  return true;
}

function paramNames(header: string, start: number) {
  const names: string[] = [];
  let i = start;
  while (i < header.length) {
    const end = beforeTopLevel(header, ',', i);
    const name = header.slice(i, end).match(/^\s*\**\s*([A-Za-z_]\w*)/);
    if (name) names.push(name[1]);
    i = end + 1;
  }
  return names;
}

export function analyzeIndentCalls(files: Record<string, string>, modules: CodeSymbol[], index: CallGraphIndex) {
  const roots = new Map<string, Scope>();
  const calls: { scope: Scope; path: string; line: number }[] = [];
  for (const module of modules) {
    const gdscript = /\.gd$/i.test(module.filePath);
    if (!gdscript && !/\.pyw?$/i.test(module.filePath)) continue;
    const raw = files[module.filePath].split(/\r?\n/);
    const lines = maskLiterals(raw.join('\n')).split('\n');
    const root: Scope = { kind: 'module', name: '', module, owner: module, bindings: new Map(), indent: -1 };
    roots.set(module.id, root);
    const stack = [root];
    let lastLine = 0;
    function close(indent: number) {
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        const closed = stack.pop()!;
        if (closed.kind === 'function') {
          closed.owner.endLine = lastLine;
          closed.owner.codeSnippet = raw.slice(closed.owner.startLine - 1, Math.min(lastLine, closed.owner.startLine + 24)).join('\n').slice(0, 2000);
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      let code = lines[i];
      if (!code.trim()) {
        if (raw[i].trim() && !/^\s*#/.test(raw[i])) lastLine = i + 1;
        continue;
      }
      const firstLine = i + 1;
      const leading = code.match(/^\s*/)?.[0] ?? '';
      const indent = leading.replace(/\t/g, '        ').length;
      close(indent);
      let depth = bracketChange(code);
      while ((depth > 0 || /\\\s*$/.test(lines[i])) && i + 1 < lines.length) {
        const next = lines[++i];
        code += '\n' + next;
        depth += bracketChange(next);
      }
      lastLine = i + 1;
      let scope = stack[stack.length - 1];
      const def = gdscript
        ? code.match(/^\s*(?:(?:static\s+)?(func)|(class))\s+([A-Za-z_]\w*)\b/)
        : code.match(/^\s*(?:(?:async\s+)?(def)|(class))\s+([A-Za-z_]\w*)\b/);
      let start = 0;
      if (def) {
        const parent = scope;
        const name = def[3];
        const colon = beforeTopLevel(code, ':');
        if (colon === code.length) continue;
        let owner = parent.owner;
        if (def[1]) {
          owner = index.declare(module, parent.kind === 'module' ? name : parent.name + '.' + name,
            firstLine, leading.length + 1, lastLine, '');
        }
        scope = { kind: def[1] ? 'function' : 'class', owner, name, parent, module, indent, bindings: new Map() };
        bind(parent, name, def[1] ? { kind: 'function', symbol: owner } : { kind: 'namespace', scope });
        if (def[1]) {
          const open = code.indexOf('(', def[0].length);
          const params = paramNames(code.slice(0, beforeTopLevel(code, ')', open + 1)), open + 1);
          params.forEach((p, n) => bind(scope, p, n === 0 && parent.kind === 'class' && ['self', 'cls'].includes(p)
            ? { kind: 'namespace', scope: parent } : null));
          if (gdscript) bind(scope, 'self', { kind: 'namespace', scope: parent });
        }
        stack.push(scope);
        start = colon + 1;
      }

      const body = code.slice(start);
      if (gdscript) {
        const preload = raw[firstLine - 1].match(/^\s*(?:const|var)\s+(\w+)\s*:?=\s*preload\(\s*["']([^"']+)["']\s*\)/);
        if (preload) {
          bind(scope, preload[1], { kind: 'import', specifier: preload[2] });
          continue;
        }
      }
      if (recordImports(scope, body)) continue;
      // An assignment, argument or loop target can shadow a function or import.
      const shadow = body.match(/^\s*(?:(?:async\s+)?for\s+([\w, ]+)\s+in\b|(?:(?:var|const)\s+)?([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=))/);
      for (const name of (shadow?.[1] ?? shadow?.[2] ?? '').split(',').map(s => s.trim()).filter(Boolean)) bind(scope, name, null);
      const invocation = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g;
      let match: RegExpExecArray | null;
      let line = firstLine + code.slice(0, start).split('\n').length - 1;
      let lastIndex = 0;
      while ((match = invocation.exec(body))) {
        line += body.slice(lastIndex, match.index).split('\n').length - 1;
        lastIndex = match.index;
        if (body[match.index - 1] !== '.') calls.push({ scope, path: match[1], line });
      }
    }
    close(0);
  }

  for (const { scope, path, line } of calls) {
    const [first, ...parts] = path.split('.');
    let enclosing: Scope | undefined = scope;
    while (enclosing && !enclosing.bindings.has(first)) {
      const parent: Scope | undefined = enclosing.parent;
      enclosing = enclosing.kind === 'function' && parent?.kind === 'class' ? parent.parent : parent;
    }
    if (!enclosing) continue;
    const binding = enclosing.bindings.get(first);
    const candidates = new Set<CodeSymbol>();
    function resolve(local: Binding | null | undefined, rest: string[]) {
      if (local?.kind === 'function' && !rest.length) candidates.add(local.symbol);
      if (local?.kind === 'namespace' && rest.length) resolve(local.scope.bindings.get(rest[0]), rest.slice(1));
    }
    if (binding?.kind === 'import') {
      const prefix = binding.prefix ?? [];
      if (!prefix.every((name, i) => parts[i] === name)) continue;
      for (const file of index.importedFiles(enclosing.module, binding.specifier)) {
        const root = roots.get(file.id);
        if (!root) continue;
        const rest = parts.slice(prefix.length);
        if (binding.member) {
          resolve(root.bindings.get(binding.member), rest);
          // from pkg import helpers; helpers.save() points into pkg/helpers.py
          const filename = file.filePath.split('/').pop()?.replace(/\.pyw?$/i, '');
          if (filename !== binding.member) continue;
        }
        resolve({ kind: 'namespace', scope: root }, rest);
      }
    } else {
      resolve(binding, parts);
    }
    if (candidates.size === 1) index.call(scope.owner, [...candidates][0], line, path, 'Inferred');
  }
}
