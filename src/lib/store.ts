import fs from 'fs';
import path from 'path';
import { Project } from '@/types/codeflow';
import { analyzeSourceFiles } from '@/lib/analyzer';
import { decodeSource, shouldSkipDirectory, shouldSkipFile } from '@/lib/sourceFiles';

const SAMPLE_DIR = path.join(process.cwd(), 'sample-projects', 'sharespend');

export function loadSourceFromLocalDirectory(dirPath: string): { files: Record<string, string>; skipped: number } {
  const files: Record<string, string> = Object.create(null);
  let skipped = 0;
  function scan(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relPath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
      try {
        if (entry.isDirectory()) {
          if (shouldSkipDirectory(relPath)) skipped++;
          else scan(fullPath);
        } else if (entry.isFile() && !shouldSkipFile(relPath, fs.statSync(fullPath).size).skip) {
          const content = decodeSource(fs.readFileSync(fullPath));
          if (content === undefined) skipped++;
          else files[relPath] = content;
        } else {
          skipped++;
        }
      } catch (error) {
        // A file may move during the scan or a nested folder may be unreadable.
        if (!['EACCES', 'EPERM', 'ENOENT', 'EBUSY', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        skipped++;
      }
    }
  }
  scan(dirPath);
  return { files, skipped };
}

/**
 * Trả về dự án mẫu ShareSpend cho người dùng lần đầu truy cập
 */
export function getSampleShareSpendProject(): Project {
  const projectId = 'proj_sharespend_demo';
  const { files, skipped } = loadSourceFromLocalDirectory(SAMPLE_DIR);
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
