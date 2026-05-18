export type PublishMethod = 'rsync' | 'scp';

export interface PublishConfig {
  method: PublishMethod;
  sshUser: string;
  sshHost: string;
  sshPort: number;
  remotePath: string;
}

export interface AppConfig {
  rootExportDir: string;
  publish?: PublishConfig;
}

export interface PostImage {
  id: number;
  mimeType: string;
  dataBase64: string;
}

export interface StructuredSource {
  version: number;
  mode: 'structured';
  title: string;
  folderName: string;
  content: string;
  images: PostImage[];
  updatedAt: string;
}

export interface LegacySource {
  mode: 'legacy';
  folderName: string;
  html: string;
  updatedAt: string;
  isRootDefault?: boolean;
}

export type EditablePost = StructuredSource | LegacySource;

export interface PostListItem {
  folderName: string;
  title: string;
  mode: 'structured' | 'legacy';
  updatedAt: string;
  isRootDefault?: boolean;
}

export interface ExportResult {
  folderPath: string;
  imageCount: number;
}
