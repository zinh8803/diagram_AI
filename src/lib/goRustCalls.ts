import type { CodeSymbol } from '@/types/codeflow';
import type { CallGraphIndex } from './callGraph';

interface Token { value: string; start: number; line: number; column: number; close?: number }
interface Unit {
  module: CodeSymbol;
  go: boolean;
  pkg: string;
  functions: Map<string, CodeSymbol[]>;
  imports: { alias?: string; spec: string }[];
}

// Only free functions are resolved. Receiver methods and calls through values need type information.
function tokenize(source: string, go: boolean) {
  const tokens: Token[] = [];
  const stack: number[] = [];
  const pattern = /\/\/|\/\*|\br(#{0,64})"|["'\x60]|[A-Za-z_]\w*|:=|::|[(){}[\].,;:<!=>]/g;
  let line = 1, previous = 0, lineStart = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    for (let n = previous; n < match.index; n++) {
      if (source[n] === '\n') { line++; lineStart = n + 1; }
    }
    previous = match.index;
    let value = match[0];
    if (value === '//') {
      const end = source.indexOf('\n', pattern.lastIndex);
      pattern.lastIndex = end < 0 ? source.length : end;
      continue;
    }
    if (value === '/*') {
      let depth = 1;
      let i = pattern.lastIndex;
      while (depth && i < source.length) {
        if (source.startsWith('*/', i)) { depth--; i += 2; }
        else if (!go && source.startsWith('/*', i)) { depth++; i += 2; }
        else i++;
      }
      pattern.lastIndex = i;
      continue;
    }
    if (value === '"' || value === "'" || value === '\x60' || match[1] !== undefined) {
      // A Rust lifetime such as 'ctx is an identifier, not a quoted literal.
      if (!go && value === "'" && /^[A-Za-z_]\w*(?![\w'])/.test(source.slice(pattern.lastIndex, pattern.lastIndex + 128))) continue;
      const raw = value === '\x60' || match[1] !== undefined;
      const delimiter = match[1] === undefined ? value : '"' + match[1];
      let i = pattern.lastIndex;
      while (i < source.length && !source.startsWith(delimiter, i)) i += !raw && source[i] === '\\' ? 2 : 1;
      // Keep string literals for Go import declarations, mask their contents everywhere else.
      value = go && value !== "'" ? '"' + source.slice(pattern.lastIndex, i) : '"';
      pattern.lastIndex = i + delimiter.length;
    }
    const token: Token = { value, start: match.index, line, column: match.index - lineStart + 1 };
    if (['(', '[', '{'].includes(value)) stack.push(tokens.length);
    if ([')', ']', '}'].includes(value)) {
      const start = stack.pop();
      if (start !== undefined) tokens[start].close = tokens.length;
    }
    tokens.push(token);
  }
  return tokens;
}

const word = (value?: string) => !!value && /^[A-Za-z_]\w*$/.test(value);
const add = <T>(map: Map<string, T[]>, key: string, item: T) => {
  const list = map.get(key) ?? [];
  list.push(item);
  map.set(key, list);
};

export function analyzeGoRustCalls(files: Record<string, string>, modules: CodeSymbol[], index: CallGraphIndex) {
  const units = new Map<string, Unit>();
  const packages = new Map<string, Unit[]>();
  const imported = new Map<Unit, Map<string, Unit[]>>();
  const calls: { unit: Unit; owner: CodeSymbol; name: string; qualifier?: string; line: number }[] = [];
  for (const module of modules) {
    if (!/\.(go|rs)$/.test(module.filePath)) continue;
    const go = module.filePath.endsWith('.go');
    const source = files[module.filePath];
    const tokens = tokenize(source, go);
    const v = (i: number) => tokens[i]?.value;
    const pkg = go && v(0) === 'package' ? v(1) : '';
    const unit: Unit = { module, go, pkg, functions: new Map(), imports: [] };
    units.set(module.id, unit);
    if (pkg) add(packages, module.filePath.slice(0, module.filePath.lastIndexOf('/') + 1) + pkg, unit);

    for (let i = 0; i < tokens.length; i++) {
      if (go && v(i) === 'import') {
        const grouped = v(i + 1) === '(';
        const end = grouped ? (tokens[i + 1].close ?? i + 1) : i + (v(i + 1)?.startsWith('"') ? 1 : 2);
        let alias: string | undefined;
        for (let j = i + (grouped ? 2 : 1); j <= end; j++) {
          const tok = v(j);
          if (tok?.startsWith('"')) { unit.imports.push({ spec: tok.slice(1), alias }); alias = undefined; }
          else if (word(tok) || tok === '.') alias = tok;
        }
      }
      if (!go && v(i) === 'mod' && word(v(i + 1)) && v(i + 2) === ';') unit.imports.push({ spec: v(i + 1), alias: v(i + 1) });
      if (!go && v(i) === 'use') {
        let j = i + 1;
        const parts = [v(j)];
        while (v(j + 1) === '::' && word(v(j + 2))) { parts.push(v(j + 2)); j += 2; }
        const alias = v(j + 1) === 'as' ? v(j + 2) : parts.at(-1);
        if (parts.length > 1 && (v(j + 1) === ';' || v(j + 1) === 'as')) unit.imports.push({ spec: parts.join('::'), alias });
      }
      if (v(i) === '{') { i = tokens[i].close ?? i; continue; }
      if (v(i) !== (go ? 'func' : 'fn') || !word(v(i + 1))) continue;
      const name = v(i + 1);
      let open = i + 2;
      while (open < tokens.length && !['(', '{', ';', 'fn', 'func'].includes(v(open))) open++;
      if (v(open) !== '(' || tokens[open].close === undefined) continue;
      const argsEnd = tokens[open].close!;
      let body = argsEnd + 1;
      while (body < tokens.length && !['{', ';', 'fn', 'func'].includes(v(body))) body++;
      if (v(body) !== '{' || tokens[body].close === undefined) continue;
      const end = tokens[body].close!;
      const start = tokens[i];
      const symbol = index.declare(module, name, start.line, start.column, tokens[end].line,
        source.slice(start.start, Math.min(start.start + 2000, tokens[end].start + 1)));
      add(unit.functions, name, symbol);

      const shadowed = new Set<string>();
      for (let j = open + 1; j < argsEnd; j++) if (word(v(j))) shadowed.add(v(j));
      for (let j = body + 1; j < end; j++) {
        if (['var', 'let', 'const'].includes(v(j))) shadowed.add(v(j + (v(j + 1) === 'mut' ? 2 : 1)));
        if (v(j + 1) === ':=') shadowed.add(v(j));
      }
      for (let j = body + 1; j < end; j++) {
        if (!word(v(j)) || v(j + 1) !== '(') continue;
        const qualified = ['.', '::'].includes(v(j - 1));
        const qualifier = qualified ? v(j - 2) : undefined;
        if (qualified && (!word(qualifier) || ['.', '::'].includes(v(j - 3)))) continue;
        if (!go && v(j - 1) === '.') continue;
        if (shadowed.has(qualifier || v(j))) continue;
        calls.push({ unit, owner: symbol, name: v(j), qualifier, line: tokens[j].line });
      }
      i = end;
    }
  }

  for (const unit of units.values()) {
    const bindings = new Map<string, Unit[]>();
    for (const imp of unit.imports) {
      for (const file of index.importedFiles(unit.module, imp.spec)) {
        const target = units.get(file.id);
        if (target) add(bindings, imp.alias || target.pkg, target);
      }
    }
    imported.set(unit, bindings);
  }
  function samePackage(unit: Unit) {
    const path = unit.module.filePath;
    return unit.pkg ? packages.get(path.slice(0, path.lastIndexOf('/') + 1) + unit.pkg) ?? [unit] : [unit];
  }
  for (const { unit, owner, name, qualifier, line } of calls) {
    const imports = imported.get(unit)!;
    const scope = qualifier ? imports.get(qualifier) ?? [] : samePackage(unit);
    const candidates = scope.flatMap(target => target.functions.get(name) ?? []);
    if (!unit.go && !qualifier) {
      for (const imp of unit.imports) {
        if (imp.alias !== name || !imp.spec.includes('::')) continue;
        const importedName = imp.spec.split('::').at(-1)!;
        for (const target of imports.get(name) ?? []) candidates.push(...target.functions.get(importedName) ?? []);
      }
    }
    const unique = new Set(candidates);
    if (unique.size === 1) index.call(owner, [...unique][0], line, qualifier ? qualifier + (unit.go ? '.' : '::') + name : name, 'Inferred');
  }
}
