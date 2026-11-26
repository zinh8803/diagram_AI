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
  SymbolCategory,
  TableColumn,
} from '@/types/codeflow';

const IGNORED_DIRS = new Set([
  'node_modules',
  'vendor',
  'dist',
  '.git',
  '.next',
  'storage',
  'bootstrap/cache',
]);

const SENSITIVE_PATTERNS = [
  /^\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /credentials\.json$/i,
  /secrets?\./i,
];

export function shouldSkipFile(filePath: string, sizeBytes: number): { skip: boolean; reason?: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) {
      return { skip: true, reason: 'Ignored directory' };
    }
  }

  const fileName = parts[parts.length - 1];
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(fileName)) {
      return { skip: true, reason: 'Security policy: sensitive/secret file skipped' };
    }
  }

  if (sizeBytes > 2 * 1024 * 1024) {
    return { skip: true, reason: 'File exceeds 2MB limit' };
  }

  const allowedExt = /\.(php|vue|ts|tsx|js|jsx|mjs|cjs|sql|json|prisma|py|go|java|rb|cs)$/i;
  if (!allowedExt.test(fileName)) {
    return { skip: true, reason: 'Unsupported or binary extension' };
  }

  return { skip: false };
}

function getLineRange(content: string, matchIndex: number, fallbackLength = 15): { startLine: number; endLine: number; snippet: string } {
  const lines = content.split(/\r?\n/);
  const prefix = content.slice(0, matchIndex);
  const startLine = prefix.split(/\r?\n/).length;

  // Find end of block by brace counting if possible
  let openBraces = 0;
  let foundFirstBrace = false;
  let endLine = Math.min(lines.length, startLine + fallbackLength);

  for (let i = startLine - 1; i < Math.min(lines.length, startLine + 65); i++) {
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

export function analyzeSourceFiles(
  projectId: string,
  versionTag: string,
  rawFiles: Record<string, string>,
  skippedCount = 0
): { run: AnalysisRun; diagrams: Diagram[] } {
  const symbols: CodeSymbol[] = [];
  const relations: CodeRelation[] = [];
  const warnings: string[] = [];

  const frontendFrameworks = new Set<string>();
  const backendFrameworks = new Set<string>();
  const dbEngines = new Set<string>();

  // Maps for cross-referencing
  const tableSymbolsByName = new Map<string, CodeSymbol>();
  const modelSymbolsByClass = new Map<string, { symbol: CodeSymbol; tableName: string }>();
  const serviceSymbolsByMethod = new Map<string, CodeSymbol>(); // ClassName.method -> symbol
  const serviceSymbolsByClass = new Map<string, CodeSymbol[]>();
  const controllerSymbolsByAction = new Map<string, CodeSymbol>(); // Controller@method -> symbol
  const routeSymbolsByEndpoint = new Map<string, CodeSymbol>(); // METHOD /path -> symbol
  const apiClientMethods = new Map<string, { symbol: CodeSymbol; httpMethod: string; endpointPath: string }>(); // obj.method -> info
  const composableMethods = new Map<string, CodeSymbol>(); // fnName -> symbol
  const componentSymbolsByName = new Map<string, CodeSymbol>();

  const entries = Object.entries(rawFiles);

  // -------------------------------------------------------------------------
  // STAGE 1: PARSE DATABASE MIGRATIONS & SQL SCHEMA
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    if (filePath.includes('migrations/') || filePath.endsWith('.sql')) {
      dbEngines.add('MySQL');

      // Laravel Schema::create('table_name', function (Blueprint $table) { ... })
      const schemaRegex = /Schema::create\(\s*['"]([\w_]+)['"]\s*,\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\)\s*;/g;
      let match: RegExpExecArray | null;

      while ((match = schemaRegex.exec(content)) !== null) {
        const tableName = match[1];
        const body = match[2];
        const range = getLineRange(content, match.index, 20);
        const columns: TableColumn[] = [];

        const bodyLines = body.split(/\r?\n/);
        for (const line of bodyLines) {
          const trimmed = line.trim();
          if (trimmed.includes('$table->id()')) {
            columns.push({ name: 'id', dataType: 'BIGINT UNSIGNED', isPrimary: true });
          } else if (trimmed.includes('$table->timestamps()')) {
            columns.push({ name: 'created_at', dataType: 'TIMESTAMP', isNullable: true });
            columns.push({ name: 'updated_at', dataType: 'TIMESTAMP', isNullable: true });
          } else {
            const fkMatch = trimmed.match(/\$table->foreignId\(\s*['"]([\w_]+)['"]\s*\)(?:->constrained\(\s*['"]([\w_]+)['"]\s*\))?/);
            if (fkMatch) {
              const colName = fkMatch[1];
              const refTable = fkMatch[2];
              columns.push({
                name: colName,
                dataType: 'BIGINT UNSIGNED',
                isForeign: Boolean(refTable),
                referencesTable: refTable,
                referencesColumn: refTable ? 'id' : undefined,
              });
              continue;
            }

            const colMatch = trimmed.match(/\$table->(string|decimal|integer|boolean|timestamp|text|date|bigInteger)\(\s*['"]([\w_]+)['"]/);
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

        const tableSymbol: CodeSymbol = {
          id: `table:${tableName}`,
          name: tableName,
          label: `Table: ${tableName}`,
          category: 'table',
          layer: 'database',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Bảng dữ liệu MySQL '${tableName}' (${columns.length} cột) được định nghĩa trong migration.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { columns },
        };

        symbols.push(tableSymbol);
        tableSymbolsByName.set(tableName, tableSymbol);
      }

      // 2. Standard SQL CREATE TABLE `table_name` (...)
      const sqlCreateRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|")?([\w_]+)(?:`|")?\s*\(([\s\S]*?)\);/gi;
      let sqlMatch: RegExpExecArray | null;
      while ((sqlMatch = sqlCreateRegex.exec(content)) !== null) {
        const tableName = sqlMatch[1];
        if (tableSymbolsByName.has(tableName)) continue;
        const body = sqlMatch[2];
        const range = getLineRange(content, sqlMatch.index, 20);
        const columns: TableColumn[] = [];

        const colLines = body.split(',');
        for (const rawCol of colLines) {
          const colTrim = rawCol.trim();
          const colDefMatch = colTrim.match(/^(?:`|")?([\w_]+)(?:`|")?\s+([A-Za-z0-9_]+(?:\([^)]+\))?)/i);
          if (colDefMatch && !['PRIMARY', 'KEY', 'CONSTRAINT', 'FOREIGN'].includes(colDefMatch[1].toUpperCase())) {
            const isPk = colTrim.toUpperCase().includes('PRIMARY KEY');
            columns.push({
              name: colDefMatch[1],
              dataType: colDefMatch[2].toUpperCase(),
              isPrimary: isPk,
            });
          }
        }

        const tableSymbol: CodeSymbol = {
          id: `table:${tableName}`,
          name: tableName,
          label: `Table: ${tableName}`,
          category: 'table',
          layer: 'database',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Bảng cơ sở dữ liệu '${tableName}' (${columns.length} cột) được trích xuất từ file SQL.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { columns },
        };

        symbols.push(tableSymbol);
        tableSymbolsByName.set(tableName, tableSymbol);
      }
    }

    // 3. Prisma Schema Models (schema.prisma)
    if (filePath.endsWith('.prisma') || content.includes('datasource db') || content.includes('generator client')) {
      dbEngines.add('Prisma ORM / MySQL');
      const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = modelRegex.exec(content)) !== null) {
        const modelName = pMatch[1];
        const tableName = modelName.toLowerCase() + 's';
        if (tableSymbolsByName.has(tableName) || tableSymbolsByName.has(modelName)) continue;

        const body = pMatch[2];
        const range = getLineRange(content, pMatch.index, 20);
        const columns: TableColumn[] = [];

        const pLines = body.split(/\r?\n/);
        for (const line of pLines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const colName = parts[0];
            const colType = parts[1];
            const isId = trimmed.includes('@id');
            columns.push({
              name: colName,
              dataType: colType,
              isPrimary: isId,
            });
          }
        }

        const tableSymbol: CodeSymbol = {
          id: `table:${modelName}`,
          name: modelName,
          label: `Table: ${modelName}`,
          category: 'table',
          layer: 'database',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          description: `Bảng dữ liệu Prisma Model '${modelName}' (${columns.length} trường).`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: { columns },
        };

        symbols.push(tableSymbol);
        tableSymbolsByName.set(modelName, tableSymbol);
      }
    }
  }

  // Build Foreign Key relations between tables (Verified from migration schema)
  for (const tableSym of tableSymbolsByName.values()) {
    const cols = tableSym.metadata?.columns || [];
    for (const col of cols) {
      if (col.isForeign && col.referencesTable) {
        const targetTable = tableSymbolsByName.get(col.referencesTable);
        if (targetTable) {
          relations.push({
            id: `rel:fk:${tableSym.name}.${col.name}->${targetTable.name}`,
            sourceId: tableSym.id,
            targetId: targetTable.id,
            type: 'foreign_key',
            label: `${col.name} → ${targetTable.name}.id`,
            confidence: 'Verified',
            evidence: `Migration foreignId('${col.name}')->constrained('${targetTable.name}') in ${tableSym.filePath}`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 2: PARSE LARAVEL MODELS & JOBS
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    if (filePath.endsWith('.php') && (filePath.includes('/Models/') || content.includes('extends Model') || content.includes('extends Authenticatable'))) {
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
        symbols.push(modelSym);
        modelSymbolsByClass.set(className, { symbol: modelSym, tableName: inferredTableName });

        const targetTable = tableSymbolsByName.get(inferredTableName);
        if (targetTable) {
          relations.push({
            id: `rel:model-table:${className}->${inferredTableName}`,
            sourceId: modelSym.id,
            targetId: targetTable.id,
            type: 'writes',
            label: `ORM maps to ${inferredTableName}`,
            confidence: tableMatch ? 'Verified' : 'Inferred',
            evidence: tableMatch ? `protected $table = '${inferredTableName}'` : 'Inferred from Eloquent naming convention',
          });
        }

        // Check Eloquent relationships (belongsTo / hasMany)
        const belongsToRegex = /function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*return\s+\$this->belongsTo\(\s*(\w+)::class\s*(?:,\s*['"]([\w_]+)['"])?\s*\)/g;
        let relMatch: RegExpExecArray | null;
        while ((relMatch = belongsToRegex.exec(content)) !== null) {
          const targetClass = relMatch[2];
          const fkColumn = relMatch[3] || `${targetClass.toLowerCase()}_id`;
          // Store in description or check if migration already had FK
          const sourceTable = tableSymbolsByName.get(inferredTableName);
          if (sourceTable) {
            // See if FK relation already exists
            const targetTableGuess = `${targetClass.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}s`;
            const targetTbl = tableSymbolsByName.get(targetTableGuess);
            if (targetTbl) {
              const existingFk = relations.find(
                (r) => r.sourceId === sourceTable.id && r.targetId === targetTbl.id && r.type === 'foreign_key'
              );
              if (!existingFk) {
                relations.push({
                  id: `rel:orm-fk:${sourceTable.name}->${targetTbl.name}`,
                  sourceId: sourceTable.id,
                  targetId: targetTbl.id,
                  type: 'foreign_key',
                  label: `${fkColumn} (ORM Inferred)`,
                  confidence: 'Inferred',
                  evidence: `Inferred from Eloquent belongsTo(${targetClass}::class) in ${filePath}`,
                });
              }
            }
          }
        }
      }
    }

    // Parse Laravel Jobs
    if (filePath.endsWith('.php') && (filePath.includes('/Jobs/') || content.includes('implements ShouldQueue'))) {
      const jobMatch = content.match(/class\s+(\w+)\s+implements\s+ShouldQueue/);
      if (jobMatch) {
        const jobName = jobMatch[1];
        const range = getLineRange(content, jobMatch.index || 0, 28);
        const jobSym: CodeSymbol = {
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
        };
        symbols.push(jobSym);
      }
    }

    // Parse FormRequest validations
    if (filePath.endsWith('.php') && (filePath.includes('/Requests/') || content.includes('extends FormRequest'))) {
      const reqMatch = content.match(/class\s+(\w+)\s+extends\s+FormRequest/);
      if (reqMatch) {
        const reqName = reqMatch[1];
        const range = getLineRange(content, reqMatch.index || 0, 30);
        const reqSym: CodeSymbol = {
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
        };
        symbols.push(reqSym);
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 3: PARSE LARAVEL SERVICES
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    if (filePath.endsWith('.php') && filePath.includes('/Services/')) {
      const classMatch = content.match(/class\s+(\w+)/);
      if (!classMatch) continue;
      const serviceName = classMatch[1];

      const methodRegex = /public\s+function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*[\w\\|]+)?\s*\{/g;
      let mMatch: RegExpExecArray | null;
      const classMethods: CodeSymbol[] = [];

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
          description: `Business Logic Service ${serviceName}::${methodName}()${hasTransaction ? ' [Chạy trong DB Transaction]' : ''}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: {
            hasTransaction,
            isAsyncQueue,
          },
        };

        symbols.push(svcSym);
        serviceSymbolsByMethod.set(`${serviceName}.${methodName}`, svcSym);
        classMethods.push(svcSym);

        // Link Service -> Models used inside this method
        for (const [modelClass, modelInfo] of modelSymbolsByClass.entries()) {
          const modelUsageRegex = new RegExp(`\\b${modelClass}::(create|where|findOrFail|find|update|delete|with)\\b`);
          const mUsage = range.snippet.match(modelUsageRegex);
          if (mUsage) {
            const op = mUsage[1];
            const isWrite = ['create', 'update', 'delete'].includes(op);
            relations.push({
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

        // Link Service -> Queue Jobs dispatched inside this method
        const jobDispatchRegex = /(\w+Job)::dispatch\(/g;
        let jMatch: RegExpExecArray | null;
        while ((jMatch = jobDispatchRegex.exec(range.snippet)) !== null) {
          const jobName = jMatch[1];
          const jobSym = symbols.find((s) => s.id === `job:${jobName}`);
          if (jobSym) {
            relations.push({
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

      serviceSymbolsByClass.set(serviceName, classMethods);
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 4: PARSE LARAVEL CONTROLLERS
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    if (filePath.endsWith('.php') && filePath.includes('/Controllers/')) {
      const classMatch = content.match(/class\s+(\w+)\s+extends\s+Controller/);
      if (!classMatch) continue;
      const controllerName = classMatch[1];

      // Map injected service property names: e.g. protected ExpenseService $expenseService
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

        // Extract condition branches if any
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
          description: `Controller action xử lý request tại ${controllerName}::${methodName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
          metadata: {
            conditions: conditions.length > 0 ? conditions : undefined,
          },
        };

        symbols.push(ctrlSym);
        controllerSymbolsByAction.set(`${controllerName}@${methodName}`, ctrlSym);

        // Check FormRequest validation parameter
        const reqParamMatch = paramsStr.match(/(\w+Request)\s+\$\w+/);
        if (reqParamMatch && reqParamMatch[1] !== 'Request') {
          const reqClassName = reqParamMatch[1];
          const valSym = symbols.find((s) => s.id === `validation:${reqClassName}`);
          if (valSym) {
            relations.push({
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

        // Check Service calls: $this->propName->methodName(...)
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
            relations.push({
              id: `rel:ctrl-svc:${ctrlSym.id}->${targetSvc.id}`,
              sourceId: ctrlSym.id,
              targetId: targetSvc.id,
              type: 'calls',
              label: `${serviceClass}.${calledMethod}()`,
              confidence: 'Verified',
              evidence: `$this->${propName}->${calledMethod}() in ${filePath}:${range.startLine}`,
            });
          } else {
            warnings.push(
              `Không tìm thấy implementation cho ${serviceClass}::${calledMethod}() được gọi từ ${controllerName}@${methodName}`
            );
          }
        }

        // Check direct Model calls from Controller (Rule 5.5: Support Controller calling Model directly without Service)
        for (const [modelClass, modelInfo] of modelSymbolsByClass.entries()) {
          const directModelRegex = new RegExp(`\\b${modelClass}::(with|where|findOrFail|find|create|update|delete)\\b`);
          const dMatch = range.snippet.match(directModelRegex);
          if (dMatch) {
            const op = dMatch[1];
            const isWrite = ['create', 'update', 'delete'].includes(op);
            relations.push({
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

    // 4.2 Generic JS/TS Controllers & Handlers (Express, NestJS, etc.)
    if ((filePath.endsWith('.js') || filePath.endsWith('.ts')) && (filePath.includes('/controllers/') || filePath.includes('Controller') || filePath.includes('/handlers/'))) {
      const fileName = filePath.split('/').pop()?.replace(/\.(js|ts)$/, '') || 'Controller';
      const cleanCtrlName = fileName.charAt(0).toUpperCase() + fileName.slice(1);

      const jsFnRegex = /(?:async\s+function\s+(\w+)|(?:exports\.|const\s+)(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|req)\s*=>)/g;
      let fnMatch: RegExpExecArray | null;
      while ((fnMatch = jsFnRegex.exec(content)) !== null) {
        const actionName = fnMatch[1] || fnMatch[2];
        if (!actionName || actionName === 'module' || actionName === 'router') continue;

        const range = getLineRange(content, fnMatch.index, 20);
        const actionKey = `${cleanCtrlName}@${actionName}`;
        const ctrlSym: CodeSymbol = {
          id: `controller:${cleanCtrlName}@${actionName}`,
          name: `${cleanCtrlName}.${actionName}()`,
          label: `${cleanCtrlName}.${actionName}()`,
          category: 'controller',
          layer: 'backend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName: actionName,
          description: `Backend action handler ${actionName}() trong ${filePath}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        symbols.push(ctrlSym);
        controllerSymbolsByAction.set(actionKey, ctrlSym);
        controllerSymbolsByAction.set(actionName, ctrlSym);
        controllerSymbolsByAction.set(`${fileName}.${actionName}`, ctrlSym);

        // Check DB queries inside controller (Prisma, MySQL pool, Knex)
        const dbQueryMatch = range.snippet.match(/(?:prisma|db|pool|connection)\.(\w+)\.(\w+)|(?:SELECT|INSERT|UPDATE|DELETE)\s+.*FROM\s+([`"]?[\w_]+[`"]?)/i);
        if (dbQueryMatch) {
          const targetTable = dbQueryMatch[1] || dbQueryMatch[3]?.replace(/[`"]/g, '');
          if (targetTable) {
            const tableSym = tableSymbolsByName.get(targetTable) || tableSymbolsByName.get(targetTable.toLowerCase() + 's');
            if (tableSym) {
              relations.push({
                id: `rel:ctrl-db:${ctrlSym.id}->${tableSym.id}`,
                sourceId: ctrlSym.id,
                targetId: tableSym.id,
                type: 'writes',
                label: `DB Query '${tableSym.name}'`,
                confidence: 'Verified',
                evidence: `Database operation on ${tableSym.name} in ${filePath}:${range.startLine}`,
              });
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 5: PARSE ROUTES (LARAVEL & EXPRESS/NODEJS)
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    // 5.1 Laravel Routes
    if (filePath.includes('routes/') && filePath.endsWith('.php')) {
      const routeRegex = /Route::(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,\s*\[\s*(\w+)::class\s*,\s*['"](\w+)['"]\s*\]\s*\)/gi;
      let rMatch: RegExpExecArray | null;

      while ((rMatch = routeRegex.exec(content)) !== null) {
        const httpMethod = rMatch[1].toUpperCase();
        const rawPath = rMatch[2].startsWith('/') ? rMatch[2] : `/${rMatch[2]}`;
        const controllerClass = rMatch[3];
        const actionName = rMatch[4];
        const range = getLineRange(content, rMatch.index, 3);

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
          description: `REST API Endpoint ${httpMethod} ${rawPath} định tuyến tới ${controllerClass}@${actionName}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        symbols.push(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);

        const targetCtrl = controllerSymbolsByAction.get(`${controllerClass}@${actionName}`);
        if (targetCtrl) {
          relations.push({
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

    // 5.2 Express / Node.js Router endpoints (router.get, router.post, app.get...)
    if ((filePath.endsWith('.js') || filePath.endsWith('.ts')) && (filePath.includes('routes') || filePath.includes('controllers') || filePath.includes('api') || content.includes('express') || content.includes('Router()'))) {
      const expressRouteRegex = /(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`](?:[\s\S]*?(?:(\w+Controller)\.(\w+)|(\w+)))?/gi;
      let exMatch: RegExpExecArray | null;
      while ((exMatch = expressRouteRegex.exec(content)) !== null) {
        backendFrameworks.add('Node.js / Express');
        const httpMethod = exMatch[1].toUpperCase();
        const rawPath = exMatch[2].startsWith('/') ? exMatch[2] : `/${exMatch[2]}`;
        const endpointKey = `${httpMethod} ${rawPath}`;
        if (routeSymbolsByEndpoint.has(endpointKey)) continue;

        const range = getLineRange(content, exMatch.index, 8);
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
          description: `Express REST Endpoint ${httpMethod} ${rawPath} trong ${filePath}.`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        symbols.push(routeSym);
        routeSymbolsByEndpoint.set(endpointKey, routeSym);

        // Link to controller if handler method is matched
        const ctrlClass = exMatch[3];
        const ctrlAction = exMatch[4] || exMatch[5];
        if (ctrlAction) {
          const targetCtrl =
            (ctrlClass ? controllerSymbolsByAction.get(`${ctrlClass}@${ctrlAction}`) : null) ||
            controllerSymbolsByAction.get(ctrlAction);
          if (targetCtrl) {
            relations.push({
              id: `rel:route-ctrl:${routeSym.id}->${targetCtrl.id}`,
              sourceId: routeSym.id,
              targetId: targetCtrl.id,
              type: 'calls',
              label: `Dispatches to ${targetCtrl.label}`,
              confidence: 'Verified',
              evidence: `Express route dispatches to handler in ${filePath}`,
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 6: PARSE FRONTEND API CLIENTS & SERVICES (TS/JS)
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    if ((filePath.endsWith('.ts') || filePath.endsWith('.js')) && (filePath.includes('/services/') || filePath.includes('Api'))) {
      const objMatch = content.match(/export\s+const\s+(\w+)\s*=\s*\{/);
      const clientName = objMatch ? objMatch[1] : filePath.split('/').pop()?.replace(/\.\w+$/, '') || 'apiClient';

      // Match async method(params) { ... fetch('/api/...', { method: 'POST' }) }
      const methodRegex = /async\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/g;
      let mMatch: RegExpExecArray | null;

      while ((mMatch = methodRegex.exec(content)) !== null) {
        const methodName = mMatch[1];
        const methodBody = mMatch[2];
        const range = getLineRange(content, mMatch.index, 14);

        const fetchMatch = methodBody.match(/fetch\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{([\s\S]*?)\})?\)/);
        const axiosMatch = methodBody.match(/axios\.(get|post|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/i);

        let httpMethod = 'GET';
        let rawEndpoint = '';

        if (fetchMatch) {
          rawEndpoint = fetchMatch[1];
          const opts = fetchMatch[2] || '';
          const mOpt = opts.match(/method\s*:\s*['"](\w+)['"]/i);
          if (mOpt) httpMethod = mOpt[1].toUpperCase();
        } else if (axiosMatch) {
          httpMethod = axiosMatch[1].toUpperCase();
          rawEndpoint = axiosMatch[2];
        }

        if (rawEndpoint) {
          // Normalize template string variables like `/api/expenses/${id}` -> `/api/expenses/{id}`
          const normalizedEndpoint = rawEndpoint
            .split('?')[0]
            .replace(/\$\{(\w+)\}/g, '{$1}');

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
            description: `Frontend API Client gọi ${httpMethod} ${normalizedEndpoint}.`,
            codeSnippet: range.snippet,
            confidence: 'Verified',
          };

          symbols.push(apiSym);
          apiClientMethods.set(`${clientName}.${methodName}`, {
            symbol: apiSym,
            httpMethod,
            endpointPath: normalizedEndpoint,
          });

          // Link Frontend API Client -> Backend Route
          const endpointKey = `${httpMethod} ${normalizedEndpoint}`;
          const matchedRoute = routeSymbolsByEndpoint.get(endpointKey);

          if (matchedRoute) {
            relations.push({
              id: `rel:fe-be:${apiSym.id}->${matchedRoute.id}`,
              sourceId: apiSym.id,
              targetId: matchedRoute.id,
              type: 'requests',
              label: `HTTP ${endpointKey}`,
              confidence: 'Verified',
              evidence: `fetch('${rawEndpoint}', { method: '${httpMethod}' }) matches Route ${endpointKey}`,
            });
          } else {
            // Try fuzzy match ignoring parameter names
            const fuzzyRoute = Array.from(routeSymbolsByEndpoint.values()).find(
              (r) =>
                r.httpMethod === httpMethod &&
                r.endpointPath?.replace(/\{[^}]+\}/g, '{}') === normalizedEndpoint.replace(/\{[^}]+\}/g, '{}')
            );
            if (fuzzyRoute) {
              relations.push({
                id: `rel:fe-be:${apiSym.id}->${fuzzyRoute.id}`,
                sourceId: apiSym.id,
                targetId: fuzzyRoute.id,
                type: 'requests',
                label: `HTTP ${endpointKey}`,
                confidence: 'Verified',
                evidence: `Parameterized URL '${rawEndpoint}' matches Route '${fuzzyRoute.endpointPath}'`,
              });
            } else {
              warnings.push(`API Client ${clientName}.${methodName}() gọi ${endpointKey} nhưng không tìm thấy Route tương ứng ở Backend.`);
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 7: PARSE VUE/NUXT COMPOSABLES & HOOKS
  // -------------------------------------------------------------------------
  for (const [filePath, content] of entries) {
    if ((filePath.endsWith('.ts') || filePath.endsWith('.js')) && (filePath.includes('/composables/') || filePath.includes('/hooks/'))) {
      frontendFrameworks.add('Vue.js / Nuxt');
      const hookMatch = content.match(/export\s+function\s+(use\w+)/);
      const composableName = hookMatch ? hookMatch[1] : filePath.split('/').pop()?.replace(/\.\w+$/, '') || 'useComposable';

      const fnRegex = /async\s+function\s+(\w+)\s*\([^)]*\)\s*\{/g;
      let fMatch: RegExpExecArray | null;

      while ((fMatch = fnRegex.exec(content)) !== null) {
        const fnName = fMatch[1];
        const range = getLineRange(content, fMatch.index, 16);

        const compSym: CodeSymbol = {
          id: `composable:${composableName}.${fnName}`,
          name: `${composableName}.${fnName}()`,
          label: `${composableName} → ${fnName}()`,
          category: 'composable',
          layer: 'frontend',
          filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          methodName: fnName,
          description: `Vue Composable '${composableName}' quản lý state và gọi API qua hàm ${fnName}().`,
          codeSnippet: range.snippet,
          confidence: 'Verified',
        };

        symbols.push(compSym);
        composableMethods.set(fnName, compSym);

        // Link Composable -> API Client method
        for (const [clientKey, clientInfo] of apiClientMethods.entries()) {
          if (range.snippet.includes(`${clientKey}(`)) {
            relations.push({
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
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 8: PARSE FRONTEND PAGES & COMPONENTS (VUE, NUXT, REACT TSX/JSX)
  // -------------------------------------------------------------------------
  const uiFiles = entries.filter(([filePath]) =>
    filePath.endsWith('.vue') ||
    ((filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) && (filePath.includes('/components/') || filePath.includes('/pages/') || filePath.includes('/views/') || filePath.includes('/app/')))
  );

  for (const [filePath, content] of uiFiles) {
    const isVue = filePath.endsWith('.vue');
    if (isVue) {
      frontendFrameworks.add('Vue.js / Nuxt');
    } else {
      frontendFrameworks.add('React');
    }

    const isPage = filePath.includes('/pages/') || filePath.includes('/views/');
    const rawFileName = filePath.split('/').pop()?.replace(/\.(vue|tsx|jsx)$/, '') || 'Component';
    const cleanName = isPage && !rawFileName.toLowerCase().includes('page')
      ? `${rawFileName.charAt(0).toUpperCase()}${rawFileName.slice(1)}Page`
      : rawFileName;

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
        : `UI Component (${cleanName}).`,
      codeSnippet: content,
      confidence: 'Verified',
    };

    symbols.push(sym);
    componentSymbolsByName.set(cleanName, sym);
  }

  // Second pass: link UI components
  for (const [filePath, content] of uiFiles) {
    const sourceSym = symbols.find((s) => s.filePath === filePath);
    if (!sourceSym) continue;

    for (const [compName, targetCompSym] of componentSymbolsByName.entries()) {
      if (targetCompSym.id === sourceSym.id) continue;
      const tagRegex = new RegExp(`<${compName}\\b`);
      if (tagRegex.test(content)) {
        relations.push({
          id: `rel:ui-render:${sourceSym.id}->${targetCompSym.id}`,
          sourceId: sourceSym.id,
          targetId: targetCompSym.id,
          type: 'renders',
          label: `Renders <${compName} />`,
          confidence: 'Verified',
          evidence: `Render <${compName}> in ${filePath}`,
        });
      }
    }

    // Link Component/Page -> Composable or Hook calls
    for (const [fnName, compMethodSym] of composableMethods.entries()) {
      const fnCallRegex = new RegExp(`\\b${fnName}\\s*\\(`);
      if (fnCallRegex.test(content)) {
        relations.push({
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

    // Link Component/Page -> API calls
    for (const [clientKey, clientInfo] of apiClientMethods.entries()) {
      if (content.includes(`${clientKey}(`)) {
        relations.push({
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
  }

  // -------------------------------------------------------------------------
  // STAGE 9: TRACE END-TO-END FEATURE FLOWS (FE -> BE -> DB)
  // -------------------------------------------------------------------------
  const featureFlows: FeatureFlow[] = [];

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
      desc: 'Luồng xác thực người dùng từ LoginPage → authApi.login → AuthController@login → kiểm tra bảng users và cấp Sanctum Token.',
    },
    'POST /api/groups': {
      title: 'Tạo nhóm chi tiêu (Create Group)',
      desc: 'Luồng tạo nhóm mới và thêm thành viên mặc định trong MySQL transaction.',
    },
  };

  for (const [endpointKey, routeSym] of routeSymbolsByEndpoint.entries()) {
    const flowSymIds = new Set<string>([routeSym.id]);
    const flowRelIds = new Set<string>();

    // 1. Trace Backward to Frontend (API clients -> Composables -> Components -> Pages)
    const incomingToRoute = relations.filter((r) => r.targetId === routeSym.id);
    const backwardQueue: string[] = [];

    for (const rel of incomingToRoute) {
      flowRelIds.add(rel.id);
      flowSymIds.add(rel.sourceId);
      backwardQueue.push(rel.sourceId);
    }

    while (backwardQueue.length > 0) {
      const currentId = backwardQueue.shift()!;
      const callers = relations.filter((r) => r.targetId === currentId);
      for (const rel of callers) {
        if (!flowRelIds.has(rel.id)) {
          flowRelIds.add(rel.id);
        }
        if (!flowSymIds.has(rel.sourceId)) {
          flowSymIds.add(rel.sourceId);
          backwardQueue.push(rel.sourceId);
        }
      }
    }

    // 2. Trace Forward through Backend & Database (Route -> Controller -> Validation/Service/Model -> Table/Job)
    const forwardQueue: string[] = [routeSym.id];
    while (forwardQueue.length > 0) {
      const currentId = forwardQueue.shift()!;
      const outgoing = relations.filter(
        (r) => r.sourceId === currentId && r.type !== 'foreign_key'
      );
      for (const rel of outgoing) {
        if (!flowRelIds.has(rel.id)) {
          flowRelIds.add(rel.id);
        }
        if (!flowSymIds.has(rel.targetId)) {
          flowSymIds.add(rel.targetId);
          forwardQueue.push(rel.targetId);
        }
      }
    }

    const meta = VIETNAMESE_FLOW_TITLES[endpointKey] || {
      title: `Luồng API ${endpointKey}`,
      desc: `Truy vết tự động luồng xử lý từ giao diện đến cơ sở dữ liệu cho endpoint ${endpointKey}.`,
    };

    featureFlows.push({
      id: `flow:${endpointKey.replace(/\s+/g, '_').replace(/\//g, '_')}`,
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

  // Universal Dynamic Fallback: Nếu không tìm thấy Route RESTful chuẩn, tự động sinh các Flow theo nhóm chức năng đã phân tích
  if (featureFlows.length === 0 && symbols.length > 0) {
    featureFlows.push({
      id: 'flow:overview_default',
      name: 'Toàn bộ cấu trúc hệ thống (Universal Architecture Flow)',
      description: 'Hệ thống tự động phát hiện và kết nối toàn bộ các thành phần Frontend, Backend và Database trong dự án.',
      httpMethod: 'ALL',
      endpointPath: '/*',
      entrySymbolId: symbols[0].id,
      symbolIds: symbols.map((s) => s.id),
      relationIds: relations.map((r) => r.id),
      warnings: ['Dự án không dùng khuôn mẫu Laravel thông thường. CodeFlow đã tự động quét toàn diện và sinh đồ thị liên kết động.'],
    });
  }

  // Sort feature flows so POST /api/expenses is first (matching Section 5.4 & 5.5 of feature.md)
  featureFlows.sort((a, b) => {
    if (a.endpointPath === '/api/expenses' && a.httpMethod === 'POST') return -1;
    if (b.endpointPath === '/api/expenses' && b.httpMethod === 'POST') return 1;
    return a.name.localeCompare(b.name);
  });

  const verifiedCount = relations.filter((r) => r.confidence === 'Verified').length;
  const inferredCount = relations.filter((r) => r.confidence === 'Inferred').length;

  const analysisRunId = `run_${Date.now()}`;
  const nowIso = new Date().toISOString();

  const run: AnalysisRun = {
    id: analysisRunId,
    projectId,
    versionTag,
    status: warnings.length > 0 ? 'Completed with warnings' : 'Completed',
    stages: [
      { stage: 1, name: 'Đọc source code', status: 'completed', detail: `${entries.length} files hợp lệ` },
      { stage: 2, name: 'Phân tích cấu trúc', status: 'completed', detail: 'Nhận diện FE, BE, Database' },
      { stage: 3, name: 'Phân tích API', status: 'completed', detail: `${routeSymbolsByEndpoint.size} REST endpoints` },
      { stage: 4, name: 'Phân tích database', status: 'completed', detail: `${tableSymbolsByName.size} MySQL tables` },
      { stage: 5, name: 'Xây dựng quan hệ code', status: 'completed', detail: `${relations.length} liên kết (Verified/Inferred)` },
      { stage: 6, name: 'Sinh sơ đồ', status: 'completed', detail: 'Flowchart, Sequence Diagram, ERD' },
    ],
    startedAt: nowIso,
    completedAt: nowIso,
    detectedFrameworks: {
      frontend: Array.from(frontendFrameworks),
      backend: Array.from(backendFrameworks),
      database: Array.from(dbEngines),
    },
    stats: {
      filesScanned: entries.length,
      filesSkipped: skippedCount,
      endpointsCount: routeSymbolsByEndpoint.size,
      componentsCount: componentSymbolsByName.size,
      tablesCount: tableSymbolsByName.size,
      verifiedRelations: verifiedCount,
      inferredRelations: inferredCount,
    },
    warnings,
    symbols,
    relations,
    featureFlows,
    sourceFiles: rawFiles,
  };

  // Generate default diagrams for the primary feature flow + ERD + Architecture
  const diagrams = generateDefaultDiagrams(projectId, run);

  return { run, diagrams };
}

export function buildFlowDiagramVersion(
  run: AnalysisRun,
  flow: FeatureFlow,
  versionNumber = 1,
  versionName = 'Phiên bản phân tích gốc (v1)'
): DiagramVersion {
  const flowSymbols = run.symbols.filter((s) => flow.symbolIds.includes(s.id));
  const flowRelations = run.relations.filter((r) => flow.relationIds.includes(r.id));

  // Group by layer to compute clean hierarchical layout coordinates
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
    job: 9,
    model: 9,
    table: 10,
    manual: 5,
  };

  const sortedSymbols = [...flowSymbols].sort(
    (a, b) => (layerOrder[a.category] ?? 5) - (layerOrder[b.category] ?? 5)
  );

  // Assign positions per rank row
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
    const totalWidth = (group.length - 1) * 310;
    const startX = 420 - totalWidth / 2;

    group.forEach((sym, idx) => {
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
          x: startX + idx * 310,
          y: 60 + rowIndex * 145,
        },
        metadata: sym.metadata,
      });
    });
    rowIndex++;
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
        x: 100 + col * 370,
        y: 80 + row * 280,
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

  // Build Mermaid erDiagram
  const erLines: string[] = ['erDiagram'];
  for (const tbl of tableSymbols) {
    erLines.push(`    ${tbl.name} {`);
    for (const col of tbl.metadata?.columns || []) {
      const keyTag = col.isPrimary ? 'PK' : col.isForeign ? 'FK' : '';
      const cleanType = col.dataType.replace(/\s+/g, '_');
      erLines.push(`        ${cleanType} ${col.name} ${keyTag}`.trimEnd());
    }
    erLines.push('    }');
  }
  for (const rel of fkRelations) {
    const srcName = rel.sourceId.replace('table:', '');
    const tgtName = rel.targetId.replace('table:', '');
    erLines.push(`    ${tgtName} ||--o{ ${srcName} : "${rel.label}"`);
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

export function generateSequenceMermaid(flow: FeatureFlow, nodes: DiagramNodeData[], edges: DiagramEdgeData[]): string {
  const lines: string[] = [
    'sequenceDiagram',
    '    autonumber',
    '    actor User as Developer / User',
    '    participant FE as Frontend (Vue/Nuxt)',
    '    participant API as Backend Route & Controller',
    '    participant SVC as Service / Business Logic',
    '    participant DB as MySQL Database',
  ];

  const hasFrontend = nodes.some((n) => n.layer === 'frontend');
  const routeNode = nodes.find((n) => n.category === 'route');
  const ctrlNode = nodes.find((n) => n.category === 'controller');
  const valNode = nodes.find((n) => n.category === 'validation');
  const svcNodes = nodes.filter((n) => n.category === 'service');
  const modelNodes = nodes.filter((n) => n.category === 'model');
  const tableNodes = nodes.filter((n) => n.category === 'table');
  const jobNodes = nodes.filter((n) => n.category === 'job');

  if (hasFrontend) {
    const pageOrComp = nodes.find((n) => n.category === 'component' || n.category === 'page');
    const apiClient = nodes.find((n) => n.category === 'api_client');
    lines.push(`    User->>FE: Thao tác trên ${pageOrComp?.label || 'Giao diện'}`);
    if (apiClient && routeNode) {
      lines.push(`    FE->>API: ${apiClient.label} → ${routeNode.label}`);
    } else if (routeNode) {
      lines.push(`    FE->>API: HTTP Request ${routeNode.label}`);
    }
  } else if (routeNode) {
    lines.push(`    User->>API: HTTP Request ${routeNode.label}`);
  }

  if (ctrlNode) {
    lines.push(`    API->>API: Dispatch to ${ctrlNode.label}`);
  }
  if (valNode) {
    lines.push(`    API->>API: Validate request (${valNode.label})`);
  }
  if (ctrlNode?.metadata?.conditions?.length) {
    lines.push(`    alt Điều kiện: ${ctrlNode.metadata.conditions[0]}`);
    lines.push(`        API-->>FE: 422 / 401 Error Response`);
    lines.push(`    else Hợp lệ`);
  }

  if (svcNodes.length > 0) {
    for (const svc of svcNodes) {
      lines.push(`    API->>SVC: Call ${svc.label}`);
      if (svc.metadata?.hasTransaction) {
        lines.push(`    Note over SVC,DB: BEGIN MySQL Transaction`);
      }
    }
    for (const tbl of tableNodes) {
      lines.push(`    SVC->>DB: Query / Persist on table '${tbl.label}'`);
      lines.push(`    DB-->>SVC: Result from '${tbl.label}'`);
    }
    for (const job of jobNodes) {
      lines.push(`    SVC--)API: Dispatch Async Queue (${job.label})`);
    }
    lines.push(`    SVC-->>API: Return domain entity`);
  } else {
    for (const mdl of modelNodes) {
      lines.push(`    API->>DB: Direct Eloquent query via ${mdl.label}`);
      lines.push(`    DB-->>API: Query result`);
    }
  }

  if (ctrlNode?.metadata?.conditions?.length) {
    lines.push(`    end`);
  }

  if (hasFrontend) {
    lines.push(`    API-->>FE: JSON Response (200/201)`);
    lines.push(`    FE-->>User: Cập nhật state & giao diện`);
  } else {
    lines.push(`    API-->>User: JSON Response`);
  }

  return lines.join('\n');
}

export function generateMermaidForFlow(nodes: DiagramNodeData[], edges: DiagramEdgeData[]): string {
  const lines: string[] = ['flowchart TD'];
  const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

  for (const n of nodes) {
    if (n.isHidden) continue;
    const safeId = sanitizeId(n.id);
    const safeLabel = n.label.replace(/"/g, "'");
    const layerTag = n.layer.toUpperCase();
    lines.push(`    ${safeId}["[${layerTag}] ${safeLabel}"]`);
  }

  for (const e of edges) {
    const src = sanitizeId(e.source);
    const tgt = sanitizeId(e.target);
    const safeEdgeLabel = e.label.replace(/"/g, "'");
    const arrow = e.confidence === 'Inferred' ? '-.->' : '-->';
    lines.push(`    ${src} ${arrow}|"${safeEdgeLabel}"| ${tgt}`);
  }

  return lines.join('\n');
}

export function generatePlantUmlForFlow(title: string, nodes: DiagramNodeData[], edges: DiagramEdgeData[]): string {
  const lines: string[] = ['@startuml', `title ${title}`, 'skinparam componentStyle rectangle'];
  const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

  for (const n of nodes) {
    if (n.isHidden) continue;
    lines.push(`component "${n.label}" as ${sanitizeId(n.id)} <<${n.layer}>>`);
  }
  for (const e of edges) {
    const arrow = e.confidence === 'Inferred' ? '..>' : '-->';
    lines.push(`${sanitizeId(e.source)} ${arrow} ${sanitizeId(e.target)} : ${e.label}`);
  }
  lines.push('@enduml');
  return lines.join('\n');
}

function generateDefaultDiagrams(projectId: string, run: AnalysisRun): Diagram[] {
  const diagrams: Diagram[] = [];

  // Create Flowchart & Sequence Diagram for each discovered feature flow
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

  // Create Database ERD Diagram
  const erdVersion = buildErdDiagramVersion(run);
  diagrams.push({
    id: `diag_erd_${run.id}`,
    projectId,
    analysisRunId: run.id,
    name: 'Sơ đồ ERD Database MySQL',
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
