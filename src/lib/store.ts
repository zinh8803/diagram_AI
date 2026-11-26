import fs from 'fs';
import path from 'path';
import { Project } from '@/types/codeflow';
import { analyzeSourceFiles, shouldSkipFile } from '@/lib/analyzer';

const DATA_DIR = path.join(process.cwd(), '.codeflow-data');
const DB_FILE = path.join(DATA_DIR, 'projects.json');
const SAMPLE_DIR = path.join(process.cwd(), 'sample-projects', 'sharespend');

function readDirectoryRecursive(dirPath: string, baseDir = dirPath): { files: Record<string, string>; skipped: number } {
  const files: Record<string, string> = {};
  let skipped = 0;

  if (!fs.existsSync(dirPath)) {
    return { files, skipped };
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      const checkDir = shouldSkipFile(relPath + '/dummy.ts', 10);
      if (checkDir.reason === 'Ignored directory') {
        skipped++;
        continue;
      }
      const sub = readDirectoryRecursive(fullPath, baseDir);
      Object.assign(files, sub.files);
      skipped += sub.skipped;
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      const check = shouldSkipFile(relPath, stat.size);
      if (check.skip) {
        skipped++;
        continue;
      }
      files[relPath] = fs.readFileSync(fullPath, 'utf-8');
    }
  }

  return { files, skipped };
}

export function loadSourceFromLocalDirectory(dirPath: string): { files: Record<string, string>; skipped: number } {
  return readDirectoryRecursive(dirPath, dirPath);
}

function createSeedShareSpendProject(): Project {
  const projectId = 'proj_sharespend_demo';
  const { files, skipped } = readDirectoryRecursive(SAMPLE_DIR);
  const { run, diagrams } = analyzeSourceFiles(projectId, 'commit-8f4d2a1 (main)', files, skipped);

  return {
    id: projectId,
    name: 'ShareSpend (Laravel + Vue/Nuxt + MySQL)',
    description:
      'Dự án mẫu quản lý & chia sẻ chi tiêu nhóm (Theo mục 5.3 - 5.6 của Đặc tả CodeFlow). Gồm đầy đủ Vue 3 Pages/Components, Composables, API Clients, Laravel Routes, Controllers, FormRequests, Services (DB Transaction), Queue Jobs, Eloquent Models và MySQL Migrations.',
    sourceType: 'Sample',
    repositoryUrl: 'https://github.com/codeflow-demo/sharespend',
    defaultBranch: 'main',
    rootPath: SAMPLE_DIR,
    mainLanguages: ['PHP 8.3 (Laravel)', 'TypeScript', 'Vue 3 / Nuxt 3', 'MySQL'],
    createdAt: new Date().toISOString(),
    lastAnalyzedAt: run.completedAt,
    analysisRuns: [run],
    diagrams,
  };
}

export function getAllProjects(): Project[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const seed = [createSeedShareSpendProject()];
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seed = [createSeedShareSpendProject()];
      fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
      return seed;
    }
    return parsed;
  } catch {
    const seed = [createSeedShareSpendProject()];
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
}

export function saveAllProjects(projects: Project[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

export function getProjectById(projectId: string): Project | undefined {
  const projects = getAllProjects();
  return projects.find((p) => p.id === projectId);
}

export function upsertProject(project: Project): Project {
  const projects = getAllProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    projects[idx] = project;
  } else {
    projects.unshift(project);
  }
  saveAllProjects(projects);
  return project;
}

export function deleteProjectById(projectId: string): boolean {
  const projects = getAllProjects();
  const filtered = projects.filter((p) => p.id !== projectId);
  if (filtered.length === projects.length) return false;
  saveAllProjects(filtered);
  return true;
}
