// File names and extensions describe the source. Unknown names are still read as text.
const extensionsByLanguage: Record<string, string> = {
  JavaScript: 'js jsx mjs cjs',
  TypeScript: 'ts tsx mts cts',
  Vue: 'vue',
  Svelte: 'svelte',
  Astro: 'astro',
  Python: 'py pyw pyi pyx',
  PHP: 'php phtml inc',
  Ruby: 'rb rake gemspec ru erb',
  Java: 'java',
  Kotlin: 'kt kts',
  Scala: 'scala sc',
  Groovy: 'groovy gradle',
  Go: 'go',
  Rust: 'rs',
  C: 'c h',
  'C++': 'cpp cc cxx c++ hpp hh hxx inl',
  'C#': 'cs csx razor cshtml',
  'F#': 'fs fsi fsx',
  'Visual Basic': 'vb vbs',
  'Objective-C': 'm mm',
  Swift: 'swift',
  Dart: 'dart',
  Lua: 'lua luau',
  GDScript: 'gd',
  Godot: 'godot tscn tres gdshader',
  Shell: 'sh bash zsh fish ksh',
  PowerShell: 'ps1 psm1 psd1',
  Batch: 'cmd bat',
  Perl: 'pl pm',
  R: 'r rmd',
  Julia: 'jl',
  Elixir: 'ex exs heex',
  Erlang: 'erl hrl',
  Haskell: 'hs lhs',
  OCaml: 'ml mli',
  Clojure: 'clj cljs cljc edn',
  Zig: 'zig',
  Solidity: 'sol',
  Fortran: 'f f90 f95 f03',
  Assembly: 'asm s',
  Terraform: 'tf tfvars',
  Protobuf: 'proto',
  GraphQL: 'graphql gql',
  SQL: 'sql',
  Prisma: 'prisma',
  HTML: 'html htm xhtml',
  CSS: 'css scss sass less',
  XML: 'xml xaml csproj fsproj vbproj plist',
  JSON: 'json jsonc json5',
  YAML: 'yaml yml',
  TOML: 'toml',
  Markdown: 'md mdx markdown',
  Make: 'mk',
  CMake: 'cmake',
};

const languages = new Map<string, string>();
for (const [language, extensions] of Object.entries(extensionsByLanguage)) {
  for (const extension of extensions.split(' ')) languages.set(extension, language);
}

const namedFiles = new Map(Object.entries({
  makefile: 'Make', gnumakefile: 'Make', 'cmakelists.txt': 'CMake',
  dockerfile: 'Dockerfile', containerfile: 'Dockerfile', jenkinsfile: 'Groovy',
  rakefile: 'Ruby', gemfile: 'Ruby', podfile: 'Ruby', fastfile: 'Ruby',
  'go.mod': 'Go', 'go.work': 'Go',
}));

export function sourceLanguage(filePath: string): string | undefined {
  const name = filePath.split(/[\\/]/).pop()!.toLowerCase();
  if (/^(dockerfile|containerfile)\./.test(name)) return 'Dockerfile';
  const extension = name.lastIndexOf('.');
  return namedFiles.get(name) ?? (extension >= 0 ? languages.get(name.slice(extension + 1)) : undefined);
}

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

const ignoredDirectories = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  '.angular', '.output', '.turbo', '.cache', 'coverage', 'target', 'obj', 'pods', 'deriveddata',
  '.build', '.swiftpm', '.gradle', '.dart_tool', '.godot', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv', 'site-packages',
  '__macosx', '.idea', '.vs', '.codeflow-data', 'graphify-out', '.agents', '.gstack', '.claude', '.cursor',
  '.ssh', '.aws', '.gnupg', '.azure', '.kube', '.terraform',
]);

const ignoredNames = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'cargo.lock', 'gemfile.lock', 'poetry.lock', 'uv.lock', 'pipfile.lock', 'pubspec.lock',
  'bun.lock', 'go.sum', '.ds_store', 'thumbs.db',
]);

const sensitiveName = /^(?:\.env|\.npmrc$|\.pypirc$|\.netrc$|_netrc$|\.git-credentials$|id_(?:rsa|dsa|ecdsa|ed25519))|\.(?:pem|key|cert|pfx|p12|jks|keystore|kdbx)$|credentials\.json$|secrets?\./i;
const binaryName = /\.(?:exe|dll|so(?:\.\d+)*|dylib|a|o|obj|lib|pdb|class|py[co]|wasm|bin|jar|war|aar|apk|ttf|otf|woff2?|eot|png|jpe?g|gif|bmp|ico|webp|avif|tiff?|heic|psd|mp[34]|m4[av]|webm|ogg|wav|flac|mov|avi|pdf|zip|7z|gz|bz2|xz|rar|tar|tgz|br|zst|docx?|xlsx?|pptx?|sqlite3?|db|parquet|npy|npz|glb|fbx|blend)$/i;
const generatedName = /(?:\.min\.(?:js|css)|\.map|\.tsbuildinfo|\.log|\.pyc|\.lockb)$/i;

export function shouldSkipDirectory(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return normalized.split('/').some((part) => ignoredDirectories.has(part))
    || /(?:^|\/)(?:bootstrap\/cache|storage\/(?:app|framework|logs)|\.yarn\/(?:cache|unplugged))(?:\/|$)/.test(normalized);
}

export function shouldSkipFile(filePath: string, sizeBytes: number): { skip: boolean; reason?: string } {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const name = parts.pop()!.toLowerCase();
  if (!name || parts.includes('..') || parts[0] === '' || /^[a-z]:/i.test(filePath)) {
    return { skip: true, reason: 'Invalid source path' };
  }
  if (shouldSkipDirectory(parts.join('/'))) return { skip: true, reason: 'Ignored directory' };
  if (sensitiveName.test(name)) return { skip: true, reason: 'Security policy: sensitive/secret file skipped' };
  if (sizeBytes > MAX_SOURCE_BYTES) return { skip: true, reason: 'File exceeds 2MB limit' };
  if (binaryName.test(name) || generatedName.test(name) || ignoredNames.has(name)) {
    return { skip: true, reason: 'Binary or generated file' };
  }
  return { skip: false };
}

// Check the full content as an unrecognized extension can contain either source or binary data.
export function isSourceText(text: string): boolean {
  return !/[\x00-\x08\x0e-\x1a\x1c-\x1f\x7f]/.test(text);
}

export function decodeSource(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength > MAX_SOURCE_BYTES) return undefined;
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return isSourceText(text) ? text : undefined;
  } catch {
    return undefined;
  }
}
