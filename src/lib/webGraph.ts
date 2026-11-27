import ts from 'typescript';
import type { CodeSymbol, CodeRelation } from '@/types/codeflow';

const httpMethods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']);
type Imported = { spec: string; member: string };
type Script = { ast: ts.SourceFile; module: CodeSymbol; imports: Map<string, Imported>; exports: Map<string, string>; routers: Set<string> };
type Endpoint = { module: CodeSymbol; line: number; end: number; snippet: string; method: string; path: string; handlers: CodeSymbol[]; router?: string };
type RequestSite = { caller: CodeSymbol; method: string; path: string; line: number };

function literal(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function requirePath(node: ts.Node | undefined) {
  return node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
    ? literal(node.arguments[0]) : undefined;
}

function defaultLocal(script: Script, value: ts.Expression) {
  if (ts.isIdentifier(value)) script.exports.set('default', value.text);
  if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) script.exports.set('default', value.name?.getText() ?? 'default');
}

function readBindings(script: Script) {
  for (const stmt of script.ast.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = literal(stmt.moduleSpecifier);
      const clause = stmt.importClause;
      if (!spec || !clause || clause.isTypeOnly) continue;
      if (clause.name) script.imports.set(clause.name.text, { spec, member: 'default' });
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) script.imports.set(named.name.text, { spec, member: '*' });
      if (named && ts.isNamedImports(named)) {
        for (const e of named.elements) if (!e.isTypeOnly) script.imports.set(e.name.text, { spec, member: (e.propertyName ?? e.name).text });
      }
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        const expr = d.initializer;
        const member = expr && ts.isPropertyAccessExpression(expr) ? expr : undefined;
        const spec = requirePath(member?.expression ?? expr);
        if (!spec) continue;
        if (ts.isIdentifier(d.name)) script.imports.set(d.name.text, { spec, member: member?.name.text ?? '*' });
        if (ts.isObjectBindingPattern(d.name)) for (const e of d.name.elements) {
          if (ts.isIdentifier(e.name)) script.imports.set(e.name.text, { spec, member: (e.propertyName ?? e.name).getText(script.ast) });
        }
      }
    }
    if (ts.isExportAssignment(stmt)) defaultLocal(script, stmt.expression);
    if (ts.isFunctionDeclaration(stmt) && ts.getModifiers(stmt)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      script.exports.set('default', stmt.name?.text ?? 'default');
    }
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const e of stmt.exportClause.elements) script.exports.set(e.name.text, (e.propertyName ?? e.name).text);
    }
    if (ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && stmt.expression.left.getText(script.ast) === 'module.exports') {
      defaultLocal(script, stmt.expression.right);
    }
  }
}

function packageBinding(script: Script, expr: ts.Expression, pkg: string): string | undefined {
  if (requirePath(expr) === pkg) return 'default';
  if (ts.isIdentifier(expr)) {
    const imported = script.imports.get(expr.text);
    if (imported?.spec === pkg) return imported.member;
  }
  if (ts.isPropertyAccessExpression(expr) && ['default', '*'].includes(packageBinding(script, expr.expression, pkg) ?? '')) return expr.name.text;
}

function nextPath(filePath: string) {
  const match = /(?:^|\/)app\/(.*\/)?route\.[cm]?[jt]sx?$/i.exec(filePath);
  if (!match) return undefined;
  const parts = (match[1] || '').split('/').filter(p => p && !/^\(.*\)$/.test(p));
  if (parts.some(p => p.startsWith('@') || p.startsWith('_') || p.startsWith('('))) return undefined;
  return '/' + parts.join('/');
}

function clientPath(node: ts.Expression | undefined) {
  if (node && ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(span => '{}' + span.literal.text).join('');
  }
  return literal(node);
}

function fetchMethod(options: ts.Expression | undefined) {
  if (!options) return 'GET';
  if (!ts.isObjectLiteralExpression(options)) return undefined;
  let method: string | undefined = 'GET';
  for (const p of options.properties) {
    if (ts.isSpreadAssignment(p) || ts.isComputedPropertyName(p.name)) method = undefined;
    else if (p.name.getText().replace(/['"]/g, '') === 'method') method = ts.isPropertyAssignment(p) ? literal(p.initializer)?.toUpperCase() : undefined;
  }
  return method;
}

function normalize(path: string) {
  return path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

function matchesPath(route: string, request: string) {
  const routeParts = normalize(route).split('/');
  const requestParts = normalize(request).split('/');
  return routeParts.length === requestParts.length && routeParts.every((part, i) =>
    part === requestParts[i] || (!!requestParts[i] && /^(?:\{[^/]+\}|:\w+|\[(?!\.)[^\]]+\]|<[^>]+>)$/.test(part)));
}

function pythonRoutes(module: CodeSymbol, source: string, functions: CodeSymbol[], frameworks: Set<string>): Endpoint[] {
  // Preserve line numbers while excluding commented decorators and docstrings.
  const text = source.replace(/("""|''')[\s\S]*?(?:\1|$)|#[^\n]*$|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/gm,
    token => token.startsWith('#') || /^(?:"""|''')/.test(token) ? token.replace(/[^\n]/g, ' ') : token);
  const factories = new Map<string, string>();
  for (const m of text.matchAll(/^\s*from\s+(fastapi|flask)\s+import\s+(\([^)]*\)|[^\n]+)/gm)) {
    for (const item of m[2].replace(/[()]/g, '').split(',')) {
      const entry = item.trim().match(/^(FastAPI|APIRouter|Flask|Blueprint)(?:\s+as\s+(\w+))?$/);
      if (entry) factories.set(entry[2] || entry[1], m[1]);
    }
  }
  for (const m of text.matchAll(/^\s*import\s+(fastapi|flask)(?:\s+as\s+(\w+))?/gm)) {
    for (const name of m[1] === 'fastapi' ? ['FastAPI', 'APIRouter'] : ['Flask', 'Blueprint']) factories.set((m[2] || m[1]) + '.' + name, m[1]);
  }
  if (!factories.size) return [];
  const instances = new Map<string, { framework: string; prefix: string }>();
  for (const m of text.matchAll(/^[ \t]*(\w+)\s*(?::[^=\n]+)?=\s*([\w.]+)\s*\(([^)]*)\)/gm)) {
    const framework = factories.get(m[2]);
    if (!framework) continue;
    const prefix = m[3].match(/\b(?:url_prefix|prefix)\s*=\s*['"]([^'"]*)['"]/);
    if (!prefix && /\b(?:url_prefix|prefix)\s*=/.test(m[3])) continue;
    instances.set(m[1], { framework, prefix: prefix?.[1] || '' });
  }
  const endpoints: Endpoint[] = [];
  const lines = text.split('\n');
  for (const fn of functions) {
    let end = fn.startLine - 2;
    while (end >= 0) {
      if (!lines[end].trim()) { end--; continue; }
      let start = end;
      if (lines[end].trimEnd().endsWith(')')) {
        while (start > 0 && !/^\s*@/.test(lines[start]) && !/^\s*(?:async\s+)?(?:def|class)\s/.test(lines[start])) start--;
      }
      if (!/^\s*@/.test(lines[start])) break;
      const decorator = lines.slice(start, end + 1).join('\n').trim();
      const match = decorator.match(/^@(\w+)\.(\w+)\(\s*(?:path\s*=\s*|rule\s*=\s*)?['"]([^'"]+)['"]([\s\S]*)\)$/);
      const instance = match && instances.get(match[1]);
      if (match && instance) {
        let methods = [match[2].toUpperCase()];
        if (['route', 'api_route'].includes(match[2])) {
          const list = match[4].match(/\bmethods\s*=\s*[\[(]([^\])]+)[\])]/i);
          methods = list ? [...list[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map(m => m[1].toUpperCase()) :
            /\bmethods\s*=/.test(match[4]) ? [] : ['GET'];
        }
        for (const method of methods.filter(m => httpMethods.has(m))) {
          frameworks.add(instance.framework === 'fastapi' ? 'FastAPI' : 'Flask');
          endpoints.push({ module, line: start + 1, end: end + 1, snippet: decorator, method,
            path: instance.prefix + match[3], handlers: [fn] });
        }
      }
      end = start - 1;
    }
  }
  return endpoints;
}

export function buildWebGraph(files: Record<string, string>, functions: CodeSymbol[], modules: CodeSymbol[],
  importRelations: CodeRelation[], legacyRoutes: CodeSymbol[], legacySymbols: CodeSymbol[]) {
  const symbols: CodeSymbol[] = [], relations: CodeRelation[] = [];
  const frameworks = new Set<string>();
  const byFile = new Map<string, CodeSymbol[]>();
  const byId = new Map(functions.map(f => [f.id, f]));
  for (const fn of functions) {
    const list = byFile.get(fn.filePath) ?? [];
    list.push(fn);
    byFile.set(fn.filePath, list);
  }
  const endpoints: Endpoint[] = [], requests: RequestSite[] = [];
  const scripts = new Map<string, Script>();
  for (const module of modules) {
    const file = module.filePath;
    let text = files[file];
    if (/\.pyw?$/i.test(file)) endpoints.push(...pythonRoutes(module, text, byFile.get(file) ?? [], frameworks));
    if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file) || /\.d\.[cm]?ts$/i.test(file)) continue;
    if (/\.(?:vue|svelte)$/i.test(file)) {
      text = text.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)|[\s\S]+?(?=<script\b|$)/gi,
        (whole, open, code, close) => open ? open.replace(/[^\r\n]/g, ' ') + code + close.replace(/[^\r\n]/g, ' ') : whole.replace(/[^\r\n]/g, ' '));
    }
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const script: Script = { ast, module, imports: new Map(), exports: new Map(), routers: new Set() };
    readBindings(script);
    for (const stmt of ast.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isCallExpression(d.initializer)) continue;
        const member = packageBinding(script, d.initializer.expression, 'express');
        if (member === 'default' || member === '*' || member === 'Router') script.routers.add(d.name.text);
      }
    }
    scripts.set(module.id, script);
  }

  const imports = new Map<string, Script>();
  for (const r of importRelations) {
    const target = scripts.get(r.targetId);
    if (r.type === 'imports' && r.importPath && target) imports.set(JSON.stringify([r.sourceId, r.importPath]), target);
  }
  function binding(script: Script, value: ts.Expression) {
    const parts = value.getText(script.ast).split('.');
    const imported = script.imports.get(parts[0]);
    if (!imported) return { script, name: parts.join('.') };
    const target = imports.get(JSON.stringify([script.module.id, imported.spec]));
    if (!target) return undefined;
    const name = imported.member === '*' ? parts.slice(1).join('.') || 'default' : [imported.member, ...parts.slice(1)].join('.');
    return { script: target, name: target.exports.get(name) ?? name };
  }
  function fnAt(script: Script, node: ts.Node) {
    const pos = script.ast.getLineAndCharacterOfPosition(node.getStart(script.ast));
    return byId.get('fn:' + script.module.filePath + ':' + (pos.line + 1) + ':' + (pos.character + 1));
  }
  function handler(script: Script, expr: ts.Expression) {
    const direct = fnAt(script, expr);
    if (direct) return direct;
    const target = binding(script, expr);
    if (!target) return undefined;
    const fns = byFile.get(target.script.module.filePath) ?? [];
    const named = fns.filter(f => f.methodName === target.name);
    return named.length === 1 ? named[0] : undefined;
  }

  // Compose literal app.use('/prefix', router) mounts across local modules.
  const mounts = new Map<string, { parent: string; prefix: string }[]>();
  const routerId = (script: Script, name: string) => JSON.stringify([script.module.id, name]);
  for (const script of scripts.values()) {
    const { module, ast } = script;
    const endpointPath = nextPath(module.filePath);
    function add(method: string, path: string, node: ts.Node, handlers: CodeSymbol[], router?: string) {
      endpoints.push({ module, method, path, router, handlers, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        end: ast.getLineAndCharacterOfPosition(node.end - 1).line + 1, snippet: node.getText(ast).slice(0, 2000) });
    }
    if (endpointPath) for (const stmt of ast.statements) {
      if (!ts.canHaveModifiers(stmt) || !ts.getModifiers(stmt)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const declared = ts.isFunctionDeclaration(stmt) && stmt.name ? [{ name: stmt.name.text, fn: fnAt(script, stmt) }] :
        ts.isVariableStatement(stmt) ? stmt.declarationList.declarations.filter(d => !!d.initializer)
          .map(d => ({ name: d.name.getText(ast), fn: handler(script, d.initializer!) })) : [];
      for (const item of declared) if (httpMethods.has(item.name) && item.fn) {
        frameworks.add('Next.js');
        add(item.name, endpointPath, stmt, [item.fn]);
      }
    }
    function visit(node: ts.Node, caller: CodeSymbol) {
      if (ts.isFunctionLike(node)) caller = fnAt(script, node) ?? caller;
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && script.routers.has(expr.expression.text)) {
          const owner = routerId(script, expr.expression.text);
          const path = literal(node.arguments[0]);
          const method = expr.name.text.toUpperCase();
          if (expr.name.text === 'use') {
            const middlewares = path === undefined ? node.arguments : node.arguments.slice(1);
            for (const middleware of middlewares) {
              const target = binding(script, middleware);
              if (!target?.script.routers.has(target.name)) continue;
              const key = routerId(target.script, target.name);
              const list = mounts.get(key) ?? [];
              list.push({ parent: owner, prefix: path ?? '' });
              mounts.set(key, list);
            }
          } else if (path?.startsWith('/') && httpMethods.has(method) && node.arguments.length > 1) {
            frameworks.add('Node.js / Express');
            const handlers = node.arguments.slice(1).map(arg => handler(script, arg)).filter((f): f is CodeSymbol => !!f);
            add(method, path, node, handlers, owner);
          }
        }
        const fetch = ts.isIdentifier(expr) && expr.text === 'fetch';
        const axios = ts.isPropertyAccessExpression(expr) && packageBinding(script, expr.expression, 'axios') !== undefined;
        if (fetch || axios) {
          const path = clientPath(node.arguments[0]);
          const method = fetch ? fetchMethod(node.arguments[1]) : (expr as ts.PropertyAccessExpression).name.text.toUpperCase();
          if (path?.startsWith('/') && !path.startsWith('//') && method && httpMethods.has(method)) {
            requests.push({ caller, method, path, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
          }
        }
      }
      ts.forEachChild(node, child => visit(child, caller));
    }
    visit(ast, module);
  }

  function prefixes(key: string | undefined, stack = new Set<string>()): string[] {
    if (!key || !mounts.has(key)) return [''];
    if (stack.has(key)) return [];
    stack.add(key);
    const result = mounts.get(key)!.flatMap(mount => prefixes(mount.parent, stack).map(p => p + mount.prefix.replace(/\/$/, '')));
    stack.delete(key);
    return [...new Set(result)];
  }
  const edges = new Set<string>();
  function connect(source: CodeSymbol, target: CodeSymbol, type: 'calls' | 'requests', label: string, line: number, inferred: boolean) {
    const id = 'http:' + JSON.stringify([source.id, target.id, type]);
    if (edges.has(id)) return;
    edges.add(id);
    relations.push({ id, sourceId: source.id, targetId: target.id, type, label,
      confidence: inferred ? 'Inferred' : 'Verified', evidence: source.filePath + ':' + line + ' — ' + label });
  }
  for (const e of endpoints) for (const prefix of prefixes(e.router)) {
    const path = prefix + e.path, label = e.method + ' ' + path;
    const symbol: CodeSymbol = {
      id: 'http:' + JSON.stringify([e.module.filePath, e.line, label]), name: label, label, category: 'route', layer: 'backend',
      filePath: e.module.filePath, startLine: e.line, endLine: e.end, description: 'Endpoint ' + label,
      methodName: e.method, httpMethod: e.method, endpointPath: path, confidence: 'Verified', codeSnippet: e.snippet,
    };
    symbols.push(symbol);
    for (const fn of e.handlers) connect(symbol, fn, 'calls', fn.label, e.line, false);
  }
  const routes = [...legacyRoutes, ...symbols], legacyIds = new Set(legacyRoutes.map(s => s.id));
  const clients = legacySymbols.filter(s => s.category === 'api_client');
  for (const request of requests) {
    const sameMethod = routes.filter(r => r.httpMethod === request.method && r.endpointPath);
    const exact = sameMethod.filter(r => normalize(r.endpointPath!) === normalize(request.path));
    const found = exact.length ? exact : sameMethod.filter(r => matchesPath(r.endpointPath!, request.path));
    if (found.length !== 1) continue;
    const target = found[0];
    if (legacyIds.has(target.id) && clients.some(s => s.filePath === request.caller.filePath && s.startLine <= request.line &&
        s.endLine >= request.line && s.httpMethod === request.method && normalize(s.endpointPath ?? '') === normalize(request.path))) continue;
    connect(request.caller, target, 'requests', request.method + ' ' + request.path, request.line, !exact.length);
  }
  return { symbols, relations, frameworks: [...frameworks] };
}
