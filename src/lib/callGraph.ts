import ts from 'typescript';
import type { CodeRelation, CodeSymbol, ConfidenceLevel } from '@/types/codeflow';
import { analyzeIndentCalls } from './indentCalls';
import { analyzeGoRustCalls } from './goRustCalls';

/** The resolver only exposes imports that point to files present in this snapshot. */
export interface CallGraphIndex {
  importedFiles(module: CodeSymbol, specifier: string): CodeSymbol[];
  declare(module: CodeSymbol, name: string, line: number, column: number, endLine: number, snippet: string): CodeSymbol;
  call(caller: CodeSymbol, callee: CodeSymbol, line: number, expression: string, confidence?: ConfidenceLevel): void;
}

const scriptKinds: Record<string, ts.ScriptKind> = {
  js: ts.ScriptKind.JS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX,
  ts: ts.ScriptKind.TS, mts: ts.ScriptKind.TS, cts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX,
};

function functionName(node: ts.FunctionLikeDeclaration): string | undefined {
  if (node.name && !ts.isComputedPropertyName(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && !ts.isComputedPropertyName(parent.name)) return parent.name.text;
  if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
    const method = parent.expression.name.text;
    const path = parent.arguments[0];
    if (/^(?:get|post|put|patch|delete|options|head|all|use)$/i.test(method) && path && ts.isStringLiteralLike(path)) {
      return `${method} ${path.text} callback`;
    }
  }
  if (ts.isExportAssignment(parent) || ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) return 'default';
}

function ownerName(node: ts.FunctionLikeDeclaration): string | undefined {
  const parent = ts.isPropertyAssignment(node.parent) ? node.parent.parent : node.parent;
  if (ts.isClassLike(parent)) return parent.name?.text;
  if (ts.isObjectLiteralExpression(parent) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) {
    return parent.parent.name.text;
  }
}

function analyzeScripts(files: Record<string, string>, modules: CodeSymbol[], index: CallGraphIndex, scriptAsts?: Map<string, ts.SourceFile>) {
  // Parse in memory. A project's tsconfig, plugins, dependencies and filesystem are never executed or loaded.
  const sources = new Map<string, { module: CodeSymbol; ast: ts.SourceFile }>();
  for (const module of modules) {
    const ext = module.filePath.split('.').pop()?.toLowerCase() ?? '';
    const kind = Object.hasOwn(scriptKinds, ext) ? scriptKinds[ext] : undefined;
    const parsed = scriptAsts?.get(module.filePath);
    if ((!parsed && kind === undefined) || /\.d\.[cm]?ts$/i.test(module.filePath)) continue;
    const name = '/' + module.filePath;
    sources.set(name, {
      module,
      ast: parsed ?? ts.createSourceFile(name, files[module.filePath], ts.ScriptTarget.Latest, true, kind),
    });
  }
  if (!sources.size) return;

  const program = ts.createProgram({
    rootNames: [...sources.keys()],
    options: {
      allowJs: true, allowNonTsExtensions: true, noLib: true, types: [], noEmit: true, jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext, moduleDetection: ts.ModuleDetectionKind.Force,
    },
    host: {
      getSourceFile: name => sources.get(name)?.ast,
      fileExists: name => sources.has(name),
      readFile: name => sources.get(name)?.ast.text,
      getDefaultLibFileName: () => '', getCurrentDirectory: () => '/',
      useCaseSensitiveFileNames: () => true, getCanonicalFileName: name => name, getNewLine: () => '\n',
      writeFile() {},
      resolveModuleNames(names, containingFile) {
        const from = sources.get(containingFile)?.module;
        return names.map(name => {
          const targets = from ? index.importedFiles(from, name) : [];
          if (targets.length !== 1) return undefined;
          const resolvedFileName = '/' + targets[0].filePath;
          const ext = resolvedFileName.split('.').pop()?.toLowerCase() ?? '';
          const extension = ext === 'tsx' || ext === 'jsx' ? ts.Extension.Tsx : ext === 'js' || ext === 'mjs' || ext === 'cjs' ? ts.Extension.Js : ts.Extension.Ts;
          return sources.has(resolvedFileName) ? { resolvedFileName, extension } : undefined;
        });
      },
    },
  });
  const checker = program.getTypeChecker();
  const declarations = new Map<ts.Node, CodeSymbol>();
  const calls: { caller: CodeSymbol; expression: ts.Expression; line: number; construct: boolean }[] = [];
  for (const { ast, module } of sources.values()) {
    function visit(node: ts.Node, caller?: CodeSymbol) {
      if (ts.isFunctionLike(node) && 'body' in node) {
        if (!node.body) return;
        const name = functionName(node);
        let owner: CodeSymbol | undefined;
        if (name) {
          const start = node.getStart(ast);
          const position = ast.getLineAndCharacterOfPosition(start);
          const endLine = ast.getLineAndCharacterOfPosition(node.end - 1).line + 1;
          const prefix = ownerName(node);
          owner = index.declare(module, prefix ? `${prefix}.${name}` : name, position.line + 1,
            position.character + 1, endLine, ast.text.slice(start, Math.min(start + 2000, node.end)));
          declarations.set(node, owner);
          if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isExportAssignment(node.parent)) {
            declarations.set(node.parent, owner);
          }
          if (ts.isConstructorDeclaration(node)) declarations.set(node.parent, owner);
        }
        visit(node.body, owner);
        return;
      }
      if (caller && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
        const expr = node.expression;
        if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
          calls.push({ caller, expression: expr, line: ast.getLineAndCharacterOfPosition(expr.getStart(ast)).line + 1, construct: ts.isNewExpression(node) });
        }
      }
      ts.forEachChild(node, child => visit(child, caller));
    }
    visit(ast, module);
  }

  for (const { caller, expression, line, construct } of calls) {
    const member = ts.isPropertyAccessExpression(expression);
    let target = checker.getSymbolAtLocation(member ? expression.name : expression);
    if (target && target.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(target);
    if (!target?.declarations) continue;
    const candidates = new Set(target.declarations.map(d => declarations.get(d)).filter((d): d is CodeSymbol => !!d));
    if (candidates.size !== 1) continue;
    const [callee] = candidates;
    if (construct && !callee.name.endsWith('.constructor')) continue;
    index.call(caller, callee, line, expression.getText(), member ? 'Inferred' : 'Verified');
  }
}

export function buildCallGraph(files: Record<string, string>, moduleSymbols: CodeSymbol[], importRelations: CodeRelation[], scriptAsts?: Map<string, ts.SourceFile>) {
  const symbols: CodeSymbol[] = [];
  const relations: CodeRelation[] = [];
  const modulesById = new Map(moduleSymbols.map(module => [module.id, module]));
  const imports = new Map<string, CodeSymbol[]>();
  const callEdges = new Set<string>();
  for (const relation of importRelations) {
    const target = modulesById.get(relation.targetId);
    if (!target || relation.type !== 'imports' || !relation.importPath) continue;
    const key = JSON.stringify([relation.sourceId, relation.importPath]);
    const list = imports.get(key) ?? [];
    if (!list.includes(target)) list.push(target);
    imports.set(key, list);
  }

  const index: CallGraphIndex = {
    importedFiles: (module, specifier) => imports.get(JSON.stringify([module.id, specifier])) ?? [],
    declare(module, name, startLine, column, endLine, snippet) {
      const symbol: CodeSymbol = {
        id: `fn:${module.filePath}:${startLine}:${column}`, name, label: `${name}()`,
        category: 'function', layer: module.layer, filePath: module.filePath, startLine, endLine,
        methodName: name.split('.').pop(), description: `Hàm ${name} trong ${module.filePath}.`, codeSnippet: snippet, confidence: 'Verified',
      };
      symbols.push(symbol);
      relations.push({
        id: `defines:${symbol.id}`, sourceId: module.id, targetId: symbol.id, type: 'defines',
        label: 'Định nghĩa', confidence: 'Verified', evidence: `${module.filePath}:${startLine}`,
      });
      return symbol;
    },
    call(caller, callee, line, expression, confidence = 'Verified') {
      const id = `call:${JSON.stringify([caller.id, callee.id])}`;
      if (callEdges.has(id)) return;
      callEdges.add(id);
      relations.push({ id, sourceId: caller.id, targetId: callee.id, type: 'calls',
        label: `${expression}()`, confidence, evidence: `${caller.filePath}:${line} — ${expression}()` });
    },
  };
  analyzeScripts(files, moduleSymbols, index, scriptAsts);
  analyzeIndentCalls(files, moduleSymbols, index);
  analyzeGoRustCalls(files, moduleSymbols, index);
  return { symbols, relations };
}
