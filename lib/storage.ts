import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT_DEFAULT_HTML_ID } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import {
  BLOGGER_HOME_DIR,
  CONFIG_PATH,
  DEFAULT_EXPORT_ROOT,
  DRAFTS_DIR,
  expandHomePath,
  isValidFolderName
} from '@/lib/paths';
import type {
  AppConfig,
  EditablePost,
  ExportResult,
  LegacySource,
  PostImage,
  PostListItem,
  StructuredSource
} from '@/lib/types';

const IMAGE_TOKEN_REGEX = /\[\[img:(\d+)\]\]/g;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBase64(data: string): string {
  const markerIndex = data.indexOf(',');
  if (data.startsWith('data:') && markerIndex !== -1) {
    return data.slice(markerIndex + 1);
  }
  return data;
}

function asBr(text: string): string {
  return text.replace(/\r?\n/g, '<br>\n');
}

function validateFolder(folderName: string): void {
  if (!folderName || !isValidFolderName(folderName)) {
    throw new AppError(
      'Folder name must match /^[a-zA-Z0-9_-]+$/ and cannot be empty.',
      'INVALID_FOLDER',
      400
    );
  }
}

function isRootDefaultIdentifier(folderName: string): boolean {
  return folderName === ROOT_DEFAULT_HTML_ID;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureBaseDirs(): Promise<void> {
  await fs.mkdir(DRAFTS_DIR, { recursive: true });
  await fs.mkdir(BLOGGER_HOME_DIR, { recursive: true });
}

export async function readConfig(): Promise<AppConfig> {
  await ensureBaseDirs();

  if (!(await fileExists(CONFIG_PATH))) {
    const defaultConfig: AppConfig = {
      rootExportDir: DEFAULT_EXPORT_ROOT
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<AppConfig>;

  const rootExportDir = parsed.rootExportDir ? expandHomePath(parsed.rootExportDir) : DEFAULT_EXPORT_ROOT;

  return {
    rootExportDir,
    publish: parsed.publish
      ? {
          method: parsed.publish.method,
          sshUser: parsed.publish.sshUser,
          sshHost: parsed.publish.sshHost,
          sshPort: parsed.publish.sshPort ?? 22,
          remotePath: parsed.publish.remotePath
        }
      : undefined
  };
}

export async function writeConfig(nextConfig: AppConfig): Promise<AppConfig> {
  await ensureBaseDirs();

  const normalized: AppConfig = {
    rootExportDir: expandHomePath(nextConfig.rootExportDir || DEFAULT_EXPORT_ROOT),
    publish: nextConfig.publish
      ? {
          method: nextConfig.publish.method,
          sshUser: nextConfig.publish.sshUser,
          sshHost: nextConfig.publish.sshHost,
          sshPort: nextConfig.publish.sshPort || 22,
          remotePath: nextConfig.publish.remotePath
        }
      : undefined
  };

  await fs.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function draftFileName(folderName: string): string {
  return `${folderName}.json`;
}

export async function saveDraft(input: StructuredSource): Promise<StructuredSource> {
  await ensureBaseDirs();
  validateFolder(input.folderName);

  const draft: StructuredSource = {
    version: 1,
    mode: 'structured',
    title: input.title || input.folderName,
    folderName: input.folderName,
    content: input.content || '',
    images: input.images || [],
    updatedAt: nowIso()
  };

  const draftPath = path.join(DRAFTS_DIR, draftFileName(draft.folderName));
  await fs.writeFile(draftPath, JSON.stringify(draft, null, 2), 'utf-8');

  return draft;
}

export async function getLatestDraft(): Promise<StructuredSource | null> {
  await ensureBaseDirs();

  const files = (await fs.readdir(DRAFTS_DIR)).filter((name) => name.endsWith('.json'));
  if (files.length === 0) {
    return null;
  }

  const withStats = await Promise.all(
    files.map(async (fileName) => {
      const fullPath = path.join(DRAFTS_DIR, fileName);
      const stat = await fs.stat(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
  );

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latest = await fs.readFile(withStats[0].fullPath, 'utf-8');
  return JSON.parse(latest) as StructuredSource;
}

export async function listExportedPosts(rootExportDir: string): Promise<PostListItem[]> {
  const root = expandHomePath(rootExportDir || DEFAULT_EXPORT_ROOT);
  if (!(await fileExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());

  const folderPosts = await Promise.all(
    folders.map(async (folder): Promise<PostListItem | null> => {
      const folderName = folder.name;
      const folderPath = path.join(root, folderName);
      const sourcePath = path.join(folderPath, 'source.json');
      const htmlPath = path.join(folderPath, 'default.html');

      if (await fileExists(sourcePath)) {
        const raw = await fs.readFile(sourcePath, 'utf-8');
        const source = JSON.parse(raw) as Partial<StructuredSource>;
        const stat = await fs.stat(sourcePath);

        return {
          folderName,
          title: source.title || folderName,
          mode: 'structured',
          updatedAt: source.updatedAt || stat.mtime.toISOString()
        };
      }

      if (await fileExists(htmlPath)) {
        const stat = await fs.stat(htmlPath);
        return {
          folderName,
          title: `${folderName} (legacy)`,
          mode: 'legacy',
          updatedAt: stat.mtime.toISOString()
        };
      }

      return null;
    })
  );

  const posts = folderPosts.filter((item): item is PostListItem => Boolean(item));
  const rootDefaultPath = path.join(root, 'default.html');

  if (await fileExists(rootDefaultPath)) {
    const stat = await fs.stat(rootDefaultPath);
    posts.push({
      folderName: ROOT_DEFAULT_HTML_ID,
      title: 'default.html (root)',
      mode: 'legacy',
      updatedAt: stat.mtime.toISOString(),
      isRootDefault: true
    });
  }

  return posts.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export async function loadPostFromExport(
  rootExportDir: string,
  folderName: string
): Promise<EditablePost> {
  const root = expandHomePath(rootExportDir || DEFAULT_EXPORT_ROOT);
  if (isRootDefaultIdentifier(folderName)) {
    const htmlPath = path.join(root, 'default.html');
    if (!(await fileExists(htmlPath))) {
      throw new AppError('Root default.html was not found in the export root.', 'NOT_FOUND', 404);
    }

    const html = await fs.readFile(htmlPath, 'utf-8');
    const stat = await fs.stat(htmlPath);
    return {
      mode: 'legacy',
      folderName,
      html,
      updatedAt: stat.mtime.toISOString(),
      isRootDefault: true
    };
  }

  validateFolder(folderName);
  const postDir = path.join(root, folderName);
  const sourcePath = path.join(postDir, 'source.json');
  const htmlPath = path.join(postDir, 'default.html');

  if (await fileExists(sourcePath)) {
    const raw = await fs.readFile(sourcePath, 'utf-8');
    const source = JSON.parse(raw) as StructuredSource;
    return {
      version: source.version ?? 1,
      mode: 'structured',
      title: source.title || folderName,
      folderName,
      content: source.content || '',
      images: source.images || [],
      updatedAt: source.updatedAt || nowIso()
    };
  }

  if (await fileExists(htmlPath)) {
    const html = await fs.readFile(htmlPath, 'utf-8');
    const stat = await fs.stat(htmlPath);
    const legacy: LegacySource = {
      mode: 'legacy',
      folderName,
      html,
      updatedAt: stat.mtime.toISOString()
    };
    return legacy;
  }

  throw new AppError('Post folder not found or missing default.html/source.json.', 'NOT_FOUND', 404);
}

export async function saveLegacyHtml(
  rootExportDir: string,
  folderName: string,
  html: string
): Promise<void> {
  const root = expandHomePath(rootExportDir || DEFAULT_EXPORT_ROOT);
  if (isRootDefaultIdentifier(folderName)) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'default.html'), html, 'utf-8');
    return;
  }

  validateFolder(folderName);
  const postDir = path.join(root, folderName);
  await fs.mkdir(postDir, { recursive: true });
  const htmlPath = path.join(postDir, 'default.html');
  await fs.writeFile(htmlPath, html, 'utf-8');
}

async function convertImageToPng(image: PostImage): Promise<Buffer> {
  const base64 = normalizeBase64(image.dataBase64);
  const sourceBuffer = Buffer.from(base64, 'base64');

  try {
    return await sharp(sourceBuffer).png().toBuffer();
  } catch {
    throw new AppError(`Image ${image.id} could not be converted to PNG.`, 'BAD_IMAGE', 400);
  }
}

async function copyKatexAssets(outputDir: string): Promise<void> {
  const katexDist = path.join(process.cwd(), 'node_modules', 'katex', 'dist');
  const targetDir = path.join(outputDir, 'katex');
  const targetFonts = path.join(targetDir, 'fonts');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(path.join(katexDist, 'katex.min.css'), path.join(targetDir, 'katex.min.css'));
  await fs.copyFile(path.join(katexDist, 'katex.min.js'), path.join(targetDir, 'katex.min.js'));
  await fs.copyFile(
    path.join(katexDist, 'contrib', 'auto-render.min.js'),
    path.join(targetDir, 'auto-render.min.js')
  );
  await fs.cp(path.join(katexDist, 'fonts'), targetFonts, { recursive: true, force: true });
}

function buildExportHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="./katex/katex.min.css">
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #ffffff;
      color: #242424;
      font-family: "Avenir Next", Avenir, "Helvetica Neue", Arial, sans-serif;
      font-size: 27px;
      line-height: 1.62;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .blog-post {
      width: 100%;
      padding: 28px 22px 64px;
    }

    h1 {
      margin: 0 0 78px;
      color: #202124;
      font-size: 40px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: 0;
    }

    p {
      margin: 0 0 18px;
    }

    .post-image {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 22px 0;
    }

    .katex-display {
      margin: 28px 0;
      overflow-x: auto;
      overflow-y: hidden;
    }

    @media (max-width: 700px) {
      body {
        font-size: 20px;
        line-height: 1.58;
      }

      .blog-post {
        padding: 24px 18px 48px;
      }

      h1 {
        margin-bottom: 52px;
        font-size: 34px;
      }
    }
  </style>
</head>
<body>
<article class="blog-post">
${bodyHtml}
</article>
<script defer src="./katex/katex.min.js"></script>
<script defer src="./katex/auto-render.min.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    }
  });
</script>
</body>
</html>
`;
}

export async function exportPost(
  config: AppConfig,
  input: StructuredSource,
  overwrite: boolean
): Promise<ExportResult> {
  validateFolder(input.folderName);

  const rootExportDir = expandHomePath(config.rootExportDir || DEFAULT_EXPORT_ROOT);
  const targetDir = path.join(rootExportDir, input.folderName);

  await fs.mkdir(rootExportDir, { recursive: true });

  const targetExists = await fileExists(targetDir);
  if (targetExists && !overwrite) {
    const existingEntries = await fs.readdir(targetDir);
    if (existingEntries.length > 0) {
      throw new AppError(
        `Export folder already exists: ${targetDir}`,
        'EXPORT_COLLISION',
        409
      );
    }
  }

  if (targetExists && overwrite) {
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  await fs.mkdir(targetDir, { recursive: true });

  const imagesById = new Map<number, PostImage>(input.images.map((img) => [img.id, img]));
  const imageWrites: Array<{ fileName: string; buffer: Buffer }> = [];

  const htmlParts: string[] = [];
  let lastIndex = 0;
  let imageCount = 0;

  for (const match of input.content.matchAll(IMAGE_TOKEN_REGEX)) {
    const token = match[0];
    const tokenIndex = match.index ?? 0;
    const tokenId = Number(match[1]);

    htmlParts.push(asBr(input.content.slice(lastIndex, tokenIndex)));

    const image = imagesById.get(tokenId);
    if (image) {
      imageCount += 1;
      const fileName = `pic${imageCount}.png`;
      imageWrites.push({
        fileName,
        buffer: await convertImageToPng(image)
      });
      htmlParts.push(`<img class="post-image" src="${fileName}" alt="pic${imageCount}">`);
    } else {
      htmlParts.push(`<!-- missing image token: ${tokenId} -->`);
    }

    lastIndex = tokenIndex + token.length;
  }

  htmlParts.push(asBr(input.content.slice(lastIndex)));

  await Promise.all(
    imageWrites.map((item) => fs.writeFile(path.join(targetDir, item.fileName), item.buffer))
  );

  const source: StructuredSource = {
    version: 1,
    mode: 'structured',
    title: input.title || input.folderName,
    folderName: input.folderName,
    content: input.content,
    images: input.images,
    updatedAt: nowIso()
  };

  await copyKatexAssets(targetDir);

  const html = buildExportHtml(source.title, htmlParts.join(''));
  await fs.writeFile(path.join(targetDir, 'default.html'), html, 'utf-8');
  await fs.writeFile(path.join(targetDir, 'source.json'), JSON.stringify(source, null, 2), 'utf-8');

  return {
    folderPath: targetDir,
    imageCount
  };
}

function validatePublishConfig(config: AppConfig): Required<NonNullable<AppConfig['publish']>> {
  if (!config.publish) {
    throw new AppError('Publish is not configured. Add SSH settings in config first.', 'PUBLISH_CONFIG', 400);
  }

  const { method, sshHost, sshUser, remotePath, sshPort } = config.publish;

  if (!method || !sshHost || !sshUser || !remotePath) {
    throw new AppError('Publish config is incomplete.', 'PUBLISH_CONFIG', 400);
  }

  return {
    method,
    sshHost,
    sshUser,
    sshPort: sshPort || 22,
    remotePath
  };
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new AppError(`${command} failed to start: ${error.message}`, 'PUBLISH_FAILED', 500));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new AppError(
          `${command} exited with code ${code}.\n${stderr || stdout}`,
          'PUBLISH_FAILED',
          500
        )
      );
    });
  });
}

async function ensureRemoteDirectory(sshTarget: string, sshPort: number, remotePath: string): Promise<void> {
  await runCommand('ssh', [
    '-p',
    String(sshPort),
    '-o',
    'BatchMode=yes',
    sshTarget,
    `mkdir -p ${shellQuoteSingle(remotePath)}`
  ]);
}

export async function publishPost(config: AppConfig, folderName: string): Promise<{ command: string }> {
  const publish = validatePublishConfig(config);
  const rootExportDir = expandHomePath(config.rootExportDir || DEFAULT_EXPORT_ROOT);
  const remoteRoot = publish.remotePath.replace(/\/+$/, '');
  const sshTarget = `${publish.sshUser}@${publish.sshHost}`;

  if (isRootDefaultIdentifier(folderName)) {
    const localFile = path.join(rootExportDir, 'default.html');
    const remoteFile = `${remoteRoot}/default.html`;

    if (!(await fileExists(localFile))) {
      throw new AppError('Root default.html does not exist. Save it before publishing.', 'EXPORT_REQUIRED', 400);
    }

    await ensureRemoteDirectory(sshTarget, publish.sshPort, remoteRoot);

    if (publish.method === 'rsync') {
      const args = [
        '-az',
        '-e',
        `ssh -p ${publish.sshPort} -o BatchMode=yes`,
        localFile,
        `${publish.sshUser}@${publish.sshHost}:${remoteFile}`
      ];
      await runCommand('rsync', args);
      return { command: `rsync ${args.join(' ')}` };
    }

    const args = [
      '-P',
      String(publish.sshPort),
      '-o',
      'BatchMode=yes',
      localFile,
      `${publish.sshUser}@${publish.sshHost}:${remoteFile}`
    ];
    await runCommand('scp', args);
    return { command: `scp ${args.join(' ')}` };
  }

  validateFolder(folderName);
  const localFolder = path.join(rootExportDir, folderName);

  if (!(await fileExists(localFolder))) {
    throw new AppError('Export folder does not exist. Run Export first.', 'EXPORT_REQUIRED', 400);
  }

  const remoteFolder = `${remoteRoot}/${folderName}`;
  const remoteRef = `${publish.sshUser}@${publish.sshHost}:${remoteFolder}`;
  await ensureRemoteDirectory(sshTarget, publish.sshPort, remoteFolder);

  if (publish.method === 'rsync') {
    const args = [
      '-az',
      '--delete',
      '-e',
      `ssh -p ${publish.sshPort} -o BatchMode=yes`,
      `${localFolder}/`,
      `${remoteRef}/`
    ];
    await runCommand('rsync', args);
    return { command: `rsync ${args.join(' ')}` };
  }

  const args = [
    '-r',
    '-P',
    String(publish.sshPort),
    '-o',
    'BatchMode=yes',
    `${localFolder}/.`,
    `${remoteRef}/`
  ];
  await runCommand('scp', args);
  return { command: `scp ${args.join(' ')}` };
}
