'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import { ROOT_DEFAULT_HTML_ID } from '@/lib/constants';
import type { AppConfig, EditablePost, PostImage, PostListItem, StructuredSource } from '@/lib/types';

const IMAGE_TOKEN_REGEX = /\[\[img:(\d+)\]\]/g;

const EMPTY_DRAFT: StructuredSource = {
  version: 1,
  mode: 'structured',
  title: '',
  folderName: '',
  content: '',
  images: [],
  updatedAt: new Date().toISOString()
};

const DEFAULT_CONFIG: AppConfig = {
  rootExportDir: '~/webfinal/dailyblog'
};

interface ApiError {
  code?: string;
  message: string;
}

interface BootstrapResponse {
  ok: boolean;
  config: AppConfig;
  posts: PostListItem[];
  latestDraft: StructuredSource | null;
}

function withBr(text: string): string {
  return text.replace(/\r?\n/g, '<br>\n');
}

function buildPreviewHtml(content: string, images: PostImage[]): string {
  const imagesById = new Map<number, PostImage>(images.map((img) => [img.id, img]));

  const htmlParts: string[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(IMAGE_TOKEN_REGEX)) {
    const token = match[0];
    const index = match.index ?? 0;
    const tokenId = Number(match[1]);

    htmlParts.push(withBr(content.slice(lastIndex, index)));

    const image = imagesById.get(tokenId);
    if (image) {
      htmlParts.push(
        `<img src="data:${image.mimeType};base64,${image.dataBase64}" alt="img-${tokenId}">`
      );
    } else {
      htmlParts.push(`<!-- missing image token ${tokenId} -->`);
    }

    lastIndex = index + token.length;
  }

  htmlParts.push(withBr(content.slice(lastIndex)));
  return htmlParts.join('');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function isRootDefaultItem(folderName: string): boolean {
  return folderName === ROOT_DEFAULT_HTML_ID;
}

async function fileToImage(file: File): Promise<{ mimeType: string; dataBase64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image from clipboard.'));
    reader.readAsDataURL(file);
  });

  const [, base64 = ''] = dataUrl.split(',', 2);
  return {
    mimeType: file.type || 'image/png',
    dataBase64: base64
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    const error: ApiError = {
      code: payload?.code,
      message: payload?.message || 'Request failed.'
    };
    throw error;
  }

  return payload as T;
}

export default function HomePage() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [draft, setDraft] = useState<StructuredSource>(EMPTY_DRAFT);
  const [legacyHtml, setLegacyHtml] = useState('');
  const [editorMode, setEditorMode] = useState<'structured' | 'legacy'>('structured');
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [booting, setBooting] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const previewHtml = useMemo(() => {
    return editorMode === 'legacy' ? legacyHtml : buildPreviewHtml(draft.content, draft.images);
  }, [draft.content, draft.images, editorMode, legacyHtml]);

  const publishReady = useMemo(() => {
    const pub = config.publish;
    return Boolean(pub?.method && pub?.sshHost && pub?.sshUser && pub?.remotePath);
  }, [config.publish]);

  useEffect(() => {
    const loadBootstrap = async () => {
      try {
        const payload = await requestJson<BootstrapResponse>('/api/bootstrap');
        setConfig(payload.config || DEFAULT_CONFIG);
        setPosts(payload.posts || []);

        if (payload.latestDraft) {
          setDraft(payload.latestDraft);
        } else {
          setDraft({
            ...EMPTY_DRAFT,
            title: 'Sample Day 1',
            folderName: 'sample-day1',
            content:
              'Welcome to Blogger.\\nUse [[img:1]] placeholders by pasting images directly into the editor.\\n\\nInline math: $a^2+b^2=c^2$\\nDisplay math: $$\\int_0^1 x^2 dx = 1/3$$',
            images: []
          });
        }
      } catch (error) {
        const err = error as ApiError;
        setStatus({ kind: 'error', text: err.message || 'Failed to load app state.' });
      } finally {
        setBooting(false);
      }
    };

    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (!previewRef.current) {
      return;
    }

    renderMathInElement(previewRef.current, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }, [previewHtml]);

  const updatePublishField = (field: keyof NonNullable<AppConfig['publish']>, value: string) => {
    setConfig((prev) => {
      const publish = prev.publish || {
        method: 'rsync',
        sshUser: '',
        sshHost: '',
        sshPort: 22,
        remotePath: ''
      };

      const nextPublish = {
        ...publish,
        [field]: field === 'sshPort' ? Number(value || 22) : value
      };

      return {
        ...prev,
        publish: nextPublish
      };
    });
  };

  const saveConfig = async () => {
    setBusy(true);
    try {
      const payload = await requestJson<{ ok: boolean; config: AppConfig }>('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      setConfig(payload.config);
      const postsPayload = await requestJson<{ ok: boolean; posts: PostListItem[] }>('/api/posts');
      setPosts(postsPayload.posts);
      setStatus({ kind: 'ok', text: 'Config saved. Post list reloaded.' });
    } catch (error) {
      const err = error as ApiError;
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const refreshPosts = async () => {
    try {
      const payload = await requestJson<{ ok: boolean; posts: PostListItem[] }>('/api/posts');
      setPosts(payload.posts);
    } catch (error) {
      const err = error as ApiError;
      setStatus({ kind: 'error', text: err.message });
    }
  };

  const exportPost = async (overwrite: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const payload = await requestJson<{
        ok: boolean;
        result: {
          folderPath: string;
          imageCount: number;
        };
      }>('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, overwrite })
      });

      setStatus({
        kind: 'ok',
        text: `Exported to ${payload.result.folderPath} (${payload.result.imageCount} images).`
      });
      await refreshPosts();
      return true;
    } catch (error) {
      const err = error as ApiError;
      if (err.code === 'EXPORT_COLLISION' && !overwrite) {
        const confirmOverwrite = window.confirm(
          `${err.message}\n\nOverwrite this folder with the current draft?`
        );
        if (confirmOverwrite) {
          return await exportPost(true);
        }
      }

      setStatus({ kind: 'error', text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const publishPost = async () => {
    if (editorMode === 'structured') {
      const exported = await exportPost(true);
      if (!exported) {
        return;
      }
    } else {
      setBusy(true);
      try {
        await requestJson<{ ok: boolean }>('/api/posts/legacy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderName: draft.folderName,
            html: legacyHtml
          })
        });
      } catch (error) {
        const err = error as ApiError;
        setStatus({ kind: 'error', text: err.message });
        return;
      } finally {
        setBusy(false);
      }
    }

    setBusy(true);
    try {
      const payload = await requestJson<{ ok: boolean; result: { command: string } }>('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: draft.folderName })
      });
      setStatus({ kind: 'ok', text: `Publish succeeded: ${payload.result.command}` });
    } catch (error) {
      const err = error as ApiError;
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const openPost = async (folderName: string) => {
    setBusy(true);
    try {
      const payload = await requestJson<{ ok: boolean; post: EditablePost }>(
        `/api/posts/${encodeURIComponent(folderName)}`
      );

      if (payload.post.mode === 'legacy') {
        setEditorMode('legacy');
        setLegacyHtml(payload.post.html);
        const isRootDefault = payload.post.isRootDefault ?? isRootDefaultItem(payload.post.folderName);
        setDraft((prev) => ({
          ...prev,
          folderName: payload.post.folderName,
          title: isRootDefault ? 'default.html (root)' : payload.post.folderName
        }));
        setStatus({
          kind: 'ok',
          text: isRootDefault
            ? 'Loaded root default.html in legacy mode.'
            : `Loaded legacy post: ${payload.post.folderName}`
        });
      } else {
        setEditorMode('structured');
        setDraft(payload.post);
        setStatus({ kind: 'ok', text: `Loaded post: ${payload.post.folderName}` });
      }
    } catch (error) {
      const err = error as ApiError;
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const saveLegacy = async () => {
    setBusy(true);
    try {
      await requestJson<{ ok: boolean }>('/api/posts/legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: draft.folderName,
          html: legacyHtml
        })
      });
      setStatus({ kind: 'ok', text: `Saved legacy HTML for ${draft.folderName}.` });
      await refreshPosts();
    } catch (error) {
      const err = error as ApiError;
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItems = Array.from(event.clipboardData.items).filter((item) =>
      item.type.startsWith('image/')
    );

    if (imageItems.length === 0) {
      return;
    }

    event.preventDefault();

    const files = imageItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) {
      return;
    }

    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    const converted = await Promise.all(files.map((file) => fileToImage(file)));

    let cursorPosition = start;

    setDraft((prev) => {
      let nextId = prev.images.reduce((max, image) => Math.max(max, image.id), 0) + 1;
      const nextImages = [...prev.images];
      const tokens: string[] = [];

      for (const image of converted) {
        const id = nextId;
        nextId += 1;
        nextImages.push({ id, mimeType: image.mimeType, dataBase64: image.dataBase64 });
        tokens.push(`[[img:${id}]]`);
      }

      const insertion = tokens.join('\n');
      cursorPosition = start + insertion.length;

      return {
        ...prev,
        content: `${prev.content.slice(0, start)}${insertion}${prev.content.slice(end)}`,
        images: nextImages,
        updatedAt: new Date().toISOString()
      };
    });

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = cursorPosition;
        textareaRef.current.selectionEnd = cursorPosition;
      }
    });

    setStatus({ kind: 'ok', text: `Inserted ${files.length} image token(s) at cursor.` });
  };

  if (booting) {
    return (
      <main>
        <h1>Blogger</h1>
        <div className="small">Loading local workspace...</div>
      </main>
    );
  }

  const isLegacyRootDefault = editorMode === 'legacy' && isRootDefaultItem(draft.folderName);
  const folderFieldValue = isLegacyRootDefault ? 'default.html (root)' : draft.folderName;

  return (
    <main>
      <h1>ATWU</h1>
      <h1>Make Today Legendary</h1>

      <div className="grid-top">
        <div>
          <label>Post Title</label>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            disabled={editorMode === 'legacy'}
            placeholder="Daily note title"
          />
        </div>

        <div>
          <label>Folder Name</label>
          <input
            value={folderFieldValue}
            onChange={(event) => setDraft({ ...draft, folderName: event.target.value.trim() })}
            disabled={editorMode === 'legacy'}
            placeholder="day21"
          />
        </div>

        <div>
          <label>Root Folder</label>
          <input
            value={config.rootExportDir}
            onChange={(event) => setConfig({ ...config, rootExportDir: event.target.value })}
            placeholder="~/webfinal/dailyblog"
          />
        </div>
      </div>

      <div className="controls">
        <button onClick={saveConfig} disabled={busy}>
          Save Config
        </button>
        <button className="primary" onClick={() => void exportPost(false)} disabled={busy || editorMode === 'legacy'}>
          Export
        </button>
        <button className="primary" onClick={() => void publishPost()} disabled={busy || !publishReady || !draft.folderName}>
          Publish
        </button>
        {editorMode === 'legacy' ? (
          <button onClick={() => void saveLegacy()} disabled={busy}>
            Save Legacy HTML
          </button>
        ) : null}
        <button
          onClick={() => {
            setEditorMode('structured');
            setDraft(EMPTY_DRAFT);
            setLegacyHtml('');
          }}
          disabled={busy}
        >
          New Post
        </button>
      </div>

      <div className={`status ${status?.kind || ''}`}>{status?.text || ''}</div>

      <div className="panel">
        <div className="small">Publish Setup (optional)</div>
        <div className="publish-box">
          <div>
            <label>Method</label>
            <select
              value={config.publish?.method || 'rsync'}
              onChange={(event) => updatePublishField('method', event.target.value)}
            >
              <option value="rsync">rsync</option>
              <option value="scp">scp</option>
            </select>
          </div>
          <div>
            <label>SSH User</label>
            <input
              value={config.publish?.sshUser || ''}
              onChange={(event) => updatePublishField('sshUser', event.target.value)}
              placeholder="ubuntu"
            />
          </div>
          <div>
            <label>SSH Host</label>
            <input
              value={config.publish?.sshHost || ''}
              onChange={(event) => updatePublishField('sshHost', event.target.value)}
              placeholder="example.com"
            />
          </div>
          <div>
            <label>Port</label>
            <input
              value={String(config.publish?.sshPort || 22)}
              onChange={(event) => updatePublishField('sshPort', event.target.value)}
            />
          </div>
          <div>
            <label>Remote Path</label>
            <input
              value={config.publish?.remotePath || ''}
              onChange={(event) => updatePublishField('remotePath', event.target.value)}
              placeholder="/var/www/whatever"
            />
          </div>
        </div>
        <div className="small">
          Publish is disabled until SSH user/host/remote path are set and config is saved.
        </div>
      </div>

      <div className="editor-preview-stack" style={{ marginTop: '12px' }}>
        <section className="panel">
          <div className="small">
            Editor ({editorMode === 'legacy' ? 'legacy raw HTML mode' : 'structured mode'})
          </div>
          {editorMode === 'legacy' ? (
            <textarea
              value={legacyHtml}
              onChange={(event) => setLegacyHtml(event.target.value)}
              placeholder="Legacy default.html contents"
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              onPaste={(event) => void handlePaste(event)}
              placeholder={
                'Type text freely. New lines are preserved with <br> on export.\nPaste images to insert [[img:N]] tokens inline.\nLaTeX delimiters: $$...$$ and $...$ only.'
              }
            />
          )}
          <div className="small" style={{ marginTop: '8px' }}>
            {editorMode === 'legacy'
              ? isLegacyRootDefault
                ? 'Legacy mode edits root default.html directly.'
                : 'Legacy mode edits default.html directly.'
              : `Images in draft: ${draft.images.length}`}
          </div>
        </section>

        <section className="panel">
          <div className="small">Live Preview</div>
          <div className="preview-scroll">
            <div className="preview" ref={previewRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: '12px' }}>
        <div className="small">Posts in Root Folder (source.json preferred, legacy default.html supported)</div>
        <div className="post-list">
          {posts.length === 0 ? <div className="post-item">No exported posts yet.</div> : null}
          {posts.map((post) => (
            <div className="post-item" key={`${post.folderName}-${post.updatedAt}`}>
              <div>
                <div>{post.title}</div>
                <div className="small">
                  {post.isRootDefault ? 'default.html (root)' : post.folderName} | {post.mode} | {formatDate(post.updatedAt)}
                </div>
              </div>
              <button onClick={() => void openPost(post.folderName)} disabled={busy}>
                Open
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
