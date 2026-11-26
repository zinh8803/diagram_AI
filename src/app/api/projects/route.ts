import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import fs from 'fs';
import { getAllProjects, upsertProject, deleteProjectById, loadSourceFromLocalDirectory } from '@/lib/store';
import { analyzeSourceFiles, shouldSkipFile } from '@/lib/analyzer';
import { Project } from '@/types/codeflow';

export async function GET() {
  const projects = getAllProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // Case 1: Multipart FormData (ZIP Upload)
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
        // Strip top-level wrapper folder if all files share one
        const cleanPath = relativePath.replace(/\\/g, '/');
        const uncompressedContent = await zipEntry.async('string');
        const check = shouldSkipFile(cleanPath, uncompressedContent.length);
        if (check.skip) {
          skippedCount++;
          continue;
        }
        extractedFiles[cleanPath] = uncompressedContent;
      }

      const projectId = `proj_${Date.now()}`;
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

      upsertProject(newProject);
      return NextResponse.json({ project: newProject }, { status: 201 });
    }

    // Case 2: JSON body (Local directory path or re-run analysis or diagram version save)
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

      const projectId = `proj_${Date.now()}`;
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

      upsertProject(newProject);
      return NextResponse.json({ project: newProject }, { status: 201 });
    }

    if (body.action === 'reanalyze') {
      const { projectId, versionNote } = body;
      const projects = getAllProjects();
      const project = projects.find((p) => p.id === projectId);
      if (!project) {
        return NextResponse.json({ error: 'Không tìm thấy project.' }, { status: 404 });
      }

      // Re-read from local rootPath if exists, else re-analyze latest sourceFiles
      let files: Record<string, string> = {};
      let skipped = 0;
      if (project.rootPath && fs.existsSync(project.rootPath)) {
        const res = loadSourceFromLocalDirectory(project.rootPath);
        files = res.files;
        skipped = res.skipped;
      } else if (project.analysisRuns.length > 0) {
        files = project.analysisRuns[0].sourceFiles;
      }

      const runNumber = project.analysisRuns.length + 1;
      const versionTag = versionNote || `v${runNumber}.0 (${new Date().toLocaleTimeString('vi-VN')})`;
      const { run, diagrams } = analyzeSourceFiles(project.id, versionTag, files, skipped);

      // Rule 5.1 & 8.2: Do NOT overwrite old analysis runs or existing diagrams when source code changes
      project.analysisRuns.unshift(run);
      project.diagrams.unshift(...diagrams);
      project.lastAnalyzedAt = run.completedAt;

      upsertProject(project);
      return NextResponse.json({ project, newRun: run });
    }

    if (body.action === 'save_diagram_version') {
      const { projectId, diagramId, versionName, nodes, edges, direction, visibility } = body;
      const projects = getAllProjects();
      const project = projects.find((p) => p.id === projectId);
      if (!project) {
        return NextResponse.json({ error: 'Không tìm thấy project.' }, { status: 404 });
      }

      const diagram = project.diagrams.find((d) => d.id === diagramId);
      if (!diagram) {
        return NextResponse.json({ error: 'Không tìm thấy sơ đồ.' }, { status: 404 });
      }

      if (direction) diagram.direction = direction;
      if (visibility) diagram.visibility = visibility;

      const nextVerNum = diagram.versions.length + 1;
      const prevVer = diagram.versions[diagram.versions.length - 1];

      const newVer = {
        id: `ver_${Date.now()}`,
        versionNumber: nextVerNum,
        name: versionName || `Phiên bản chỉnh sửa (v${nextVerNum})`,
        createdAt: new Date().toISOString(),
        nodes,
        edges,
        mermaidCode: prevVer?.mermaidCode || '',
        plantUmlCode: prevVer?.plantUmlCode || '',
      };

      diagram.versions.push(newVer);
      diagram.currentVersion = nextVerNum;
      diagram.updatedAt = new Date().toISOString();

      upsertProject(project);
      return NextResponse.json({ project, diagram });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Lỗi server khi xử lý yêu cầu.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('id');
  if (!projectId) {
    return NextResponse.json({ error: 'Thiếu project ID' }, { status: 400 });
  }
  deleteProjectById(projectId);
  return NextResponse.json({ deleted: true });
}
