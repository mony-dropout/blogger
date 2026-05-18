import os from 'node:os';
import path from 'node:path';

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');
export const BLOGGER_HOME_DIR = path.join(os.homedir(), '.blogger');
export const CONFIG_PATH = path.join(BLOGGER_HOME_DIR, 'config.json');

export const DEFAULT_EXPORT_ROOT = path.join(os.homedir(), 'webfinal', 'dailyblog');

export function expandHomePath(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  return inputPath;
}

export function isValidFolderName(folderName: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(folderName);
}
