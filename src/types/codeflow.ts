export type ConfidenceLevel = 'Verified' | 'Inferred' | 'Unknown';

export type LayerType = 'frontend' | 'backend' | 'database' | 'external' | 'source';

export type SymbolCategory =
  | 'module'
  | 'function'
  | 'page'
  | 'component'
  | 'composable'
  | 'api_client'
  | 'route'
  | 'middleware'
  | 'controller'
  | 'validation'
  | 'service'
  | 'model'
  | 'job'
  | 'table'
  | 'manual';

export type RelationType =
  | 'defines'
  | 'renders'
  | 'calls'
  | 'imports'
  | 'requests'
  | 'validates'
  | 'reads'
  | 'writes'
  | 'dispatches'
  | 'foreign_key';

export type AnalysisStatus =
  | 'Pending'
  | 'Processing'
  | 'Completed'
  | 'Completed with warnings'
  | 'Failed'
  | 'Cancelled';

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'erd'
  | 'architecture';

export interface CodeSymbol {
  id: string;
  name: string;
  label: string;
  category: SymbolCategory;
  layer: LayerType;
  filePath: string;
  startLine: number;
  endLine: number;
  methodName?: string;
  httpMethod?: string;
  endpointPath?: string;
  description: string;
  codeSnippet: string;
  confidence: ConfidenceLevel;
  metadata?: {
    hasTransaction?: boolean;
    isAsyncQueue?: boolean;
    conditions?: string[];
    columns?: TableColumn[];
    payloadFields?: string[];
  };
}

export interface TableColumn {
  name: string;
  dataType: string;
  isPrimary?: boolean;
  isForeign?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  referencesTable?: string;
  referencesColumn?: string;
}

export interface CodeRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  label: string;
  confidence: ConfidenceLevel;
  evidence?: string;
  importPath?: string;
}

export interface FeatureFlow {
  kind?: 'endpoint' | 'modules' | 'code';
  id: string;
  name: string;
  description: string;
  httpMethod?: string;
  endpointPath?: string;
  entrySymbolId: string;
  symbolIds: string[];
  relationIds: string[];
  warnings: string[];
}

export interface DiagramNodeData {
  id: string;
  symbolId?: string;
  label: string;
  subtitle?: string;
  category: SymbolCategory;
  layer: LayerType;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  methodName?: string;
  description: string;
  confidence: ConfidenceLevel;
  isManual?: boolean;
  isHidden?: boolean;
  position: { x: number; y: number };
  metadata?: CodeSymbol['metadata'];
}

export interface DiagramEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  type: RelationType;
  confidence: ConfidenceLevel;
  isManual?: boolean;
}

export interface DiagramVersion {
  id: string;
  versionNumber: number;
  name: string;
  createdAt: string;
  nodes: DiagramNodeData[];
  edges: DiagramEdgeData[];
  mermaidCode: string;
  plantUmlCode: string;
}

export interface Diagram {
  id: string;
  projectId: string;
  analysisRunId: string;
  featureFlowId?: string;
  name: string;
  type: DiagramType;
  direction: 'TB' | 'LR';
  visibility: 'Private' | 'Public';
  shareToken: string;
  currentVersion: number;
  versions: DiagramVersion[];
  updatedAt: string;
}

export interface AnalysisStageProgress {
  stage: number;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  detail?: string;
}

export interface AnalysisRun {
  languages?: string[];
  id: string;
  projectId: string;
  versionTag: string;
  status: AnalysisStatus;
  stages: AnalysisStageProgress[];
  startedAt: string;
  completedAt?: string;
  detectedFrameworks: {
    frontend: string[];
    backend: string[];
    database: string[];
  };
  stats: {
    filesScanned: number;
    filesSkipped: number;
    endpointsCount: number;
    componentsCount: number;
    tablesCount: number;
    verifiedRelations: number;
    inferredRelations: number;
  };
  warnings: string[];
  symbols: CodeSymbol[];
  relations: CodeRelation[];
  featureFlows: FeatureFlow[];
  sourceFiles: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  sourceType: 'Sample' | 'ZIP' | 'GitHub';
  repositoryUrl?: string;
  defaultBranch: string;
  rootPath: string;
  mainLanguages: string[];
  createdAt: string;
  lastAnalyzedAt?: string;
  analysisRuns: AnalysisRun[];
  diagrams: Diagram[];
}
