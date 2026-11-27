import {
  AnalysisRun,
  CodeRelation,
  CodeSymbol,
  ConfidenceLevel,
  Diagram,
  DiagramEdgeData,
  DiagramNodeData,
  DiagramVersion,
  FeatureFlow,
  LayerType,
  RelationType,
  SymbolCategory,
  TableColumn,
} from '@/types/codeflow';
import { buildModuleGraph } from './moduleGraph';
import { buildCallGraph } from './callGraph';
import { buildWebGraph } from './webGraph';
import { buildSourceFlows } from './sourceFlows';
import { sourceLanguage } from './sourceFiles';
import {
  generateMermaidForFlow,
  generatePlantUmlForFlow,
  generateSequenceMermaid,
} from './diagramText';

export { generateMermaidForFlow, generatePlantUmlForFlow, generateSequenceMermaid };

const IGNORED_DIRS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
  'coverage',
  'storage',
  'bootstrap/cache',
  'graphify-out',
  '.agents',
  '.codeflow-data',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'bin',
  'obj',
]);

const SENSITIVE_PATTERNS = [
  /^\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /credentials\.json$/i,
  /secrets?\./i,
];

export function shouldSkipFile(
  filePath: string,
  sizeBytes: number
): { skip: boolean; reason?: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) {
      return { skip: true, reason: 'Ignored directory' };
    }
  }

  const fileName = parts[parts.length - 1];
  if (
    fileName === 'package-lock.json' ||
    fileName === 'pnpm-lock.yaml' ||
    fileName === 'yarn.lock' ||
    fileName === 'composer.lock' ||
    fileName.endsWith('.min.js') ||
    fileName.endsWith('.min.css') ||
    fileName.endsWith('.d.ts') ||
    fileName.endsWith('.map')
  ) {
    return { skip: true, reason: 'Lockfile or compiled bundle' };
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(fileName)) {
      return { skip: true, reason: 'Security policy: sensitive/secret file skipped' };
    }
  }

  if (sizeBytes > 3 * 1024 * 1024) {
    return { skip: true, reason: 'File exceeds 3MB limit' };
  }

  const allowedExt = /\.(php|vue|ts|tsx|js|jsx|mjs|cjs|sql|prisma|py|go|java|rb|cs|graphql|gql)$/i;
  if (!allowedExt.test(fileName)) {
    return { skip: true, reason: 'Unsupported or binary extension' };
  }

  return { skip: false };
}

function getLineRange(
  content: string,
  matchIndex: number,
  fallbackLength = 18
): { startLine: number; endLine: number; snippet: string } {
  const lines = content.split(/\r?\n/);
  const prefix = content.slice(0, matchIndex);
  const startLine = Math.max(1, prefix.split(/\r?\n/).length);

  let openBraces = 0;
  let foundFirstBrace = false;
  let endLine = Math.min(lines.length, startLine + fallbackLength);

  for (let i = startLine - 1; i < Math.min(lines.length, startLine + 80); i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') {
        openBraces++;
        foundFirstBrace = true;
      } else if (ch === '}') {
        openBraces--;
      }
    }
    if (foundFirstBrace && openBraces <= 0) {
      endLine = i + 1;
      break;
    }
  }

  const snippet = lines.slice(startLine - 1, endLine).join('\n');
  return { startLine, endLine, snippet };
}

function normalizeEndpointPath(raw: string): string {
  if (!raw) return '/';
  let p = raw.trim();
  // Remove full URL origin or template prefix like ${API_BASE_URL} or ${API_BASE}
  p = p.replace(/^https?:\/\/[^/]+/i, '');
  p = p.replace(/^\$\{[^}]+\}/, '');
  p = p.split('?')[0];
  // Convert template params `${id}` or `:id` to `{id}`
  p = p.replace(/\$\{([^}]+)\}/g, '{$1}');
  p = p.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
  if (!p.startsWith('/')) {
    p = '/' + p;
  }
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function joinUrlPaths(...segments: string[]): string {
  const joined = segments
    .filter(Boolean)
    .map((s) => s.trim())
    .join('/');
  return normalizeEndpointPath(joined);
}

/**
 * Strip common root prefix if all files in a ZIP share a top-level folder
 */
export function normalizeProjectFilePaths(rawFiles: Record<string, string>): Record<string, string> {
  const keys = Object.keys(rawFiles).map((k) => k.replace(/\\/g, '/'));
  if (keys.length === 0) return rawFiles;

  const firstSegments = new Set(
    keys.map((k) => {
      const idx = k.indexOf('/');
      return idx > 0 ? k.slice(0, idx) : '';
    })
  );

  // If every single file starts with the same top-level folder (and it's not a standard code folder)
  if (firstSegments.size === 1) {
    const commonRoot = Array.from(firstSegments)[0];
    const standardFolders = new Set(['src', 'app', 'frontend', 'backend', 'routes', 'database', 'prisma', 'components', 'pages']);
    if (commonRoot && !standardFolders.has(commonRoot.toLowerCase())) {
      const stripped: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawFiles)) {
        const norm = k.replace(/\\/g, '/');
        stripped[norm.slice(commonRoot.length + 1)] = v;
      }
      return stripped;
    }
  }

  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) {
    normalized[k.replace(/\\/g, '/')] = v;
  }
  return normalized;
}

function classifyFileLayerAndCategory(
  filePath: string,
  content: string
): { layer: LayerType; category: SymbolCategory } {
  const lower = filePath.toLowerCase();

  if (
    lower.endsWith('.sql') ||
    lower.endsWith('.prisma') ||
    lower.includes('/migrations/') ||
    lower.includes('/schema/')
  ) {
    return { layer: 'database', category: 'table' };
  }

  const isFrontendPath =
    lower.includes('frontend/') ||
    lower.includes('client/') ||
    lower.includes('web/') ||
    lower.endsWith('.vue') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.tsx');

  if (lower.endsWith('.vue') || lower.endsWith('.jsx') || lower.endsWith('.tsx')) {
    if (
      lower.includes('/pages/') ||
      lower.includes('/views/') ||
      lower.endsWith('page.tsx') ||
      lower.endsWith('page.jsx') ||
      lower.endsWith('view.vue')
    ) {
      return { layer: 'frontend', category: 'page' };
    }
    return { layer: 'frontend', category: 'component' };
  }

  if (
    isFrontendPath &&
    (lower.includes('/pages/') || lower.includes('/views/'))
  ) {
    return { layer: 'frontend', category: 'page' };
  }

  if (
    isFrontendPath &&
    (lower.includes('/components/') || lower.includes('/ui/') || lower.includes('/game/'))
  ) {
    return { layer: 'frontend', category: 'component' };
  }

  if (
    lower.includes('/composables/') ||
    lower.includes('/hooks/') ||
    lower.includes('/context/') ||
    lower.includes('/store/') ||
    lower.includes('/pinia/') ||
    lower.includes('/redux/')
  ) {
    return { layer: 'frontend', category: 'composable' };
  }

  if (
    (isFrontendPath && (lower.includes('/api/') || lower.includes('/services/') || lower.includes('api.'))) ||
    (!lower.includes('backend') && !lower.includes('controller') && /fetch\(|axios\.|request\(/i.test(content) && /export\s+const\s+\w+Api/i.test(content))
  ) {
    return { layer: 'frontend', category: 'api_client' };
  }

  if (lower.includes('/routes/') || lower.includes('routes.') || lower.includes('router.')) {
    return { layer: 'backend', category: 'route' };
  }

  if (
    lower.includes('/controllers/') ||
    lower.includes('controller.') ||
    lower.includes('/handlers/') ||
    lower.includes('.gateway.') ||
    content.includes('@Controller(') ||
    content.includes('@WebSocketGateway') ||
    content.includes('@RestController')
  ) {
    return { layer: 'backend', category: 'controller' };
  }

  if (lower.includes('/middlewares/') || lower.includes('middleware.') || lower.includes('/guards/')) {
    return { layer: 'backend', category: 'middleware' };
  }

  if (lower.includes('/requests/') || lower.includes('/dto/') || lower.includes('/validators/')) {
    return { layer: 'backend', category: 'validation' };
  }

  if (lower.includes('/jobs/') || lower.includes('/queues/') || lower.includes('/workers/')) {
    return { layer: 'backend', category: 'job' };
  }

  if (
    lower.includes('/models/') ||
    lower.includes('/entities/') ||
    lower.includes('/repositories/') ||
    lower.includes('database.service') ||
    lower.includes('/config/db') ||
    lower.includes('/config/prisma')
  ) {
    return { layer: 'backend', category: 'model' };
  }

  if (lower.includes('/services/') || lower.includes('.service.') || content.includes('@Injectable()')) {
    return { layer: isFrontendPath ? 'frontend' : 'backend', category: isFrontendPath ? 'api_client' : 'service' };
  }

  return {
    layer: isFrontendPath ? 'frontend' : 'backend',
    category: isFrontendPath ? 'component' : 'service',
  };
}

export function analyzeSourceFiles(
  projectId: string,
  versionTag: string,
  inputFiles: Record<string, string>,
  skippedCount = 0
): { run: AnalysisRun; diagrams: Diagram[] } {
  const rawFiles = normalizeProjectFilePaths(inputFiles);
  const entries = Object.entries(rawFiles);

  const symbols: CodeSymbol[] = [];
  const relations: CodeRelation[] = [];
  const warnings: string[] = [];

  const frontendFrameworks = new Set<string>();
  const backendFrameworks = new Set<string>();
  const dbEngines = new Set<string>();

  // Symbol lookup maps
  const symbolById = new Map<string, CodeSymbol>();
  const tableSymbolsByName = new Map<string, CodeSymbol>(); // exact or lowercase table name -> symbol
  const modelSymbolsByClass = new Map<string, { symbol: CodeSymbol; tableName: string }>();
  const serviceSymbolsByMethod = new Map<string, CodeSymbol>(); // ClassName.method or methodName -> symbol
  const controllerSymbolsByAction = new Map<string, CodeSymbol>(); // Controller@method or fileName.method or methodName -> symbol
  const routeSymbolsByEndpoint = new Map<string, CodeSymbol>(); // METHOD /path -> symbol
  const apiClientMethods = new Map<
    string,
    { symbol: CodeSymbol; httpMethod: string; endpointPath: string; shortName: string }
  >();
  const composableMethods = new Map<string, CodeSymbol>();
  const componentSymbolsByName = new Map<string, CodeSymbol>();
  const primarySymbolByFile = new Map<string, CodeSymbol>();

  function addSymbol(sym: CodeSymbol) {
    if (!symbolById.has(sym.id)) {
      symbolById.set(sym.id, sym);
      symbols.push(sym);
      if (!primarySymbolByFile.has(sym.filePath)) {
        primarySymbolByFile.set(sym.filePath, sym);
      }
    }
  }

  function addRelation(rel: CodeRelation) {
    if (rel.sourceId === rel.targetId) return;
    const exists = relations.some(
      (r) => r.sourceId === rel.sourceId && r.targetId === rel.targetId && r.type === rel.type
    );
    if (!exists) {
      relations.push(rel);
    }
  }

  function registerTableSymbol(tableSym: CodeSymbol) {
    addSymbol(tableSym);
    const lower = tableSym.name.toLowerCase();
    tableSymbolsByName.set(tableSym.name, tableSym);
    tableSymbolsByName.set(lower, tableSym);
    // Also register singular/plural variants for seamless matching (e.g. User -> users)
    if (lower.endsWith('ies')) {
      tableSymbolsByName.set(lower.slice(0, -3) + 'y', tableSym);
    } else if (lower.endsWith('es')) {
      tableSymbolsByName.set(lower.slice(0, -2), tableSym);
      tableSymbolsByName.set(lower.slice(0, -1), tableSym);
    } else if (lower.endsWith('s')) {
      tableSymbolsByName.set(lower.slice(0, -1), tableSym);
    } else {
      tableSymbolsByName.set(lower + 's', tableSym);
      tableSymbolsByName.set(lower + 'es', tableSym);
    }
  }

  // =========================================================================
  // STAGE 1: UNIVERSAL DATABASE SCHEMA PARSER (Migrations, SQL, Prisma, TypeORM, Mongoose)
  // =========================================================================
  for (const [filePath, content] of entries) {
    // 1.1 Laravel Migrations: Schema::create('table', ...)
    if (content.includes('Schema::create')) {
      dbEngines.add('MySQL (Laravel Migration)');
      const schemaRegex = /Schema::create\(\s*['"]([\w_]+)['"]\s*,\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\)\s*;/g;
      let match: RegExpExecArray | null;
      while ((match = schemaRegex.exec(content)) !== null) {
        const tableName = match[1];
        const body = match[2];
        const range = getLineRange(content, match.index, 20);
        const columns: TableColumn[] = [];

        for (const line of body.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed.includes('$table->id()')) {
            columns.push({ name: 'id', dataType: 'BIGINT UNSIGNED', isPrimary: true });
          } else if (trimmed.includes('$table->timestamps()')) {
            columns.push({ name: 'created_at', dataType: 'TIMESTAMP', isNullable: true });
            columns.push({ name: 'updated_at', dataType: 'TIMESTAMP', isNullable: true });
          } else {
            const fkMatch = trimmed.match(
              /\$table->foreignId\(\s*['"]([\w_]+)['"]\s*\)(?:->constrained\(\s*['"]([\w_]+)['"]\s*\))?/
            );
            if (fkMatch) {
              columns.push({
                name: fkMatch[1],
                dataType: 'BIGINT UNSIGNED',
                isForeign: Boolean(fkMatch[2]),
                referencesTable: fkMatch[2],
                referencesColumn: fkMatch[2] ? 'id' : undefined,
              });
              continue;
            }
            const colMatch = trimmed.match(
              /\$table->(string|decimal|integer|boolean|timestamp|text|date|bigInteger|json|enum)\(\s*['"]([\w_]+)['"]/
            );
            if (colMatch) {
              columns.push({
                name: colMatch[2],
                dataType: colMatch[1].toUpperCase(),
                isUnique: trimmed.includes('->unique()'),
                isNullable: trimmed.includes('->nullable()'),
              });
            }
          }
        }

        registerTableSymbol({
          id: `table:${tableName}`,
          name: tableName,
          label: `Table: ${tableName}`,
          category: 'table',
          layer: 'database',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Bảng dữ liệu '${tableName}' (${columns.length} cột) từ Laravel Migration.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { columns },
        });
      }
    }

    // 1.2 Standard SQL CREATE TABLE (MySQL / PostgreSQL / SQLite dumps & init scripts)
    if (filePath.endsWith('.sql') || /CREATE\s+TABLE/i.test(content)) {
      if (content.includes('sqlite') || content.includes('AUTOINCREMENT')) {
        dbEngines.add('SQLite / SQL');
      } else {
        dbEngines.add('MySQL / SQL');
      }

      const sqlCreateRegex =
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([\w_]+)[`"']?\s*\(([\s\S]*?)\)\s*(?:ENGINE\s*=[^;]+|;)/gi;
      let sqlMatch: RegExpExecArray | null;
      while ((sqlMatch = sqlCreateRegex.exec(content)) !== null) {
        const tableName = sqlMatch[1];
        if (tableSymbolsByName.has(tableName.toLowerCase())) continue;

        const body = sqlMatch[2];
        const range = getLineRange(content, sqlMatch.index, 22);
        const columns: TableColumn[] = [];

        const lines = body.split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim().replace(/,$/, '');
          if (!line || line.startsWith('--') || line.startsWith('/*')) continue;

          // Check inline FOREIGN KEY (col) REFERENCES ref_table(ref_col)
          const fkConstraint = line.match(
            /FOREIGN\s+KEY\s*\(\s*[`"']?([\w_]+)[`"']?\s*\)\s*REFERENCES\s*[`"']?([\w_]+)[`"']?\s*\(\s*[`"']?([\w_]+)[`"']?\s*\)/i
          );
          if (fkConstraint) {
            const existingCol = columns.find((c) => c.name === fkConstraint[1]);
            if (existingCol) {
              existingCol.isForeign = true;
              existingCol.referencesTable = fkConstraint[2];
              existingCol.referencesColumn = fkConstraint[3];
            }
            continue;
          }

          const pkConstraint = line.match(/^PRIMARY\s+KEY\s*\(\s*[`"']?([\w_]+)[`"']?/i);
          if (pkConstraint) {
            const existingCol = columns.find((c) => c.name === pkConstraint[1]);
            if (existingCol) existingCol.isPrimary = true;
            continue;
          }

          if (/^(?:PRIMARY|KEY|UNIQUE|CONSTRAINT|INDEX|CHECK)\b/i.test(line)) {
            continue;
          }

          const colDef = line.match(/^[`"']?([\w_]+)[`"']?\s+([A-Za-z0-9_]+(?:\s*\([^)]+\))?)/);
          if (colDef) {
            const colName = colDef[1];
            const colType = colDef[2].toUpperCase();
            const isPk = /PRIMARY\s+KEY/i.test(line) || colName === `${tableName.replace(/s$/, '')}_id` || colName === 'id';
            const refMatch = line.match(/REFERENCES\s+[`"']?([\w_]+)[`"']?\s*\(\s*[`"']?([\w_]+)[`"']?\s*\)/i);
            columns.push({
              name: colName,
              dataType: colType,
              isPrimary: isPk,
              isForeign: Boolean(refMatch),
              referencesTable: refMatch ? refMatch[1] : undefined,
              referencesColumn: refMatch ? refMatch[2] : undefined,
            });
          }
        }

        registerTableSymbol({
          id: `table:${tableName}`,
          name: tableName,
          label: `Table: ${tableName}`,
          category: 'table',
          layer: 'database',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Bảng CSDL '${tableName}' (${columns.length} cột) định nghĩa trong ${filePath}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { columns },
        });
      }

      // Parse ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY for phpMyAdmin dumps (like geark_db.sql)
      const alterFkRegex =
        /ALTER\s+TABLE\s+[`"']?([\w_]+)[`"']?[\s\S]*?FOREIGN\s+KEY\s*\(\s*[`"']?([\w_]+)[`"']?\s*\)\s*REFERENCES\s+[`"']?([\w_]+)[`"']?\s*\(\s*[`"']?([\w_]+)[`"']?\s*\)/gi;
      let alterMatch: RegExpExecArray | null;
      while ((alterMatch = alterFkRegex.exec(content)) !== null) {
        const [, tblName, fkColName, refTblName, refColName] = alterMatch;
        const srcTbl = tableSymbolsByName.get(tblName.toLowerCase());
        if (srcTbl && srcTbl.metadata?.columns) {
          const col = srcTbl.metadata.columns.find((c) => c.name === fkColName);
          if (col) {
            col.isForeign = true;
            col.referencesTable = refTblName;
            col.referencesColumn = refColName;
          }
        }
      }
    }

    // 1.3 Prisma Schema (schema.prisma)
    if (filePath.endsWith('.prisma')) {
      dbEngines.add('Prisma ORM');
      const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = modelRegex.exec(content)) !== null) {
        const modelName = pMatch[1];
        const body = pMatch[2];
        const mapMatch = body.match(/@@map\(\s*['"]([\w_]+)['"]\s*\)/);
        const tableName = mapMatch ? mapMatch[1] : modelName;
        if (tableSymbolsByName.has(tableName.toLowerCase())) continue;

        const range = getLineRange(content, pMatch.index, 22);
        const columns: TableColumn[] = [];

        for (const line of body.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const colName = parts[0];
            const colType = parts[1];
            const isId = trimmed.includes('@id');
            const relMatch = trimmed.match(/@relation\([^)]*fields:\s*\[(\w+)\][^)]*references:\s*\[(\w+)\]/);
            if (relMatch) {
              const fkCol = columns.find((c) => c.name === relMatch[1]);
              if (fkCol) {
                fkCol.isForeign = true;
                fkCol.referencesTable = colType.replace(/[?[\]]/g, '');
                fkCol.referencesColumn = relMatch[2];
              }
              continue;
            }
            if (!colType.endsWith('[]')) {
              columns.push({
                name: colName,
                dataType: colType,
                isPrimary: isId,
              });
            }
          }
        }

        registerTableSymbol({
          id: `table:${tableName}`,
          name: tableName,
          label: `Table: ${tableName}`,
          category: 'table',
          layer: 'database',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Bảng dữ liệu Prisma Model '${modelName}' (table: ${tableName}, ${columns.length} cột).`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { columns },
        });
      }
    }
  }

  // Build Foreign Key relations between tables
  for (const tableSym of symbols.filter((s) => s.category === 'table')) {
    const cols = tableSym.metadata?.columns || [];
    for (const col of cols) {
      if (col.isForeign && col.referencesTable) {
        const targetTable = tableSymbolsByName.get(col.referencesTable.toLowerCase());
        if (targetTable) {
          addRelation({
            id: `rel:fk:${tableSym.name}.${col.name}->${targetTable.name}`,
            sourceId: tableSym.id,
            targetId: targetTable.id,
            type: 'foreign_key',
            label: `${col.name} → ${targetTable.name}.${col.referencesColumn || 'id'}`,
            confidence: 'Verified',
            evidence: `Foreign key ${col.name} references ${targetTable.name} in ${tableSym.filePath}`,
          });
        }
      } else if (col.name.endsWith('_id') && !col.isPrimary) {
        // Check if column matches an existing table (Inferred relationship per Rule 5.6 & 11.1)
        const baseName = col.name.replace(/_id$/, '').toLowerCase();
        const targetTable = tableSymbolsByName.get(baseName);
        if (targetTable && targetTable.id !== tableSym.id) {
          addRelation({
            id: `rel:fk-inferred:${tableSym.name}.${col.name}->${targetTable.name}`,
            sourceId: tableSym.id,
            targetId: targetTable.id,
            type: 'foreign_key',
            label: `${col.name} → ${targetTable.name} (Inferred)`,
            confidence: 'Inferred',
            evidence: `Inferred from column naming '${col.name}' matching table '${targetTable.name}'`,
          });
        }
      }
    }
  }

  // =========================================================================
  // STAGE 2: MODELS, REPOSITORIES, DATABASE SERVICES & QUEUE JOBS
  // =========================================================================
  for (const [filePath, content] of entries) {
    // 2.1 PHP Laravel Eloquent Models
    if (
      filePath.endsWith('.php') &&
      (filePath.includes('/Models/') ||
        content.includes('extends Model') ||
        content.includes('extends Authenticatable'))
    ) {
      backendFrameworks.add('PHP Laravel');
      const classMatch = content.match(/class\s+(\w+)\s+extends\s+(?:Model|Authenticatable)/);
      if (classMatch) {
        const className = classMatch[1];
        const tableMatch = content.match(/protected\s+\$table\s*=\s*['"]([\w_]+)['"]/);
        const inferredTableName = tableMatch
          ? tableMatch[1]
          : `${className.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}s`;

        const range = getLineRange(content, classMatch.index || 0, 35);
        const modelSym: CodeSymbol = {
          id: `model:${className}`,
          name: `${className} Model`,
          label: `${className} (Eloquent Model)`,
          category: 'model',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Eloquent ORM Model quản lý bảng '${inferredTableName}'.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };
        addSymbol(modelSym);
        modelSymbolsByClass.set(className, { symbol: modelSym, tableName: inferredTableName });

        const targetTable = tableSymbolsByName.get(inferredTableName.toLowerCase());
        if (targetTable) {
          addRelation({
            id: `rel:model-table:${className}->${targetTable.name}`,
            sourceId: modelSym.id,
            targetId: targetTable.id,
            type: 'writes',
            label: `ORM maps to ${targetTable.name}`,
            confidence: tableMatch ? 'Verified' : 'Inferred',
            evidence: tableMatch
              ? `protected $table = '${inferredTableName}'`
              : 'Inferred from Eloquent naming convention',
          });
        }
      }
    }

    // 2.2 PHP Jobs & Validations
    if (filePath.endsWith('.php') && (filePath.includes('/Jobs/') || content.includes('implements ShouldQueue'))) {
      const jobMatch = content.match(/class\s+(\w+)\s+implements\s+ShouldQueue/);
      if (jobMatch) {
        const jobName = jobMatch[1];
        const range = getLineRange(content, jobMatch.index || 0, 28);
        addSymbol({
          id: `job:${jobName}`,
          name: jobName,
          label: `${jobName} (Async Queue Job)`,
          category: 'job',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Background Queue Job chạy bất đồng bộ (${jobName}).`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { isAsyncQueue: true },
        });
      }
    }

    if (filePath.endsWith('.php') && (filePath.includes('/Requests/') || content.includes('extends FormRequest'))) {
      const reqMatch = content.match(/class\s+(\w+)\s+extends\s+FormRequest/);
      if (reqMatch) {
        const reqName = reqMatch[1];
        const range = getLineRange(content, reqMatch.index || 0, 30);
        addSymbol({
          id: `validation:${reqName}`,
          name: reqName,
          label: `${reqName} (Validation)`,
          category: 'validation',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Kiểm tra dữ liệu đầu vào (FormRequest Validation: ${reqName}).`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        });
      }
    }
  }

  // =========================================================================
  // STAGE 3: BACKEND SERVICES (Laravel, NestJS @Injectable, Node.js Services, Python/Go/Java)
  // =========================================================================
  for (const [filePath, content] of entries) {
    const isFrontendFile =
      filePath.toLowerCase().includes('frontend/') ||
      filePath.toLowerCase().includes('client/') ||
      filePath.endsWith('.vue') ||
      filePath.endsWith('.jsx') ||
      filePath.endsWith('.tsx');
    if (isFrontendFile) continue;

    // 3.1 PHP Services
    if (filePath.endsWith('.php') && filePath.includes('/Services/')) {
      const classMatch = content.match(/class\s+(\w+)/);
      if (!classMatch) continue;
      const serviceName = classMatch[1];

      const methodRegex = /public\s+function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*\{/g;
      let mMatch: RegExpExecArray | null;
      while ((mMatch = methodRegex.exec(content)) !== null) {
        const methodName = mMatch[1];
        if (methodName === '__construct') continue;

        const range = getLineRange(content, mMatch.index, 30);
        const hasTransaction = range.snippet.includes('DB::transaction');
        const isAsyncQueue = range.snippet.includes('::dispatch(');

        const svcSym: CodeSymbol = {
          id: `service:${serviceName}.${methodName}`,
          name: `${serviceName}.${methodName}()`,
          label: `${serviceName}.${methodName}()`,
          category: 'service',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName,
          description: `Business Logic Service ${serviceName}::${methodName}()${
            hasTransaction ? ' [DB Transaction]' : ''
          }.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { hasTransaction, isAsyncQueue },
        };

        addSymbol(svcSym);
        serviceSymbolsByMethod.set(`${serviceName}.${methodName}`, svcSym);
        serviceSymbolsByMethod.set(methodName, svcSym);

        for (const [modelClass, modelInfo] of modelSymbolsByClass.entries()) {
          const modelUsageRegex = new RegExp(
            `\\b${modelClass}::(create|where|findOrFail|find|update|delete|with)\\b`
          );
          const mUsage = range.snippet.match(modelUsageRegex);
          if (mUsage) {
            const op = mUsage[1];
            const isWrite = ['create', 'update', 'delete'].includes(op);
            addRelation({
              id: `rel:svc-model:${svcSym.id}->${modelInfo.symbol.id}`,
              sourceId: svcSym.id,
              targetId: modelInfo.symbol.id,
              type: isWrite ? 'writes' : 'reads',
              label: `${modelClass}::${op}()`,
              confidence: 'Verified',
              evidence: `Direct call ${modelClass}::${op}() in ${filePath}:${range.startLine}`,
            });
          }
        }

        const jobDispatchRegex = /(\w+Job)::dispatch\(/g;
        let jMatch: RegExpExecArray | null;
        while ((jMatch = jobDispatchRegex.exec(range.snippet)) !== null) {
          const jobName = jMatch[1];
          const jobSym = symbolById.get(`job:${jobName}`);
          if (jobSym) {
            addRelation({
              id: `rel:svc-job:${svcSym.id}->${jobSym.id}`,
              sourceId: svcSym.id,
              targetId: jobSym.id,
              type: 'dispatches',
              label: `dispatch(${jobName}) [Async Queue]`,
              confidence: 'Verified',
              evidence: `${jobName}::dispatch() in ${filePath}:${range.startLine}`,
            });
          }
        }
      }
    }

    // 3.2 TypeScript / JavaScript Backend Services (NestJS @Injectable() or /services/ or *.service.ts)
    if (
      (filePath.endsWith('.ts') || filePath.endsWith('.js')) &&
      (filePath.toLowerCase().includes('/services/') ||
        filePath.toLowerCase().includes('.service.') ||
        content.includes('@Injectable()'))
    ) {
      if (content.includes('@Injectable()')) {
        backendFrameworks.add('NestJS');
      } else {
        backendFrameworks.add('Node.js');
      }

      const classMatch = content.match(/export\s+class\s+(\w+)/);
      if (classMatch) {
        const serviceClass = classMatch[1];
        const classRange = getLineRange(content, classMatch.index || 0, 40);

        // Create a class-level symbol as well as key method symbols
        const classSym: CodeSymbol = {
          id: `service:${serviceClass}`,
          name: serviceClass,
          label: `${serviceClass} (Service)`,
          category: serviceClass.toLowerCase().includes('database') ? 'model' : 'service',
          layer: 'backend',
          filePath,
          startLine: classRange.startLine,
          endLine: classRange.endLine,
          description: `Backend Service class ${serviceClass} trong ${filePath}.`,
          codeSnippet: classRange.snippet,
          confidence: 'Verified',
        };
        addSymbol(classSym);
        serviceSymbolsByMethod.set(serviceClass, classSym);

        // Extract methods inside the class
        const methodRegex =
          /^\s*(?:public\s+|async\s+)*([a-zA-Z_]\w*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/gm;
        let mMatch: RegExpExecArray | null;
        const ignoredNames = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'onModuleInit']);

        while ((mMatch = methodRegex.exec(content)) !== null) {
          const methodName = mMatch[1];
          if (ignoredNames.has(methodName)) continue;

          const range = getLineRange(content, mMatch.index, 22);
          const svcSym: CodeSymbol = {
            id: `service:${serviceClass}.${methodName}`,
            name: `${serviceClass}.${methodName}()`,
            label: `${serviceClass}.${methodName}()`,
            category: 'service',
            layer: 'backend',
            filePath,
            startLine: range.startLine,
            endLine: range.endLine,
            methodName,
            description: `Method ${serviceClass}.${methodName}() tại ${filePath}.`,
            codeSnippet: range.snippet,
            confidence: 'Verified',
          };
          addSymbol(svcSym);
          serviceSymbolsByMethod.set(`${serviceClass}.${methodName}`, svcSym);
          serviceSymbolsByMethod.set(methodName, svcSym);

          // Link service method to SQL tables if it executes queries
          linkSnippetToDatabaseTables(range.snippet, svcSym, filePath, range.startLine);
        }

        // Also link class-level SQL queries to tables
        linkSnippetToDatabaseTables(content, classSym, filePath, 1);
      } else {
        // Plain JS module exporting service functions (like mailService.js, otpService.js)
        const fileName = filePath.split('/').pop()?.replace(/\.(js|ts)$/, '') || 'Service';
        const fnRegex = /(?:async\s+function\s+(\w+)|(?:exports\.|const\s+)(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
        let fMatch: RegExpExecArray | null;
        while ((fMatch = fnRegex.exec(content)) !== null) {
          const fnName = fMatch[1] || fMatch[2];
          if (!fnName) continue;
          const range = getLineRange(content, fMatch.index, 18);
          const svcSym: CodeSymbol = {
            id: `service:${fileName}.${fnName}`,
            name: `${fileName}.${fnName}()`,
            label: `${fileName}.${fnName}()`,
            category: 'service',
            layer: 'backend',
            filePath,
            startLine: range.startLine,
            endLine: range.endLine,
            methodName: fnName,
            description: `Hàm service ${fileName}.${fnName}() trong ${filePath}.`,
            codeSnippet: range.snippet,
            confidence: 'Verified',
          };
          addSymbol(svcSym);
          serviceSymbolsByMethod.set(`${fileName}.${fnName}`, svcSym);
          serviceSymbolsByMethod.set(fnName, svcSym);
          linkSnippetToDatabaseTables(range.snippet, svcSym, filePath, range.startLine);
        }
      }
    }
  }

  // Helper to detect SQL/Prisma/ORM queries in any snippet and link to Table symbols
  function linkSnippetToDatabaseTables(
    snippet: string,
    sourceSym: CodeSymbol,
    filePath: string,
    lineNum: number
  ) {
    // 1. Prisma calls: prisma.user.findUnique, prisma.orderItem.create, etc.
    const prismaRegex = /prisma\.(\w+)\.(findUnique|findFirst|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = prismaRegex.exec(snippet)) !== null) {
      const modelProp = pMatch[1];
      const op = pMatch[2];
      // Convert camelCase modelProp (e.g. orderItem -> order_items)
      const snake = modelProp.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      const tableSym =
        tableSymbolsByName.get(modelProp.toLowerCase()) ||
        tableSymbolsByName.get(snake) ||
        tableSymbolsByName.get(snake + 's');
      if (tableSym) {
        const isWrite = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(op);
        addRelation({
          id: `rel:prisma:${sourceSym.id}->${tableSym.id}:${op}`,
          sourceId: sourceSym.id,
          targetId: tableSym.id,
          type: isWrite ? 'writes' : 'reads',
          label: `prisma.${modelProp}.${op}()`,
          confidence: 'Verified',
          evidence: `Prisma ORM query prisma.${modelProp}.${op}() in ${filePath}:${lineNum}`,
        });
      }
    }

    // 2. Direct SQL queries: SELECT/INSERT/UPDATE/DELETE ... FROM/INTO/UPDATE table_name
    const sqlRegex = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[\s\S]{1,140}?\b(?:FROM|INTO|UPDATE)\s+[`"']?([a-zA-Z_][a-zA-Z0-9_]*)[`"']?/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sqlRegex.exec(snippet)) !== null) {
      const verb = sMatch[1].toUpperCase();
      const tblName = sMatch[2].toLowerCase();
      const tableSym = tableSymbolsByName.get(tblName);
      if (tableSym) {
        const isWrite = !verb.startsWith('SELECT');
        addRelation({
          id: `rel:sql:${sourceSym.id}->${tableSym.id}`,
          sourceId: sourceSym.id,
          targetId: tableSym.id,
          type: isWrite ? 'writes' : 'reads',
          label: `SQL ${verb.split(/\s+/)[0]} ${tableSym.name}`,
          confidence: 'Verified',
          evidence: `SQL query on '${tableSym.name}' in ${filePath}:${lineNum}`,
        });
      }
    }
  }

  // =========================================================================
  // STAGE 4: CONTROLLERS & WEBSOCKET GATEWAYS (Laravel, NestJS, Express, FastAPI, Spring)
  // =========================================================================
  for (const [filePath, content] of entries) {
    // 4.1 PHP Laravel Controllers
    if (filePath.endsWith('.php') && filePath.includes('/Controllers/')) {
      const classMatch = content.match(/class\s+(\w+)\s+extends\s+Controller/);
      if (!classMatch) continue;
      const controllerName = classMatch[1];

      const propToServiceClass = new Map<string, string>();
      const propRegex = /(?:protected|private|public)\s+(\w+Service)\s+\$(\w+)/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = propRegex.exec(content)) !== null) {
        propToServiceClass.set(pMatch[2], pMatch[1]);
      }

      const methodRegex = /public\s+function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*[\w\\|]+)?\s*\{/g;
      let mMatch: RegExpExecArray | null;
      while ((mMatch = methodRegex.exec(content)) !== null) {
        const methodName = mMatch[1];
        const paramsStr = mMatch[2];
        if (methodName === '__construct') continue;

        const range = getLineRange(content, mMatch.index, 25);
        const conditions: string[] = [];
        const ifRegex = /if\s*\(([^)]+)\)/g;
        let ifMatch: RegExpExecArray | null;
        while ((ifMatch = ifRegex.exec(range.snippet)) !== null) {
          conditions.push(ifMatch[1].trim());
        }

        const ctrlSym: CodeSymbol = {
          id: `controller:${controllerName}@${methodName}`,
          name: `${controllerName}@${methodName}`,
          label: `${controllerName}@${methodName}`,
          category: 'controller',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName,
          description: `Controller action ${controllerName}::${methodName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { conditions: conditions.length > 0 ? conditions : undefined },
        };

        addSymbol(ctrlSym);
        controllerSymbolsByAction.set(`${controllerName}@${methodName}`, ctrlSym);

        const reqParamMatch = paramsStr.match(/(\w+Request)\s+\$\w+/);
        if (reqParamMatch && reqParamMatch[1] !== 'Request') {
          const reqClassName = reqParamMatch[1];
          const valSym = symbolById.get(`validation:${reqClassName}`);
          if (valSym) {
            addRelation({
              id: `rel:ctrl-val:${ctrlSym.id}->${valSym.id}`,
              sourceId: ctrlSym.id,
              targetId: valSym.id,
              type: 'validates',
              label: `Validates via ${reqClassName}`,
              confidence: 'Verified',
              evidence: `Type-hinted ${reqClassName} in ${controllerName}@${methodName}`,
            });
          }
        }

        const svcCallRegex = /\$this->(\w+)->(\w+)\s*\(/g;
        let sCall: RegExpExecArray | null;
        while ((sCall = svcCallRegex.exec(range.snippet)) !== null) {
          const propName = sCall[1];
          const calledMethod = sCall[2];
          const serviceClass =
            propToServiceClass.get(propName) ||
            `${propName.charAt(0).toUpperCase()}${propName.slice(1)}`;
          const targetSvc = serviceSymbolsByMethod.get(`${serviceClass}.${calledMethod}`);
          if (targetSvc) {
            addRelation({
              id: `rel:ctrl-svc:${ctrlSym.id}->${targetSvc.id}`,
              sourceId: ctrlSym.id,
              targetId: targetSvc.id,
              type: 'calls',
              label: `${serviceClass}.${calledMethod}()`,
              confidence: 'Verified',
              evidence: `$this->${propName}->${calledMethod}() in ${filePath}:${range.startLine}`,
            });
          }
        }

        for (const [modelClass, modelInfo] of modelSymbolsByClass.entries()) {
          const directModelRegex = new RegExp(
            `\\b${modelClass}::(with|where|findOrFail|find|create|update|delete)\\b`
          );
          const dMatch = range.snippet.match(directModelRegex);
          if (dMatch) {
            const op = dMatch[1];
            const isWrite = ['create', 'update', 'delete'].includes(op);
            addRelation({
              id: `rel:ctrl-model:${ctrlSym.id}->${modelInfo.symbol.id}`,
              sourceId: ctrlSym.id,
              targetId: modelInfo.symbol.id,
              type: isWrite ? 'writes' : 'reads',
              label: `Direct ${modelClass}::${op}()`,
              confidence: 'Verified',
              evidence: `Controller directly calls ${modelClass}::${op}() in ${filePath}:${range.startLine}`,
            });
          }
        }
      }
    }

    // 4.2 NestJS @Controller('prefix') & @Get / @Post / @Put / @Delete Decorators
    if (
      (filePath.endsWith('.ts') || filePath.endsWith('.js')) &&
      content.includes('@Controller(')
    ) {
      backendFrameworks.add('NestJS');
      const ctrlDecMatch = content.match(/@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/);
      const basePrefix = ctrlDecMatch && ctrlDecMatch[1] ? ctrlDecMatch[1] : '';
      const classMatch = content.match(/export\s+class\s+(\w+)/);
      const controllerClass = classMatch ? classMatch[1] : 'NestController';

      // Map constructor-injected services: private readonly aiService: AiService
      const injectedServices = new Map<string, string>();
      const injRegex = /(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:\s*(\w+)/g;
      let injMatch: RegExpExecArray | null;
      while ((injMatch = injRegex.exec(content)) !== null) {
        injectedServices.set(injMatch[1], injMatch[2]);
      }

      // Match @Get('path') / @Post('path') followed by method name
      const nestRouteRegex =
        /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)[\s\S]{0,120}?(?:async\s+)?(\w+)\s*\(/g;
      let nMatch: RegExpExecArray | null;

      while ((nMatch = nestRouteRegex.exec(content)) !== null) {
        const httpMethod = nMatch[1].toUpperCase();
        const subPath = nMatch[2] || '';
        const methodName = nMatch[3];
        const fullEndpoint = joinUrlPaths(basePrefix, subPath);
        const endpointKey = `${httpMethod} ${fullEndpoint}`;
        const range = getLineRange(content, nMatch.index, 28);

        // Create Route symbol
        const routeSym: CodeSymbol = {
          id: `route:${httpMethod}:${fullEndpoint}`,
          name: endpointKey,
          label: `${httpMethod} ${fullEndpoint}`,
          category: 'route',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          httpMethod,
          endpointPath: fullEndpoint,
          description: `NestJS Endpoint ${endpointKey} → ${controllerClass}.${methodName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };
        addSymbol(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);

        // Create Controller action symbol
        const ctrlSym: CodeSymbol = {
          id: `controller:${controllerClass}@${methodName}`,
          name: `${controllerClass}.${methodName}()`,
          label: `${controllerClass}.${methodName}()`,
          category: 'controller',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName,
          description: `NestJS Controller handler ${controllerClass}.${methodName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };
        addSymbol(ctrlSym);
        controllerSymbolsByAction.set(`${controllerClass}@${methodName}`, ctrlSym);

        addRelation({
          id: `rel:route-ctrl:${routeSym.id}->${ctrlSym.id}`,
          sourceId: routeSym.id,
          targetId: ctrlSym.id,
          type: 'calls',
          label: `Handles ${endpointKey}`,
          confidence: 'Verified',
          evidence: `@${nMatch[1]}('${subPath}') ${controllerClass}.${methodName}()`,
        });

        // Trace calls to injected services: this.propName.serviceMethod(...)
        const svcCallRegex = /this\.(\w+)\.(\w+)\s*\(/g;
        let sCall: RegExpExecArray | null;
        while ((sCall = svcCallRegex.exec(range.snippet)) !== null) {
          const propName = sCall[1];
          const calledMethod = sCall[2];
          const svcClass = injectedServices.get(propName);
          const targetSvc =
            (svcClass ? serviceSymbolsByMethod.get(`${svcClass}.${calledMethod}`) : undefined) ||
            serviceSymbolsByMethod.get(calledMethod) ||
            (svcClass ? serviceSymbolsByMethod.get(svcClass) : undefined);

          if (targetSvc) {
            addRelation({
              id: `rel:ctrl-svc:${ctrlSym.id}->${targetSvc.id}`,
              sourceId: ctrlSym.id,
              targetId: targetSvc.id,
              type: 'calls',
              label: `${svcClass || propName}.${calledMethod}()`,
              confidence: 'Verified',
              evidence: `this.${propName}.${calledMethod}() in ${filePath}:${range.startLine}`,
            });
          }
        }
      }
    }

    // 4.3 NestJS @WebSocketGateway / Socket.IO Gateways
    if (
      (filePath.endsWith('.ts') || filePath.endsWith('.js')) &&
      content.includes('@WebSocketGateway')
    ) {
      backendFrameworks.add('NestJS WebSockets');
      const classMatch = content.match(/export\s+class\s+(\w+)/);
      const gatewayClass = classMatch ? classMatch[1] : 'RealtimeGateway';

      const subRegex =
        /@SubscribeMessage\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]{0,120}?(?:async\s+)?(\w+)\s*\(/g;
      let subMatch: RegExpExecArray | null;
      while ((subMatch = subRegex.exec(content)) !== null) {
        const eventName = subMatch[1];
        const methodName = subMatch[2];
        const range = getLineRange(content, subMatch.index, 22);
        const endpointKey = `WS ${eventName}`;

        const routeSym: CodeSymbol = {
          id: `route:WS:${eventName}`,
          name: endpointKey,
          label: `WS Event: ${eventName}`,
          category: 'route',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          httpMethod: 'WS',
          endpointPath: eventName,
          description: `WebSocket @SubscribeMessage('${eventName}') tại ${gatewayClass}.${methodName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };
        addSymbol(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);
      }
    }

    // 4.4 Express / Node.js Controllers (e.g. Backend/src/controllers/authController.js)
    if (
      (filePath.endsWith('.js') || filePath.endsWith('.ts')) &&
      !content.includes('@Controller(') &&
      (filePath.toLowerCase().includes('/controllers/') ||
        filePath.toLowerCase().includes('controller.') ||
        filePath.toLowerCase().includes('/handlers/'))
    ) {
      backendFrameworks.add('Node.js / Express');
      const fileName = filePath.split('/').pop()?.replace(/\.(js|ts)$/, '') || 'Controller';

      // Match function declarations and arrow function exports
      const fnRegex =
        /(?:async\s+function\s+(\w+)\s*\(|function\s+(\w+)\s*\((?:req|request)\b|(?:exports\.|const\s+)(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
      let fnMatch: RegExpExecArray | null;

      while ((fnMatch = fnRegex.exec(content)) !== null) {
        const actionName = fnMatch[1] || fnMatch[2] || fnMatch[3];
        if (!actionName || ['generateToken', 'module', 'router', 'require'].includes(actionName)) {
          continue;
        }

        const range = getLineRange(content, fnMatch.index, 28);
        const ctrlSym: CodeSymbol = {
          id: `controller:${fileName}@${actionName}`,
          name: `${fileName}.${actionName}()`,
          label: `${fileName}.${actionName}()`,
          category: 'controller',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName: actionName,
          description: `Controller handler ${fileName}.${actionName}() tại ${filePath}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        addSymbol(ctrlSym);
        controllerSymbolsByAction.set(`${fileName}.${actionName}`, ctrlSym);
        controllerSymbolsByAction.set(`${fileName}@${actionName}`, ctrlSym);
        controllerSymbolsByAction.set(actionName, ctrlSym);

        // Link to DB tables queried via Prisma or raw SQL inside this controller function
        linkSnippetToDatabaseTables(range.snippet, ctrlSym, filePath, range.startLine);

        // Link to Service functions called inside this controller function
        for (const [svcKey, svcSym] of serviceSymbolsByMethod.entries()) {
          if (svcKey.includes('.')) continue; // check plain function name or method name
          const callRegex = new RegExp(`\\b${svcKey}\\s*\\(`);
          if (callRegex.test(range.snippet)) {
            addRelation({
              id: `rel:ctrl-svc:${ctrlSym.id}->${svcSym.id}`,
              sourceId: ctrlSym.id,
              targetId: svcSym.id,
              type: 'calls',
              label: `calls ${svcSym.label}`,
              confidence: 'Verified',
              evidence: `Calls ${svcKey}() in ${filePath}:${range.startLine}`,
            });
          }
        }
      }
    }
  }

  // =========================================================================
  // STAGE 5: MULTI-LEVEL EXPRESS ROUTER & LARAVEL/PYTHON ROUTES RESOLUTION
  // =========================================================================
  // 5.1 Pre-scan Express app.use('/api', ...) & router.use('/auth', authRoutes) mounts
  const routerVariablePrefix = new Map<string, string>(); // varName or fileBaseName -> mounted prefix
  let globalApiPrefix = '';

  for (const [filePath, content] of entries) {
    if (!filePath.endsWith('.js') && !filePath.endsWith('.ts')) continue;
    const appMountMatch = content.match(/app\.use\(\s*['"`](\/[a-zA-Z0-9_-]+)['"`]\s*,\s*(\w+)\s*\)/);
    if (appMountMatch && appMountMatch[1] === '/api') {
      globalApiPrefix = '/api';
    }
  }

  for (const [filePath, content] of entries) {
    if (!filePath.endsWith('.js') && !filePath.endsWith('.ts')) continue;
    const useRegex = /(?:router|app)\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g;
    let uMatch: RegExpExecArray | null;
    while ((uMatch = useRegex.exec(content)) !== null) {
      const mountPrefix = uMatch[1];
      const routerVar = uMatch[2];
      if (mountPrefix && routerVar && routerVar !== 'express') {
        const fullMount = filePath.endsWith('routes/index.js') || filePath.endsWith('routes/index.ts')
          ? joinUrlPaths(globalApiPrefix || '/api', mountPrefix)
          : mountPrefix;
        routerVariablePrefix.set(routerVar, fullMount);
      }
    }
  }

  for (const [filePath, content] of entries) {
    // 5.2 Laravel Routes
    if (filePath.includes('routes/') && filePath.endsWith('.php')) {
      const routeRegex =
        /Route::(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,\s*\[\s*(\w+)::class\s*,\s*['"](\w+)['"]\s*\]\s*\)/gi;
      let rMatch: RegExpExecArray | null;

      while ((rMatch = routeRegex.exec(content)) !== null) {
        const httpMethod = rMatch[1].toUpperCase();
        const rawPath = normalizeEndpointPath(rMatch[2]);
        const controllerClass = rMatch[3];
        const actionName = rMatch[4];
        const range = getLineRange(content, rMatch.index, 4);

        const endpointKey = `${httpMethod} ${rawPath}`;
        const routeSym: CodeSymbol = {
          id: `route:${httpMethod}:${rawPath}`,
          name: endpointKey,
          label: `${httpMethod} ${rawPath}`,
          category: 'route',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          httpMethod,
          endpointPath: rawPath,
          description: `Laravel Route ${endpointKey} → ${controllerClass}@${actionName}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        addSymbol(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);

        const targetCtrl = controllerSymbolsByAction.get(`${controllerClass}@${actionName}`);
        if (targetCtrl) {
          addRelation({
            id: `rel:route-ctrl:${routeSym.id}->${targetCtrl.id}`,
            sourceId: routeSym.id,
            targetId: targetCtrl.id,
            type: 'calls',
            label: `Dispatches to ${controllerClass}@${actionName}`,
            confidence: 'Verified',
            evidence: `Route::${httpMethod.toLowerCase()}('${rawPath}', [${controllerClass}::class, '${actionName}'])`,
          });
        }
      }
    }

    // 5.3 Express / Fastify Routes with automatic sub-router prefix resolution
    if (
      (filePath.endsWith('.js') || filePath.endsWith('.ts')) &&
      (filePath.toLowerCase().includes('route') ||
        filePath.toLowerCase().includes('app.') ||
        filePath.toLowerCase().includes('server.') ||
        content.includes('express.Router()'))
    ) {
      const fileBaseName = filePath.split('/').pop()?.replace(/\.(js|ts)$/, '') || '';
      const mountedPrefix =
        routerVariablePrefix.get(fileBaseName) ||
        (fileBaseName === 'index' && globalApiPrefix ? globalApiPrefix : '');

      const expressRegex =
        /(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]([^;]*)\)/gi;
      let exMatch: RegExpExecArray | null;

      while ((exMatch = expressRegex.exec(content)) !== null) {
        backendFrameworks.add('Node.js / Express');
        const httpMethod = exMatch[1].toUpperCase();
        const localPath = exMatch[2];
        const handlerArgs = exMatch[3] || '';

        const fullPath = mountedPrefix
          ? joinUrlPaths(mountedPrefix, localPath === '/' ? '' : localPath)
          : normalizeEndpointPath(localPath);

        const endpointKey = `${httpMethod} ${fullPath}`;
        if (routeSymbolsByEndpoint.has(endpointKey)) continue;

        const range = getLineRange(content, exMatch.index, 6);
        const routeSym: CodeSymbol = {
          id: `route:${httpMethod}:${fullPath}`,
          name: endpointKey,
          label: `${httpMethod} ${fullPath}`,
          category: 'route',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          httpMethod,
          endpointPath: fullPath,
          description: `Express Route ${endpointKey} khai báo trong ${filePath}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        addSymbol(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);

        // Extract controller.action from handlerArgs (e.g. `, verifyToken, authController.login`)
        const ctrlHandlerMatch = handlerArgs.match(/(\w+Controller)\.(\w+)/);
        if (ctrlHandlerMatch) {
          const ctrlName = ctrlHandlerMatch[1];
          const actName = ctrlHandlerMatch[2];
          const targetCtrl =
            controllerSymbolsByAction.get(`${ctrlName}.${actName}`) ||
            controllerSymbolsByAction.get(`${ctrlName}@${actName}`) ||
            controllerSymbolsByAction.get(actName);

          if (targetCtrl) {
            addRelation({
              id: `rel:route-ctrl:${routeSym.id}->${targetCtrl.id}`,
              sourceId: routeSym.id,
              targetId: targetCtrl.id,
              type: 'calls',
              label: `Dispatches to ${ctrlName}.${actName}()`,
              confidence: 'Verified',
              evidence: `router.${httpMethod.toLowerCase()}('${localPath}', ..., ${ctrlName}.${actName})`,
            });
          }
        } else {
          // Inline route handler querying DB directly (like router.get('/health', ... pool.query))
          linkSnippetToDatabaseTables(range.snippet, routeSym, filePath, range.startLine);
        }
      }
    }

    // 5.4 Python FastAPI / Flask Routes (@app.get, @router.post, @bp.route)
    if (filePath.endsWith('.py')) {
      const pyRouteRegex =
        /@(?:app|router|bp|api)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"][^)]*\)\s*(?:async\s+)?def\s+(\w+)/gi;
      let pyMatch: RegExpExecArray | null;
      while ((pyMatch = pyRouteRegex.exec(content)) !== null) {
        backendFrameworks.add('Python (FastAPI / Flask)');
        const httpMethod = pyMatch[1].toUpperCase() === 'ROUTE' ? 'GET' : pyMatch[1].toUpperCase();
        const fullPath = normalizeEndpointPath(pyMatch[2]);
        const fnName = pyMatch[3];
        const endpointKey = `${httpMethod} ${fullPath}`;
        const range = getLineRange(content, pyMatch.index, 20);

        const routeSym: CodeSymbol = {
          id: `route:${httpMethod}:${fullPath}`,
          name: endpointKey,
          label: `${httpMethod} ${fullPath} (${fnName})`,
          category: 'route',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          httpMethod,
          endpointPath: fullPath,
          methodName: fnName,
          description: `Python Endpoint ${endpointKey} → def ${fnName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };
        addSymbol(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);
      }
    }
  }

  // =========================================================================
  // STAGE 6: UNIVERSAL FRONTEND API CLIENTS (fetch, axios, custom request() wrappers)
  // =========================================================================
  // Detect custom API base prefix in frontend (e.g. API_BASE_URL = '.../api')
  let frontendApiBasePrefix = '/api';
  for (const [filePath, content] of entries) {
    const baseMatch = content.match(/(?:API_BASE_URL|API_BASE|BASE_URL)\s*=\s*[^;]*?['"`](\/[a-zA-Z0-9_-]+)['"`]/);
    if (baseMatch) {
      frontendApiBasePrefix = baseMatch[1];
      break;
    }
  }

  for (const [filePath, content] of entries) {
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.js') && !filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) {
      continue;
    }
    const isApiClientFile =
      filePath.toLowerCase().includes('/api/') ||
      filePath.toLowerCase().includes('api.') ||
      (filePath.toLowerCase().includes('/services/') && !filePath.toLowerCase().includes('backend'));

    if (!isApiClientFile) continue;

    const objMatch = content.match(/export\s+const\s+(\w+)\s*=\s*\{/);
    const clientName = objMatch
      ? objMatch[1]
      : filePath.split('/').pop()?.replace(/\.\w+$/, '') || 'apiClient';

    // Match both method shorthand `async create(payload) { ... }` AND arrow properties `login: (email, password) => request(...)`
    const apiMethodRegex =
      /(?:async\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}|(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*(?:\{[\s\S]*?\n\s*\}|request(?:<[^>]+>)?\([\s\S]*?\)\s*(?:,|$)))/g;
    let mMatch: RegExpExecArray | null;

    while ((mMatch = apiMethodRegex.exec(content)) !== null) {
      const methodName = mMatch[1] || mMatch[3];
      const methodChunk = mMatch[0];
      if (!methodName) continue;

      const range = getLineRange(content, mMatch.index, 12);

      // Pattern A: fetch('/api/...', { method: 'POST' })
      // Pattern B: request('/auth/login', { method: 'POST' }) or request<any>(`/rooms/${roomCode}/start`, { method: 'POST' })
      // Pattern C: axios.post('/api/...') or apiClient.get('/...')
      const callMatch = methodChunk.match(
        /(?:fetch|request)\s*(?:<[^>]+>)?\(\s*[`'"]([^`'"]+)[`'"](?:\s*,\s*\{([\s\S]*?)\})?/
      );
      const axiosMatch = methodChunk.match(
        /(?:axios|http|client)\.(get|post|put|patch|delete)\s*(?:<[^>]+>)?\(\s*[`'"]([^`'"]+)[`'"]/i
      );

      let httpMethod = 'GET';
      let rawEndpoint = '';

      if (callMatch) {
        rawEndpoint = callMatch[1];
        const opts = callMatch[2] || '';
        const mOpt = opts.match(/method\s*:\s*['"`](\w+)['"`]/i);
        if (mOpt) httpMethod = mOpt[1].toUpperCase();
      } else if (axiosMatch) {
        httpMethod = axiosMatch[1].toUpperCase();
        rawEndpoint = axiosMatch[2];
      }

      if (!rawEndpoint) continue;

      let normalizedEndpoint = normalizeEndpointPath(rawEndpoint);
      // Try matching against backend routes directly or with frontendApiBasePrefix (/api)
      const candidatePaths = [
        normalizedEndpoint,
        joinUrlPaths(frontendApiBasePrefix, normalizedEndpoint),
      ];

      let matchedRoute: CodeSymbol | undefined;
      for (const cand of candidatePaths) {
        const exact = routeSymbolsByEndpoint.get(`${httpMethod} ${cand}`);
        if (exact) {
          matchedRoute = exact;
          normalizedEndpoint = cand;
          break;
        }
        // Fuzzy parameter match: `/api/rooms/{roomCode}/start` matches `/api/rooms/{code}/start`
        const candPattern = cand.replace(/\{[^}]+\}/g, '{}');
        const fuzzy = Array.from(routeSymbolsByEndpoint.values()).find(
          (r) =>
            r.httpMethod === httpMethod &&
            r.endpointPath?.replace(/\{[^}]+\}/g, '{}') === candPattern
        );
        if (fuzzy) {
          matchedRoute = fuzzy;
          normalizedEndpoint = fuzzy.endpointPath || cand;
          break;
        }
      }

      const apiSym: CodeSymbol = {
        id: `api_client:${clientName}.${methodName}`,
        name: `${clientName}.${methodName}()`,
        label: `${clientName}.${methodName}()`,
        category: 'api_client',
        layer: 'frontend',
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        methodName,
        httpMethod,
        endpointPath: normalizedEndpoint,
        description: `Frontend API Client '${clientName}.${methodName}()' gọi ${httpMethod} ${normalizedEndpoint}.`,
        codeSnippet: range.snippet,
        confidence: 'Verified',
      };

      addSymbol(apiSym);
      apiClientMethods.set(`${clientName}.${methodName}`, {
        symbol: apiSym,
        httpMethod,
        endpointPath: normalizedEndpoint,
        shortName: methodName,
      });

      if (matchedRoute) {
        addRelation({
          id: `rel:fe-be:${apiSym.id}->${matchedRoute.id}`,
          sourceId: apiSym.id,
          targetId: matchedRoute.id,
          type: 'requests',
          label: `HTTP ${httpMethod} ${normalizedEndpoint}`,
          confidence: 'Verified',
          evidence: `Frontend ${clientName}.${methodName}() calls ${httpMethod} ${normalizedEndpoint}`,
        });
      }
    }
  }

  // =========================================================================
  // STAGE 7: FRONTEND COMPOSABLES, HOOKS, CONTEXT & STORES
  // =========================================================================
  for (const [filePath, content] of entries) {
    const lower = filePath.toLowerCase();
    if (
      (filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) &&
      (lower.includes('/composables/') ||
        lower.includes('/hooks/') ||
        lower.includes('/context/') ||
        lower.includes('/store/'))
    ) {
      if (lower.includes('/composables/')) frontendFrameworks.add('Vue.js / Nuxt');
      if (lower.includes('/context/')) frontendFrameworks.add('React Context');

      const baseName = filePath.split('/').pop()?.replace(/\.\w+$/, '') || 'useHook';
      const fnRegex = /(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>)/g;
      let fMatch: RegExpExecArray | null;
      let foundSubFn = false;

      while ((fMatch = fnRegex.exec(content)) !== null) {
        const fnName = fMatch[1] || fMatch[2];
        if (!fnName) continue;
        foundSubFn = true;
        const range = getLineRange(content, fMatch.index, 18);

        const compSym: CodeSymbol = {
          id: `composable:${baseName}.${fnName}`,
          name: `${baseName}.${fnName}()`,
          label: `${baseName} → ${fnName}()`,
          category: 'composable',
          layer: 'frontend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName: fnName,
          description: `State/Hook '${baseName}' thực thi hàm ${fnName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        addSymbol(compSym);
        composableMethods.set(fnName, compSym);

        for (const [clientKey, clientInfo] of apiClientMethods.entries()) {
          if (range.snippet.includes(`${clientKey}(`)) {
            addRelation({
              id: `rel:comp-api:${compSym.id}->${clientInfo.symbol.id}`,
              sourceId: compSym.id,
              targetId: clientInfo.symbol.id,
              type: 'calls',
              label: `calls ${clientKey}()`,
              confidence: 'Verified',
              evidence: `Calls ${clientKey}() in ${filePath}:${range.startLine}`,
            });
          }
        }
      }

      if (!foundSubFn) {
        const lines = content.split(/\r?\n/);
        const compSym: CodeSymbol = {
          id: `composable:${baseName}`,
          name: baseName,
          label: `${baseName} (Composable/Hook)`,
          category: 'composable',
          layer: 'frontend',
          filePath,
          startLine: 1,
          endLine: Math.min(lines.length, 45),
          description: `Frontend Composable/Context '${baseName}' tại ${filePath}.`,
          codeSnippet: lines.slice(0, 45).join('\n'),
          confidence: 'Verified',
        };
        addSymbol(compSym);
        composableMethods.set(baseName, compSym);
      }
    }
  }

  // =========================================================================
  // STAGE 8: FRONTEND PAGES, VIEWS & UI COMPONENTS (Vue, Nuxt, React JSX/TSX/JS)
  // =========================================================================
  const uiFiles = entries.filter(([filePath]) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.vue')) return true;
    if (
      (lower.endsWith('.tsx') || lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.ts')) &&
      (lower.includes('/components/') ||
        lower.includes('/pages/') ||
        lower.includes('/views/') ||
        lower.includes('/game/'))
    ) {
      return true;
    }
    return false;
  });

  for (const [filePath, content] of uiFiles) {
    if (filePath.endsWith('.vue')) {
      frontendFrameworks.add('Vue.js / Nuxt');
    } else if (filePath.endsWith('.jsx') || filePath.endsWith('.tsx') || content.includes('from \'react\'') || content.includes('from "react"')) {
      frontendFrameworks.add('React');
    }

    const lower = filePath.toLowerCase();
    const isPage = lower.includes('/pages/') || lower.includes('/views/');
    const rawFileName = filePath.split('/').pop()?.replace(/\.(vue|tsx|jsx|js|ts)$/, '') || 'Component';
    const parentFolder = filePath.split('/').slice(-2, -1)[0] || '';
    const baseName =
      rawFileName.toLowerCase() === 'index' && parentFolder
        ? `${parentFolder.charAt(0).toUpperCase()}${parentFolder.slice(1)}`
        : rawFileName;

    const cleanName =
      isPage && !baseName.toLowerCase().includes('page') && !baseName.toLowerCase().includes('view')
        ? `${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Page`
        : baseName;

    const lines = content.split(/\r?\n/);
    const sym: CodeSymbol = {
      id: `${isPage ? 'page' : 'component'}:${cleanName}`,
      name: cleanName,
      label: isPage ? `${cleanName} (Page)` : `${cleanName} (Component)`,
      category: isPage ? 'page' : 'component',
      layer: 'frontend',
      filePath,
      startLine: 1,
      endLine: lines.length,
      description: isPage
        ? `Trang giao diện người dùng (${filePath}).`
        : `UI Component (${cleanName} - ${filePath}).`,
      codeSnippet: lines.slice(0, 80).join('\n'),
      confidence: 'Verified',
    };

    addSymbol(sym);
    componentSymbolsByName.set(cleanName, sym);
    componentSymbolsByName.set(rawFileName, sym);
  }

  for (const [filePath, content] of uiFiles) {
    const sourceSym = primarySymbolByFile.get(filePath);
    if (!sourceSym) continue;

    // 8.1 Link Component/Page -> Rendered Child Components
    for (const [compName, targetCompSym] of componentSymbolsByName.entries()) {
      if (targetCompSym.id === sourceSym.id || compName.length < 3) continue;
      const tagRegex = new RegExp(`<${compName}\\b`);
      if (tagRegex.test(content)) {
        addRelation({
          id: `rel:ui-render:${sourceSym.id}->${targetCompSym.id}`,
          sourceId: sourceSym.id,
          targetId: targetCompSym.id,
          type: 'renders',
          label: `Renders <${compName} />`,
          confidence: 'Verified',
          evidence: `Renders <${compName}> in ${filePath}`,
        });
      }
    }

    // 8.2 Link Component/Page -> Composable / Hook / Context calls
    for (const [fnName, compMethodSym] of composableMethods.entries()) {
      const fnCallRegex = new RegExp(`\\b${fnName}\\s*\\(`);
      if (fnCallRegex.test(content)) {
        addRelation({
          id: `rel:ui-hook:${sourceSym.id}->${compMethodSym.id}`,
          sourceId: sourceSym.id,
          targetId: compMethodSym.id,
          type: 'calls',
          label: `Triggers ${fnName}()`,
          confidence: 'Verified',
          evidence: `Invokes ${fnName}() in ${filePath}`,
        });
      }
    }

    // 8.3 Link Component/Page -> API Client calls (e.g. authApi.login() or api.startGame())
    for (const [clientKey, clientInfo] of apiClientMethods.entries()) {
      if (content.includes(`${clientKey}(`)) {
        addRelation({
          id: `rel:ui-api:${sourceSym.id}->${clientInfo.symbol.id}`,
          sourceId: sourceSym.id,
          targetId: clientInfo.symbol.id,
          type: 'calls',
          label: `Calls ${clientKey}()`,
          confidence: 'Verified',
          evidence: `Direct call ${clientKey}() in ${filePath}`,
        });
      }
    }

    // 8.4 Direct fetch('/api/...') or axios.post('/api/...') inside a Page/Component without an API client file
    const inlineFetchRegex =
      /(?:fetch\(\s*[`'"]([^`'"]+)[`'"](?:\s*,\s*\{([\s\S]*?)\})?|axios\.(get|post|put|delete)\(\s*[`'"]([^`'"]+)[`'"])/gi;
    let infMatch: RegExpExecArray | null;
    while ((infMatch = inlineFetchRegex.exec(content)) !== null) {
      let httpMethod = 'GET';
      let rawEp = '';
      if (infMatch[1]) {
        rawEp = infMatch[1];
        const mOpt = (infMatch[2] || '').match(/method\s*:\s*['"`](\w+)['"`]/i);
        if (mOpt) httpMethod = mOpt[1].toUpperCase();
      } else if (infMatch[3]) {
        httpMethod = infMatch[3].toUpperCase();
        rawEp = infMatch[4];
      }
      if (rawEp && rawEp.includes('/')) {
        const normEp = normalizeEndpointPath(rawEp);
        const matchedRoute =
          routeSymbolsByEndpoint.get(`${httpMethod} ${normEp}`) ||
          routeSymbolsByEndpoint.get(`${httpMethod} ${joinUrlPaths('/api', normEp)}`);
        if (matchedRoute) {
          addRelation({
            id: `rel:ui-route:${sourceSym.id}->${matchedRoute.id}`,
            sourceId: sourceSym.id,
            targetId: matchedRoute.id,
            type: 'requests',
            label: `HTTP ${matchedRoute.label}`,
            confidence: 'Verified',
            evidence: `Inline request to ${normEp} in ${filePath}`,
          });
        }
      }
    }
  }

  // =========================================================================
  // STAGE 9: UNIVERSAL AST MODULE GRAPH, MULTI-LANGUAGE CALL GRAPH & WEB GRAPH
  // Integrates buildModuleGraph (JS/TS/Vue/Svelte/Python/Go/Rust/Java/Kotlin/C#/PHP/C/C++/Ruby/Dart/Lua/Zig/Godot/Shell/HTML/CSS),
  // buildCallGraph (TypeScript TypeChecker + Python/GDScript indent AST + Go/Rust tokenizer),
  // and buildWebGraph (Express router mount trees, Next.js App Router, FastAPI/Flask decorators, fetch/axios calls)
  // =========================================================================
  const detectedLanguages = new Set<string>();
  for (const [filePath] of entries) {
    const lang = sourceLanguage(filePath);
    if (lang) detectedLanguages.add(lang);
  }

  const moduleGraph = buildModuleGraph(rawFiles);
  for (const modSym of moduleGraph.symbols) {
    const classified = classifyFileLayerAndCategory(modSym.filePath, rawFiles[modSym.filePath] || '');
    modSym.layer = classified.layer === 'database' ? 'database' : modSym.layer;
    addSymbol(modSym);
  }
  for (const modRel of moduleGraph.relations) {
    addRelation(modRel);
  }

  const callGraph = buildCallGraph(
    rawFiles,
    moduleGraph.symbols,
    moduleGraph.relations,
    moduleGraph.scriptAsts
  );
  for (const fnSym of callGraph.symbols) {
    addSymbol(fnSym);
    // Also link AST-discovered functions to any SQL/Prisma tables they query
    linkSnippetToDatabaseTables(fnSym.codeSnippet, fnSym, fnSym.filePath, fnSym.startLine);
  }
  for (const callRel of callGraph.relations) {
    addRelation(callRel);
  }

  const existingRoutes = symbols.filter((s) => s.category === 'route');
  const webGraph = buildWebGraph(
    rawFiles,
    callGraph.symbols,
    moduleGraph.symbols,
    moduleGraph.relations,
    existingRoutes,
    symbols
  );
  for (const fw of webGraph.frameworks) {
    backendFrameworks.add(fw);
  }
  for (const webSym of webGraph.symbols) {
    const epKey = `${webSym.httpMethod} ${normalizeEndpointPath(webSym.endpointPath || '')}`;
    if (!routeSymbolsByEndpoint.has(epKey)) {
      addSymbol(webSym);
      routeSymbolsByEndpoint.set(epKey, webSym);
    }
  }
  for (const webRel of webGraph.relations) {
    addRelation(webRel);
  }

  // =========================================================================
  // STAGE 10: TRACE END-TO-END FEATURE FLOWS, CALL GRAPH FLOWS & MODULE FLOWS
  // =========================================================================
  const endpointFlows: FeatureFlow[] = [];

  const VIETNAMESE_FLOW_TITLES: Record<string, { title: string; desc: string }> = {
    'POST /api/expenses': {
      title: 'Tạo khoản chi tiêu mới (Create Expense)',
      desc: 'Luồng xử lý từ form tạo chi tiêu (Vue) → API Client → Laravel Controller → Validation → Service (DB Transaction) → MySQL & Queue Job.',
    },
    'GET /api/expenses': {
      title: 'Lấy danh sách chi tiêu (List Expenses)',
      desc: 'Luồng tải danh sách chi tiêu nhóm từ ExpensesPage → Composable → ExpenseController@index → Eloquent Model → MySQL.',
    },
    'DELETE /api/expenses/{id}': {
      title: 'Xóa khoản chi tiêu (Delete Expense)',
      desc: 'Luồng xóa khoản chi tiêu từ trang danh sách qua API DELETE tới MySQL.',
    },
    'POST /api/settlements': {
      title: 'Thanh toán công nợ nhóm (Settle Debt)',
      desc: 'Luồng thanh toán công nợ giữa các thành viên từ SettlementModal → SettlementController → SettlementService → MySQL.',
    },
    'POST /api/auth/login': {
      title: 'Đăng nhập hệ thống (User Login)',
      desc: 'Luồng xác thực người dùng từ giao diện Login → authApi.login → AuthController → kiểm tra bảng users và cấp JWT/Sanctum Token.',
    },
    'POST /api/auth/register': {
      title: 'Đăng ký tài khoản (User Register)',
      desc: 'Luồng đăng ký tài khoản người dùng mới, kiểm tra hợp lệ, gửi OTP/lưu vào bảng users.',
    },
    'POST /api/groups': {
      title: 'Tạo nhóm chi tiêu (Create Group)',
      desc: 'Luồng tạo nhóm mới và thêm thành viên mặc định trong MySQL transaction.',
    },
  };

  for (const [endpointKey, routeSym] of routeSymbolsByEndpoint.entries()) {
    const flowSymIds = new Set<string>([routeSym.id]);
    const flowRelIds = new Set<string>();

    // Backward BFS (Route <- API Client <- Composable/Hook <- Component <- Page)
    const backwardQueue: string[] = [routeSym.id];
    while (backwardQueue.length > 0) {
      const currentId = backwardQueue.shift()!;
      const callers = relations.filter(
        (r) =>
          r.targetId === currentId &&
          r.type !== 'foreign_key' &&
          r.type !== 'imports' &&
          r.type !== 'defines'
      );
      for (const rel of callers) {
        flowRelIds.add(rel.id);
        if (!flowSymIds.has(rel.sourceId)) {
          flowSymIds.add(rel.sourceId);
          backwardQueue.push(rel.sourceId);
        }
      }
    }

    // Forward BFS (Route -> Controller -> Validation -> Service -> Function -> Model -> Table / Job)
    const forwardQueue: string[] = [routeSym.id];
    while (forwardQueue.length > 0 && flowSymIds.size < 40) {
      const currentId = forwardQueue.shift()!;
      const outgoing = relations.filter(
        (r) =>
          r.sourceId === currentId &&
          r.type !== 'foreign_key' &&
          r.type !== 'imports' &&
          r.type !== 'defines'
      );
      for (const rel of outgoing) {
        flowRelIds.add(rel.id);
        if (!flowSymIds.has(rel.targetId)) {
          flowSymIds.add(rel.targetId);
          forwardQueue.push(rel.targetId);
        }
      }
    }

    const meta = VIETNAMESE_FLOW_TITLES[endpointKey] || {
      title: `Luồng ${endpointKey}`,
      desc: `Truy vết luồng xử lý từ Frontend đến Backend & Database cho ${endpointKey} (${flowSymIds.size} thành phần).`,
    };

    endpointFlows.push({
      kind: 'endpoint',
      id: `flow:${endpointKey.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      name: meta.title,
      description: meta.desc,
      httpMethod: routeSym.httpMethod,
      endpointPath: routeSym.endpointPath,
      entrySymbolId: routeSym.id,
      symbolIds: Array.from(flowSymIds),
      relationIds: Array.from(flowRelIds),
      warnings: [],
    });
  }

  endpointFlows.sort((a, b) => {
    if (a.endpointPath === '/api/expenses' && a.httpMethod === 'POST') return -1;
    if (b.endpointPath === '/api/expenses' && b.httpMethod === 'POST') return 1;
    if (b.symbolIds.length !== a.symbolIds.length) {
      return b.symbolIds.length - a.symbolIds.length;
    }
    return a.name.localeCompare(b.name);
  });

  // Build universal source flows (Function call graphs + File dependency graphs across ALL files in the project)
  const universalSourceFlows = buildSourceFlows(
    moduleGraph.symbols,
    symbols,
    relations,
    endpointFlows
  );

  // Deduplicate flows by id to ensure all flow IDs and React keys are globally unique
  const seenFlowIds = new Set<string>();
  const featureFlows: FeatureFlow[] = [];
  for (const flow of [...endpointFlows, ...universalSourceFlows]) {
    if (seenFlowIds.has(flow.id)) {
      let suffix = 2;
      while (seenFlowIds.has(`${flow.id}_${suffix}`)) {
        suffix++;
      }
      flow.id = `${flow.id}_${suffix}`;
    }
    seenFlowIds.add(flow.id);
    featureFlows.push(flow);
  }

  const verifiedCount = relations.filter((r) => r.confidence === 'Verified').length;
  const inferredCount = relations.filter((r) => r.confidence === 'Inferred').length;

  const analysisRunId = `run_${Date.now()}`;
  const nowIso = new Date().toISOString();

  const run: AnalysisRun = {
    id: analysisRunId,
    projectId,
    versionTag,
    languages: Array.from(detectedLanguages),
    status: warnings.length > 0 ? 'Completed with warnings' : 'Completed',
    stages: [
      { stage: 1, name: 'Đọc source code', status: 'completed', detail: `${entries.length} files (${detectedLanguages.size} ngôn ngữ)` },
      {
        stage: 2,
        name: 'Phân tích AST & Module',
        status: 'completed',
        detail: `${symbols.length} symbols`,
      },
      {
        stage: 3,
        name: 'Phân tích API & Routes',
        status: 'completed',
        detail: `${routeSymbolsByEndpoint.size} endpoints`,
      },
      {
        stage: 4,
        name: 'Phân tích Database',
        status: 'completed',
        detail: `${symbols.filter((s) => s.category === 'table').length} tables`,
      },
      {
        stage: 5,
        name: 'Xây dựng Call & Import Graph',
        status: 'completed',
        detail: `${relations.length} links (${verifiedCount} Verified)`,
      },
      {
        stage: 6,
        name: 'Sinh sơ đồ luồng & ERD',
        status: 'completed',
        detail: `${featureFlows.length} sơ đồ luồng`,
      },
    ],
    startedAt: nowIso,
    completedAt: nowIso,
    detectedFrameworks: {
      frontend: frontendFrameworks.size > 0 ? Array.from(frontendFrameworks) : [],
      backend: backendFrameworks.size > 0 ? Array.from(backendFrameworks) : [],
      database: dbEngines.size > 0 ? Array.from(dbEngines) : [],
    },
    stats: {
      filesScanned: entries.length,
      filesSkipped: skippedCount,
      endpointsCount: routeSymbolsByEndpoint.size,
      componentsCount: componentSymbolsByName.size || moduleGraph.symbols.length,
      tablesCount: symbols.filter((s) => s.category === 'table').length,
      verifiedRelations: verifiedCount,
      inferredRelations: inferredCount,
    },
    warnings,
    symbols,
    relations,
    featureFlows,
    sourceFiles: rawFiles,
  };

  const diagrams = generateDefaultDiagrams(projectId, run);
  return { run, diagrams };
}

function resolveImportPath(
  currentFilePath: string,
  importSpec: string,
  allFiles: string[]
): string | undefined {
  let targetBase = '';
  if (importSpec.startsWith('.')) {
    const dirParts = currentFilePath.split('/').slice(0, -1);
    for (const part of importSpec.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') dirParts.pop();
      else dirParts.push(part);
    }
    targetBase = dirParts.join('/');
  } else if (importSpec.startsWith('@/') || importSpec.startsWith('~/')) {
    const cleanSpec = importSpec.slice(2);
    const prefixFolder = currentFilePath.includes('Frontend/src/')
      ? 'Frontend/src/'
      : currentFilePath.includes('frontend/src/')
      ? 'frontend/src/'
      : currentFilePath.includes('src/')
      ? 'src/'
      : '';
    targetBase = prefixFolder + cleanSpec;
  }

  if (!targetBase) return undefined;

  const candidates = [
    targetBase,
    `${targetBase}.ts`,
    `${targetBase}.tsx`,
    `${targetBase}.js`,
    `${targetBase}.jsx`,
    `${targetBase}.vue`,
    `${targetBase}/index.ts`,
    `${targetBase}/index.js`,
    `${targetBase}/index.vue`,
  ];

  return allFiles.find((f) => candidates.some((c) => f.toLowerCase() === c.toLowerCase()));
}

export function buildFlowDiagramVersion(
  run: AnalysisRun,
  flow: FeatureFlow,
  versionNumber = 1,
  versionName = 'Phiên bản phân tích gốc (v1)'
): DiagramVersion {
  const flowSymbols = run.symbols.filter((s) => flow.symbolIds.includes(s.id));
  const flowRelations = run.relations.filter((r) => flow.relationIds.includes(r.id));

  const layerOrder: Record<SymbolCategory, number> = {
    page: 0,
    component: 1,
    composable: 2,
    api_client: 3,
    route: 4,
    middleware: 5,
    controller: 6,
    validation: 7,
    service: 8,
    function: 8,
    module: 5,
    job: 9,
    model: 9,
    table: 10,
    manual: 5,
  };

  const sortedSymbols = [...flowSymbols].sort(
    (a, b) => (layerOrder[a.category] ?? 5) - (layerOrder[b.category] ?? 5)
  );

  const rankGroups = new Map<number, CodeSymbol[]>();
  for (const sym of sortedSymbols) {
    const rank = layerOrder[sym.category] ?? 5;
    const list = rankGroups.get(rank) || [];
    list.push(sym);
    rankGroups.set(rank, list);
  }

  const nodes: DiagramNodeData[] = [];
  let rowIndex = 0;
  const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b);

  for (const rank of sortedRanks) {
    const group = rankGroups.get(rank)!;
    // Wrap wide rows onto sub-rows of max 5 nodes so canvas remains readable even on large flows
    const maxCols = 5;
    for (let chunkStart = 0; chunkStart < group.length; chunkStart += maxCols) {
      const slice = group.slice(chunkStart, chunkStart + maxCols);
      const totalWidth = (slice.length - 1) * 320;
      const startX = 450 - totalWidth / 2;

      slice.forEach((sym, idx) => {
        nodes.push({
          id: sym.id,
          symbolId: sym.id,
          label: sym.label,
          subtitle: `${sym.filePath}:${sym.startLine}`,
          category: sym.category,
          layer: sym.layer,
          filePath: sym.filePath,
          startLine: sym.startLine,
          endLine: sym.endLine,
          methodName: sym.methodName,
          description: sym.description,
          confidence: sym.confidence,
          isManual: false,
          position: {
            x: startX + idx * 320,
            y: 60 + rowIndex * 150,
          },
          metadata: sym.metadata,
        });
      });
      rowIndex++;
    }
  }

  const edges: DiagramEdgeData[] = flowRelations.map((r) => ({
    id: r.id,
    source: r.sourceId,
    target: r.targetId,
    label: r.label,
    type: r.type,
    confidence: r.confidence,
    isManual: false,
  }));

  const mermaidCode = generateMermaidForFlow(nodes, edges);
  const plantUmlCode = generatePlantUmlForFlow(flow.name, nodes, edges);

  return {
    id: `ver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    versionNumber,
    name: versionName,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
    mermaidCode,
    plantUmlCode,
  };
}

export function buildErdDiagramVersion(run: AnalysisRun): DiagramVersion {
  const tableSymbols = run.symbols.filter((s) => s.category === 'table');
  const fkRelations = run.relations.filter((r) => r.type === 'foreign_key');

  const nodes: DiagramNodeData[] = tableSymbols.map((sym, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    return {
      id: sym.id,
      symbolId: sym.id,
      label: sym.name,
      subtitle: `${sym.metadata?.columns?.length || 0} columns`,
      category: 'table',
      layer: 'database',
      filePath: sym.filePath,
      startLine: sym.startLine,
      endLine: sym.endLine,
      description: sym.description,
      confidence: sym.confidence,
      position: {
        x: 90 + col * 380,
        y: 80 + row * 290,
      },
      metadata: sym.metadata,
    };
  });

  const edges: DiagramEdgeData[] = fkRelations.map((r) => ({
    id: r.id,
    source: r.sourceId,
    target: r.targetId,
    label: r.label,
    type: r.type,
    confidence: r.confidence,
  }));

  const erLines: string[] = ['erDiagram'];
  for (const tbl of tableSymbols) {
    const safeTblName = tbl.name.replace(/[^a-zA-Z0-9_]/g, '_');
    erLines.push(`    ${safeTblName} {`);
    for (const col of (tbl.metadata?.columns || []).slice(0, 18)) {
      const keyTag = col.isPrimary ? 'PK' : col.isForeign ? 'FK' : '';
      const cleanType = col.dataType.replace(/[^a-zA-Z0-9_]/g, '_') || 'STRING';
      const cleanColName = col.name.replace(/[^a-zA-Z0-9_]/g, '_');
      erLines.push(`        ${cleanType} ${cleanColName} ${keyTag}`.trimEnd());
    }
    erLines.push('    }');
  }
  for (const rel of fkRelations) {
    const srcName = rel.sourceId.replace('table:', '').replace(/[^a-zA-Z0-9_]/g, '_');
    const tgtName = rel.targetId.replace('table:', '').replace(/[^a-zA-Z0-9_]/g, '_');
    erLines.push(`    ${tgtName} ||--o{ ${srcName} : "${rel.label.replace(/"/g, "'")}"`);
  }

  const plantLines: string[] = ['@startuml', 'hide circle', 'skinparam linetype ortho'];
  for (const tbl of tableSymbols) {
    plantLines.push(`entity "${tbl.name}" as ${tbl.name} {`);
    for (const col of tbl.metadata?.columns || []) {
      plantLines.push(`  ${col.isPrimary ? '* ' : ''}${col.name} : ${col.dataType}`);
    }
    plantLines.push('}');
  }
  for (const rel of fkRelations) {
    const srcName = rel.sourceId.replace('table:', '');
    const tgtName = rel.targetId.replace('table:', '');
    plantLines.push(`${tgtName} ||--o{ ${srcName} : "${rel.label}"`);
  }
  plantLines.push('@enduml');

  return {
    id: `ver_erd_${Date.now()}`,
    versionNumber: 1,
    name: 'Database Schema ERD (v1)',
    createdAt: new Date().toISOString(),
    nodes,
    edges,
    mermaidCode: erLines.join('\n'),
    plantUmlCode: plantLines.join('\n'),
  };
}

function generateDefaultDiagrams(projectId: string, run: AnalysisRun): Diagram[] {
  const diagrams: Diagram[] = [];

  for (const flow of run.featureFlows) {
    const version = buildFlowDiagramVersion(run, flow, 1, 'Phiên bản gốc từ Source Code (v1)');
    diagrams.push({
      id: `diag_flow_${flow.id}`,
      projectId,
      analysisRunId: run.id,
      featureFlowId: flow.id,
      name: flow.name,
      type: 'flowchart',
      direction: 'TB',
      visibility: 'Private',
      shareToken: `cf_${Math.random().toString(36).slice(2, 10)}`,
      currentVersion: 1,
      versions: [version],
      updatedAt: new Date().toISOString(),
    });
  }

  const erdVersion = buildErdDiagramVersion(run);
  diagrams.push({
    id: `diag_erd_${run.id}`,
    projectId,
    analysisRunId: run.id,
    name: 'Sơ đồ ERD Database',
    type: 'erd',
    direction: 'LR',
    visibility: 'Private',
    shareToken: `cf_erd_${Math.random().toString(36).slice(2, 10)}`,
    currentVersion: 1,
    versions: [erdVersion],
    updatedAt: new Date().toISOString(),
  });

  return diagrams;
}
