import ts from 'typescript';
import type { CodeRelation, CodeSymbol } from '@/types/codeflow';

// Resolve paths in the imported project, independently of the host OS and filesystem.
function join(...parts: string[]): string {
  const result: string[] = [];
  for (const part of parts.join('/').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && result.length && result.at(-1) !== '..') result.pop();
    else result.push(part);
  }
  return result.join('/');
}

function directory(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

function ancestors(path: string): string[] {
  const dirs = [path];
  while (path) dirs.push(path = directory(path));
  return dirs;
}

function unique(paths: (string | undefined)[]) {
  const found = new Set(paths.filter((path): path is string => path !== undefined));
  return found.size === 1 ? found.values().next().value : undefined;
}

function lineOffsets(text: string) {
  const starts = [0];
  for (let pos = text.indexOf('\n'); pos >= 0; pos = text.indexOf('\n', pos + 1)) starts.push(pos + 1);
  return starts;
}

function lineAt(starts: number[], pos: number) {
  let low = 0, high = starts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= pos) low = mid + 1;
    else high = mid;
  }
  return low;
}

const scriptExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.vue', '.svelte'];
const scriptPattern = /\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/i;

function scriptText(path: string, text: string) {
  if (!/\.(?:vue|svelte)$/i.test(path)) return text;
  // Retain offsets for evidence in single-file components with multiple script blocks.
  let end = 0, result = '';
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const start = match.index! + match[0].indexOf('>') + 1;
    result += text.slice(end, start).replace(/[^\r\n]/g, ' ') + match[1];
    end = start + match[1].length;
  }
  return result;
}

function parseScript(path: string, content: string) {
  const text = scriptText(path, content);
  let kind: ts.ScriptKind | undefined;
  if (/\.(?:vue|svelte)$/i.test(path)) {
    kind = /<script\b[^>]*?\blang\s*=\s*["'](?:tsx|jsx)["']/i.test(content) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  }
  try {
    return ts.createSourceFile('/' + path, text, ts.ScriptTarget.Latest, true, kind);
  } catch (error) {
    // An excessively nested expression can exceed the parser's stack. Keep the file node.
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

function scriptImports(ast: ts.SourceFile, resolve: (spec: string) => string | undefined, link: Link) {
  const pending: ts.Node[] = [ast];
  while (pending.length) {
    const node = pending.pop()!;
    let spec: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) spec = node.moduleSpecifier;
    else if (ts.isExternalModuleReference(node)) spec = node.expression;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) spec = node.argument.literal;
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) spec = node.arguments[0];
    }
    if (spec && ts.isStringLiteralLike(spec)) link(resolve(spec.text), spec.text, spec.getStart(ast));
    ts.forEachChild(node, child => { pending.push(child); });
  }
}

type ResolveFile = (base: string, extensions?: string[], index?: string) => string | undefined;
type Link = (target: string | undefined, specifier: string, offset: number, inferred?: boolean) => void;

interface ScriptConfig {
  baseUrl?: string;
  aliases: { pattern: string; targets: string[] }[];
}

function scriptResolver(sources: Map<string, string>, resolveFile: ResolveFile) {
  const configs = new Map<string, ScriptConfig>();
  const manifests = new Map<string, { root: string; data: Record<string, unknown> }[]>();
  const reading = new Set<string>();

  function readConfig(path: string): ScriptConfig {
    const cached = configs.get(path);
    if (cached) return cached;
    const config: ScriptConfig = { aliases: [] };
    const source = sources.get(path);
    if (!source || reading.has(path)) return config;
    reading.add(path);
    const json = ts.parseConfigFileTextToJson(path, source).config;
    const root = directory(path);
    if (typeof json?.extends === 'string' && json.extends.startsWith('.')) {
      const parent = resolveFile(join(root, json.extends), ['.json']);
      if (parent) Object.assign(config, readConfig(parent));
    }
    const options = json?.compilerOptions;
    if (typeof options?.baseUrl === 'string') config.baseUrl = join(root, options.baseUrl);
    if (options?.paths && typeof options.paths === 'object') {
      config.aliases = [];
      for (const [pattern, targets] of Object.entries(options.paths)) {
        if (!Array.isArray(targets)) continue;
        config.aliases.push({
          pattern,
          targets: targets.filter((item): item is string => typeof item === 'string').map(item => join(config.baseUrl ?? root, item)),
        });
      }
      config.aliases.sort((a, b) => Number(a.pattern.includes('*')) - Number(b.pattern.includes('*'))
        || b.pattern.split('*')[0].length - a.pattern.split('*')[0].length);
    }
    reading.delete(path);
    configs.set(path, config);
    return config;
  }

  for (const [file, content] of sources) {
    if (!/(?:^|\/)package\.json$/.test(file)) continue;
    try {
      const data = JSON.parse(content);
      if (typeof data?.name !== 'string') continue;
      const packages = manifests.get(data.name) ?? [];
      packages.push({ root: directory(file), data });
      manifests.set(data.name, packages);
    } catch { /* An incomplete manifest still appears as a source file. */ }
  }

  function scriptFile(base: string) {
    const exact = resolveFile(base, scriptExtensions, 'index');
    if (exact) return exact;
    // NodeNext projects use the emitted .js extension in their TypeScript source.
    const match = /\.(mjs|cjs|jsx|js)$/.exec(base);
    if (match) {
      const substitutions: Record<string, string[]> = { mjs: ['.mts'], cjs: ['.cts'], jsx: ['.tsx'], js: ['.ts', '.tsx'] };
      return resolveFile(base.slice(0, match.index), substitutions[match[1]]);
    }
    return undefined;
  }

  const configByDirectory = new Map<string, ScriptConfig | undefined>();
  return (from: string, request: string) => {
    const spec = request.split(/[?#]/)[0];
    const dir = directory(from);
    if (/^\.{1,2}\//.test(spec)) return scriptFile(join(dir, spec));
    if (!spec || /^(?:\/|[a-z]+:)/i.test(spec)) return undefined;
    if (!configByDirectory.has(dir)) {
      let config: ScriptConfig | undefined;
      for (const ancestor of ancestors(dir)) {
        const path = ['tsconfig.json', 'jsconfig.json'].map(name => join(ancestor, name)).find(name => sources.has(name));
        if (path) { config = readConfig(path); break; }
      }
      configByDirectory.set(dir, config);
    }
    const config = configByDirectory.get(dir);
    if (config) {
      for (const { pattern, targets } of config.aliases) {
        const [prefix, suffix] = pattern.split('*');
        if (suffix === undefined ? spec !== pattern : !spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
        const star = spec.slice(prefix.length, spec.length - (suffix?.length ?? 0));
        for (const target of targets) {
          const found = scriptFile(target.replace('*', () => star));
          if (found) return found;
        }
        break;
      }
      if (config.baseUrl !== undefined) {
        const found = scriptFile(join(config.baseUrl, spec));
        if (found) return found;
      }
    }
    const name = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
    const packages = manifests.get(name);
    if (packages?.length !== 1) return undefined;
    const { root, data } = packages[0];
    const subpath = spec.slice(name.length + 1);
    const key = subpath ? './' + subpath : '.';
    if (data.exports !== undefined) {
      const exports = data.exports;
      const entry = typeof exports === 'object' && exports !== null && key in exports
        ? (exports as Record<string, unknown>)[key] : subpath ? undefined : exports;
      const targets = typeof entry === 'string' ? [entry]
        : entry && typeof entry === 'object' ? Object.values(entry).filter(value => typeof value === 'string') : [];
      return unique(targets.filter(target => target.startsWith('./')).map(target => scriptFile(join(root, target))));
    }
    if (subpath) return scriptFile(join(root, subpath));
    const entry = unique([data.module, data.main].filter((item): item is string => typeof item === 'string')
      .map(item => scriptFile(join(root, item))));
    return entry ?? scriptFile(join(root, 'index'));
  };
}

// Mask comments and multiline strings while preserving offsets and quoted import paths.
function stripComments(text: string, language: 'python' | 'slash' | 'hash') {
  const pattern = language === 'slash' ? /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/g
    : language === 'python' ? /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*/g
    : /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*/g;
  return text.replace(pattern, token => /^(?:\/\/|\/\*|#|"""|''')/.test(token) ? token.replace(/[^\r\n]/g, ' ') : token);
}

function pythonImports(file: string, content: string, roots: string[], sources: Map<string, string>, resolve: ResolveFile, link: Link) {
  const dir = directory(file);
  let pkgRoot = dir;
  while (pkgRoot && sources.has(join(pkgRoot, '__init__.py'))) pkgRoot = directory(pkgRoot);
  const bases = new Set([pkgRoot, ...roots]);
  for (const ancestor of ancestors(dir)) {
    if (['pyproject.toml', 'setup.py', 'setup.cfg', 'manage.py'].some(name => sources.has(join(ancestor, name)))) {
      bases.add(ancestor);
      bases.add(join(ancestor, 'src'));
      break;
    }
  }
  function find(spec: string) {
    const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
    const tail = spec.slice(dots).replace(/\./g, '/');
    const resolvePython = (base: string) => resolve(join(base, tail), ['.py', '.pyi'], '__init__');
    if (dots) {
      const base = ancestors(dir)[dots - 1];
      return base !== undefined ? resolvePython(base) : undefined;
    }
    return unique([...bases].map(resolvePython));
  }
  const text = stripComments(content, 'python');
  for (const match of text.matchAll(/^[\t ]*(?:from[\t ]+([.\w]+)[\t ]+import[\t ]+(\([^)]*\)|[^;\r\n]+)|import[\t ]+([^;\r\n]+))/gm)) {
    const prefix = match[1];
    const names = (match[2] ?? match[3]).replace(/[()]/g, '').split(',');
    for (const name of names) {
      const imported = name.trim().split(/\s+/)[0];
      if (!imported) continue;
      const spec = prefix ?? imported;
      let target: string | undefined;
      if (prefix && imported !== '*') target = find(prefix + (prefix.endsWith('.') ? '' : '.') + imported);
      link(target ?? find(spec), spec, match.index! + match[0].indexOf(spec));
    }
  }
}

export function buildModuleGraph(files: Record<string, string>) {
  const symbols: CodeSymbol[] = [], relations: CodeRelation[] = [];
  const scriptAsts = new Map<string, ts.SourceFile>();
  const sources = new Map<string, string>();
  const original = new Map<string, string>();
  for (const file of Object.keys(files).sort()) {
    const normalized = join(file);
    sources.set(normalized, files[file]);
    original.set(normalized, file);
  }

  const resolveFile: ResolveFile = (base, extensions = [], index) => {
    if (sources.has(base)) return base;
    const direct = extensions.map(ext => base + ext).filter(path => sources.has(path));
    if (direct.length) return unique(direct);
    if (index) return unique(extensions.map(ext => join(base, index + ext)).filter(path => sources.has(path)));
    return undefined;
  };
  const resolveScript = scriptResolver(sources, resolveFile);
  const byDirectory = new Map<string, string[]>();
  const goModules = new Map<string, string[]>();
  const qualified = new Map<string, string[]>();
  const namespaces = new Map<string, string>();
  const directories = new Set<string>();
  function typeScope(file: string) {
    return file.endsWith('.cs') ? 'dotnet:' : file.endsWith('.php') ? 'php:' : 'jvm:';
  }
  function register(index: Map<string, string[]>, key: string, file: string) {
    const items = index.get(key) ?? [];
    items.push(file);
    index.set(key, items);
  }
  for (const [file, content] of sources) {
    const dir = directory(file);
    directories.add(dir);
    if (file.endsWith('.go') && !file.endsWith('_test.go')) register(byDirectory, dir, file);
    if (/(?:^|\/)go\.mod$/.test(file)) {
      const name = /^\s*module\s+"?([^"\s]+)"?/m.exec(content)?.[1];
      if (name) register(goModules, name, dir);
    }
    if (/\.(?:java|kt|scala|cs|php)$/i.test(file)) {
      const clean = stripComments(content, 'slash');
      const ns = /(?:^|[;{\n])\s*(?:package|namespace)\s+([\w.\\]+)/m.exec(clean)?.[1]
        ?? (/\.php$/i.test(file) ? /\bnamespace\s+([\w\\]+)/.exec(clean)?.[1] : undefined);
      const namespace = ns?.replace(/\\/g, '.') ?? '';
      namespaces.set(file, namespace);
      for (const m of clean.matchAll(/\b(?:class|object|interface|enum|trait|record|struct)\s+(\w+)/g)) {
        register(qualified, typeScope(file) + (namespace ? namespace + '.' : '') + m[1], file);
      }
    }
  }

  // ZIP tools often wrap the repository in an extra directory.
  const dirList = [...directories];
  const commonRoot = ancestors(dirList[0] ?? '').find(dir => !dir || dirList.every(path => path === dir || path.startsWith(dir + '/'))) ?? '';
  const sourceRoots = [...new Set(['', commonRoot, join(commonRoot, 'src')])];
  const seen = new Set<string>();

  for (const [file, content] of sources) {
    const filePath = original.get(file)!;
    const dir = directory(file);
    const filename = file.split('/').at(-1)!;
    const id = 'module:' + filePath;
    const starts = lineOffsets(content);
    symbols.push({
      id, filePath, name: filename, label: filename, category: 'module', layer: 'source',
      startLine: 1, endLine: starts.length, confidence: 'Verified',
      description: filePath, codeSnippet: content.slice(0, Math.min(starts[16] ?? content.length, 1600)).trimEnd(),
    });
    const link: Link = (target, specifier, offset, inferred = false) => {
      if (target === undefined || target === file) return;
      const targetPath = original.get(target);
      if (!targetPath) return;
      const key = JSON.stringify([filePath, targetPath, specifier]);
      if (seen.has(key)) return;
      seen.add(key);
      const line = lineAt(starts, offset);
      const evidence = content.slice(starts[line - 1], Math.min(starts[line] ?? content.length, starts[line - 1] + 240)).trim();
      relations.push({
        id: 'dep:' + key, sourceId: id, targetId: 'module:' + targetPath, type: 'imports', label: specifier,
        confidence: inferred ? 'Inferred' : 'Verified', importPath: specifier, evidence: filePath + ':' + line + ' · ' + evidence,
      });
    };
    if (scriptPattern.test(file)) {
      const ast = parseScript(filePath, content);
      if (ast) {
        scriptAsts.set(filePath, ast);
        scriptImports(ast, spec => resolveScript(file, spec), link);
        for (const ref of ast.referencedFiles) link(resolveFile(join(dir, ref.fileName)), ref.fileName, ref.pos);
      }
    }
    if (/\.pyi?$/.test(file)) pythonImports(file, content, sourceRoots, sources, resolveFile, link);
    if (file.endsWith('.go')) {
      const clean = stripComments(content, 'slash');
      for (const block of clean.matchAll(/^\s*import\s*(\([^)]*\)|(?:[.\w]+\s+)?(?:"[^"]+"|`[^`]+`))/gm)) {
        for (const m of block[0].matchAll(/["`]([^"`]+)["`]/g)) {
          const spec = m[1];
          const prefix = [...goModules.keys()].filter(name => spec === name || spec.startsWith(name + '/')).sort((a, b) => b.length - a.length)[0];
          if (!prefix) continue;
          const root = unique(goModules.get(prefix)!);
          if (root === undefined) continue;
          const targets = byDirectory.get(join(root, spec.slice(prefix.length))) ?? [];
          for (const target of targets) link(target, spec, block.index! + m.index!, true);
        }
      }
    }
    if (/\.(?:java|kt|scala|cs|php)$/i.test(file)) {
      const clean = stripComments(content, 'slash');
      const scope = typeScope(file);
      const ns = namespaces.get(file) ?? '';
      const visibleNamespaces = new Map<string, string>([[ns, ns]]);
      const explicitTypes = new Set<string>();
      for (const m of clean.matchAll(/(?:^|[;{\n])\s*(?:import\s+(?:static\s+)?|using\s+(?:static\s+)?|use\s+)([\w.\\*]+)/gm)) {
        const name = m[1].replace(/^\\/, '').replace(/\\/g, '.');
        let target = name;
        while (target.includes('.') && !qualified.has(scope + target)) target = target.slice(0, target.lastIndexOf('.'));
        const imported = qualified.get(scope + target);
        if (imported) {
          link(unique(imported), m[1], m.index! + m[0].indexOf(m[1]));
          explicitTypes.add(target.split('.').at(-1)!);
        } else if (name.endsWith('.*') || file.endsWith('.cs')) {
          visibleNamespaces.set(name.replace(/\.\*$/, ''), m[1]);
        }
      }
      // These languages can reference types in the current package/namespace without an import.
      // A wildcard alone is insufficient evidence. Require a constructor or static method use.
      const codeOnly = clean.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, token => token.replace(/[^\r\n]/g, ' '));
      for (const use of codeOnly.matchAll(/\bnew\s+([A-Za-z_]\w*)\s*\(|(?<![.\w])([A-Za-z_]\w*)\s*(?:\.|::)\s*\w+\s*\(/g)) {
        const type = use[1] ?? use[2];
        if (explicitTypes.has(type)) continue;
        const options = [...visibleNamespaces].flatMap(([name, spec]) => {
          const paths = qualified.get(scope + (name ? name + '.' : '') + type) ?? [];
          return paths.map(path => ({ path, spec }));
        });
        if (options.length === 1) link(options[0].path, options[0].spec || type, use.index!, true);
      }
    }
    if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm)$/i.test(file)) {
      for (const m of stripComments(content, 'slash').matchAll(/^\s*#\s*(?:include|import)\s*(["<])([^">\n]+)[">]/gm)) {
        const spec = m[2];
        const local = m[1] === '"' ? resolveFile(join(dir, spec)) : undefined;
        const include = unique(ancestors(dir).flatMap(root => [resolveFile(join(root, 'include', spec)), resolveFile(join(root, spec))]));
        link(local ?? include, spec, m.index! + m[0].indexOf(spec), !local);
      }
    }
    if (file.endsWith('.rs')) {
      const clean = stripComments(content, 'slash');
      const moduleDir = /^(?:lib|main|mod)\.rs$/.test(filename) ? dir : join(dir, filename.slice(0, -3));
      const crate = ancestors(dir).find(root => sources.has(join(root, 'lib.rs')) || sources.has(join(root, 'main.rs')));
      for (const m of clean.matchAll(/\bmod\s+(\w+)\s*;/g)) {
        link(resolveFile(join(moduleDir, m[1]), ['.rs'], 'mod'), m[1], m.index!);
      }
      for (const m of clean.matchAll(/\buse\s+((?:crate|self|super)(?:::\w+)+)/g)) {
        const parts = m[1].split('::');
        let base = parts.shift() === 'crate' ? crate : m[1].startsWith('super::') ? directory(moduleDir) : moduleDir;
        while (parts[0] === 'super' && base) { parts.shift(); base = directory(base); }
        if (base === undefined) continue;
        while (parts.length) {
          const target = resolveFile(join(base, ...parts), ['.rs'], 'mod');
          if (target) { link(target, m[1], m.index!); break; }
          parts.pop();
        }
      }
    }
    if (/\.(?:gd|tscn|tres|godot)$/i.test(file)) {
      const root = ancestors(dir).find(path => sources.has(join(path, 'project.godot'))) ?? commonRoot;
      const clean = stripComments(content, 'hash');
      for (const m of clean.matchAll(/(?:\b(?:preload|load)\s*\(\s*|^\s*extends\s+|\bpath\s*=\s*|^\s*run\/main_scene\s*=\s*)["'](res:\/\/[^"'\n]+)["']/gm)) {
        link(resolveFile(join(root, m[1].slice(6))), m[1], m.index! + m[0].indexOf(m[1]));
      }
    }
    if (/\.(?:rb|rake)$/.test(file)) {
      for (const m of stripComments(content, 'hash').matchAll(/^[\t ]*(require_relative|require)\s*\(?\s*['"]([^'"\n]+)['"]/gm)) {
        const target = m[1] === 'require_relative' ? resolveFile(join(dir, m[2]), ['.rb'])
          : unique(ancestors(dir).map(root => resolveFile(join(root, 'lib', m[2]), ['.rb'])));
        link(target, m[2], m.index!);
      }
    }
    if (/\.(?:html?|vue|svelte|astro)$/i.test(file)) {
      const clean = content.replace(/<!--[\s\S]*?(?:-->|$)/g, s => s.replace(/[^\r\n]/g, ' '));
      for (const m of clean.matchAll(/<(?:script|link|iframe)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"'\n]+)["'][^>]*>/gi)) {
        const spec = m[1].split(/[?#]/)[0];
        if (spec && !/^(?:[a-z]+:|\/)/i.test(spec)) link(resolveFile(join(dir, spec)), m[1], m.index!);
      }
    }
    if (/\.(?:zig|dart|lua|sh|bash|zsh|php|css|scss|sass|less)$/i.test(file)) {
      const patterns: Record<string, RegExp> = {
        zig: /@import\(\s*"([^"\n]+)"\s*\)/g,
        dart: /^\s*(?:import|export|part)\s+['"]([^'"\n:]+)['"]/gm,
        lua: /\brequire\s*\(?\s*['"]([\w.]+)['"]/g,
        shell: /^[\t ]*(?:source|\.)\s+['"]?([.\w/-]+)['"]?(?=\s|$)/gm,
        php: /\b(?:require|include)(?:_once)?\s*\(?\s*__DIR__\s*\.\s*['"](\/[^'"\n]+)['"]/g,
        style: /@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"\n:]+)['"]/g,
      };
      const extension = filename.split('.').at(-1)!;
      const kind = /^(?:css|scss|sass|less)$/.test(extension) ? 'style' : /^(?:sh|bash|zsh)$/.test(extension) ? 'shell' : extension;
      const clean = stripComments(content, kind === 'shell' ? 'hash' : 'slash');
      for (const m of clean.matchAll(patterns[kind])) {
        const spec = m[1];
        let target: string | undefined;
        if (kind === 'lua') target = unique(sourceRoots.map(root => resolveFile(join(root, spec.replace(/\./g, '/')), ['.lua'], 'init')));
        else if (kind === 'style') {
          const base = join(dir, spec);
          const extensions = ['.css', '.scss', '.sass', '.less'];
          target = resolveFile(base, extensions) ?? resolveFile(join(directory(base), '_' + base.split('/').at(-1)), extensions);
        } else target = resolveFile(join(dir, spec));
        link(target, spec, m.index!, kind === 'shell');
      }
    }
  }
  return { symbols, relations, scriptAsts };
}
