import fs from 'fs';
import path from 'path';
import { Project } from '@/types/codeflow';
import { analyzeSourceFiles, shouldSkipFile } from '@/lib/analyzer';

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

/**
 * Trả về dự án mẫu ShareSpend cho người dùng lần đầu truy cập
 */
export function getSampleShareSpendProject(): Project {
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
