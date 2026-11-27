import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { getSampleShareSpendProject, loadSourceFromLocalDirectory } from '@/lib/store';
import { analyzeSourceFiles } from '@/lib/analyzer';
import { decodeSource, isSourceText, MAX_SOURCE_BYTES, shouldSkipFile } from '@/lib/sourceFiles';
import type { Project } from '@/types/codeflow';

type Sources = ReturnType<typeof loadSourceFromLocalDirectory>;
type ProjectDetails = Pick<Project, 'name' | 'description' | 'sourceType' | 'rootPath' | 'defaultBranch' | 'repositoryUrl'>;
const emptySourceMessage = 'Không tìm thấy tệp nguồn dạng văn bản để phân tích.';

function emptySourceResponse() {
  return NextResponse.json({ error: emptySourceMessage }, { status: 400 });
}

function isDirectory(directory: unknown): directory is string {
  return typeof directory === 'string' && !!directory && fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true;
}

// Read a bounded amount of uncompressed data, including when the ZIP metadata underreports its size.
function readZipEntry(entry: JSZip.JSZipObject): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = entry.nodeStream('nodebuffer');
    let size = 0;
    stream.on('error', reject);
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_SOURCE_BYTES) {
        stream.pause();
        resolve(undefined);
      } else {
        chunks.push(chunk);
      }
    });
    stream.on('end', () => resolve(decodeSource(Buffer.concat(chunks, size))));
  });
}

async function loadZip(zip: JSZip): Promise<Sources> {
  const files: Record<string, string> = Object.create(null);
  let skipped = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const filePath = entry.name.replace(/\\/g, '/');
    if (shouldSkipFile(filePath, 0).skip) {
      skipped++;
      continue;
    }
    const content = await readZipEntry(entry);
    if (content === undefined) skipped++;
    else files[filePath] = content;
  }
  return { files, skipped };
}

function loadSnapshot(project: Project): Sources {
  const snapshot = project.analysisRuns?.[0];
  const files: Record<string, string> = Object.create(null);
  let skipped = snapshot?.stats?.filesSkipped || 0;
  for (const [name, text] of Object.entries(snapshot?.sourceFiles || {})) {
    const filePath = name.replace(/\\/g, '/');
    if (typeof text !== 'string' || shouldSkipFile(filePath, Buffer.byteLength(text)).skip || !isSourceText(text)) {
      skipped++;
    } else {
      files[filePath] = text;
    }
  }
  return { files, skipped };
}

function createProject(details: ProjectDetails, versionTag: string, sources: Sources) {
  if (!Object.keys(sources.files).length) return emptySourceResponse();
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { run, diagrams } = analyzeSourceFiles(id, versionTag, sources.files, sources.skipped);
  const project: Project = {
    ...details, id,
    mainLanguages: run.languages ?? [],
    createdAt: new Date().toISOString(),
    lastAnalyzedAt: run.completedAt,
    analysisRuns: [run],
    diagrams,
  };
  return NextResponse.json({ project });
}

export async function GET() {
  return NextResponse.json({ sampleProject: getSampleShareSpendProject() });
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await req.formData();
      const zipFile = form.get('zipFile');
      if (!zipFile || typeof zipFile === 'string') {
        return NextResponse.json({ error: 'Vui lòng chọn file ZIP để tải lên.' }, { status: 400 });
      }
      let sources: Sources;
      try {
        sources = await loadZip(await JSZip.loadAsync(await zipFile.arrayBuffer()));
      } catch {
        return NextResponse.json({ error: 'Không thể đọc nội dung tệp ZIP.' }, { status: 400 });
      }
      return createProject({
        name: String(form.get('name') || 'Uploaded Project'),
        description: String(form.get('description') || 'Dự án tải lên từ file ZIP'),
        defaultBranch: String(form.get('defaultBranch') || 'main'),
        sourceType: 'ZIP',
        rootPath: zipFile.name,
      }, `zip-v1 (${zipFile.name})`, sources);
    }

    const body = await req.json();
    if (body.action === 'create_from_files') {
      const { name, description, defaultBranch = 'main', rawFiles } = body;
      if (!rawFiles || typeof rawFiles !== 'object') {
        return emptySourceResponse();
      }
      const files: Record<string, string> = Object.create(null);
      let skipped = 0;
      for (const [namePath, text] of Object.entries(rawFiles)) {
        const filePath = namePath.replace(/\\/g, '/');
        if (typeof text !== 'string' || shouldSkipFile(filePath, Buffer.byteLength(text)).skip || !isSourceText(text)) {
          skipped++;
        } else {
          files[filePath] = text;
        }
      }
      return createProject(
        {
          name: name || 'Folder Project',
          description: description || 'Phân tích từ thư mục chọn trên trình duyệt',
          defaultBranch,
          sourceType: 'ZIP',
          rootPath: name || 'browser-folder',
        },
        `folder-v1 (${defaultBranch})`,
        { files, skipped }
      );
    }

    if (body.action === 'create_from_local') {
      const { name, description, localPath, defaultBranch = 'main' } = body;
      if (!isDirectory(localPath)) {
        return NextResponse.json({ error: 'Đường dẫn thư mục không hợp lệ hoặc không tồn tại.' }, { status: 400 });
      }
      return createProject({
        name: name || path.basename(localPath) || 'Local Project',
        description: description || `Phân tích từ thư mục local: ${localPath}`,
        defaultBranch,
        sourceType: 'GitHub',
        rootPath: localPath,
        repositoryUrl: localPath,
      }, `local-v1 (${defaultBranch})`, loadSourceFromLocalDirectory(localPath));
    }

    if (body.action === 'reanalyze') {
      const project: Project | undefined = body.project;
      if (!project?.id) return NextResponse.json({ error: 'Thiếu dữ liệu project.' }, { status: 400 });
      const { files, skipped } = project.sourceType !== 'ZIP' && isDirectory(project.rootPath)
        ? loadSourceFromLocalDirectory(project.rootPath)
        : loadSnapshot(project);
      if (!Object.keys(files).length) return emptySourceResponse();
      const runNumber = (project.analysisRuns?.length || 0) + 1;
      const versionTag = body.versionNote || `v${runNumber}.0 (${new Date().toLocaleTimeString('vi-VN')})`;
      const { run, diagrams } = analyzeSourceFiles(project.id, versionTag, files, skipped);
      return NextResponse.json({ newRun: run, newDiagrams: diagrams });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi server khi phân tích mã nguồn.' },
      { status: 500 },
    );
  }
}
