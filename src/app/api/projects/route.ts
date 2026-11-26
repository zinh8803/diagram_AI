import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import fs from 'fs';
import { getSampleShareSpendProject, loadSourceFromLocalDirectory } from '@/lib/store';
import { analyzeSourceFiles, shouldSkipFile } from '@/lib/analyzer';
import { Project } from '@/types/codeflow';

/**
 * GET: Lấy Seed Sample Project (ShareSpend) cho client nếu client chưa có project nào
 */
export async function GET() {
  const sampleProject = getSampleShareSpendProject();
  return NextResponse.json({ sampleProject });
}

/**
 * POST: Server chỉ đóng vai trò Parser Worker (Stateless)
 * Nhận ZIP hoặc path để parse ra cấu trúc AST/Sơ đồ rồi trả về Client
 * Không ghi vào database chung trên Server để đảm bảo tính riêng tư của từng người dùng
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // Case 1: Upload File ZIP từ Client
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const name = (formData.get('name') as string) || 'Uploaded Project';
      const description = (formData.get('description') as string) || 'Dự án tải lên từ file ZIP';
      const defaultBranch = (formData.get('defaultBranch') as string) || 'main';
      const zipFile = formData.get('zipFile') as File | null;

      if (!zipFile) {
        return NextResponse.json({ error: 'Vui lòng chọn file ZIP để tải lên.' }, { status: 400 });
      }

      const arrayBuffer = await zipFile.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const extractedFiles: Record<string, string> = {};
      let skippedCount = 0;

      const entries = Object.entries(zip.files);
      for (const [relativePath, zipEntry] of entries) {
        if (zipEntry.dir) continue;
        const cleanPath = relativePath.replace(/\\/g, '/');
        const uncompressedContent = await zipEntry.async('string');
        const check = shouldSkipFile(cleanPath, uncompressedContent.length);
        if (check.skip) {
          skippedCount++;
          continue;
        }
        extractedFiles[cleanPath] = uncompressedContent;
      }

      const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const versionTag = `zip-v1 (${zipFile.name})`;
      const { run, diagrams } = analyzeSourceFiles(projectId, versionTag, extractedFiles, skippedCount);

      const newProject: Project = {
        id: projectId,
        name,
        description,
        sourceType: 'ZIP',
        defaultBranch,
        rootPath: zipFile.name,
        mainLanguages: [
          ...run.detectedFrameworks.backend,
          ...run.detectedFrameworks.frontend,
          ...run.detectedFrameworks.database,
        ],
        createdAt: new Date().toISOString(),
        lastAnalyzedAt: run.completedAt,
        analysisRuns: [run],
        diagrams,
      };

      return NextResponse.json({ project: newProject }, { status: 200 });
    }

    // Case 2: Phân tích từ thư mục local hoặc Re-analyze từ files
    const body = await req.json();

    if (body.action === 'create_from_local') {
      const { name, description, localPath, defaultBranch = 'main' } = body;
      if (!localPath || !fs.existsSync(localPath)) {
        return NextResponse.json(
          { error: `Đường dẫn thư mục không tồn tại: ${localPath}` },
          { status: 400 }
        );
      }

      const { files, skipped } = loadSourceFromLocalDirectory(localPath);
      if (Object.keys(files).length === 0) {
        return NextResponse.json(
          { error: 'Không tìm thấy file source code hợp lệ (.php, .vue, .ts, .js, .sql) trong thư mục.' },
          { status: 400 }
        );
      }

      const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const versionTag = `local-v1 (${defaultBranch})`;
      const { run, diagrams } = analyzeSourceFiles(projectId, versionTag, files, skipped);

      const newProject: Project = {
        id: projectId,
        name: name || localPath.split(/[\\/]/).pop() || 'Local Project',
        description: description || `Phân tích từ thư mục local: ${localPath}`,
        sourceType: 'GitHub',
        repositoryUrl: localPath,
        defaultBranch,
        rootPath: localPath,
        mainLanguages: [
          ...run.detectedFrameworks.backend,
          ...run.detectedFrameworks.frontend,
          ...run.detectedFrameworks.database,
        ],
        createdAt: new Date().toISOString(),
        lastAnalyzedAt: run.completedAt,
        analysisRuns: [run],
        diagrams,
      };

      return NextResponse.json({ project: newProject }, { status: 200 });
    }

    if (body.action === 'reanalyze') {
      const { project, versionNote } = body;
      if (!project) {
        return NextResponse.json({ error: 'Thiếu dữ liệu project.' }, { status: 400 });
      }

      let files: Record<string, string> = {};
      let skipped = 0;
      if (project.rootPath && fs.existsSync(project.rootPath)) {
        const res = loadSourceFromLocalDirectory(project.rootPath);
        files = res.files;
        skipped = res.skipped;
      } else if (project.analysisRuns?.length > 0) {
        files = project.analysisRuns[0].sourceFiles || {};
      }

      const runNumber = (project.analysisRuns?.length || 0) + 1;
      const versionTag = versionNote || `v${runNumber}.0 (${new Date().toLocaleTimeString('vi-VN')})`;
      const { run, diagrams } = analyzeSourceFiles(project.id, versionTag, files, skipped);

      return NextResponse.json({ newRun: run, newDiagrams: diagrams }, { status: 200 });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Lỗi server khi phân tích mã nguồn.' },
      { status: 500 }
    );
  }
}
