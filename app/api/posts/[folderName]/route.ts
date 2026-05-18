import { failure, success } from '@/lib/http';
import { loadPostFromExport, readConfig } from '@/lib/storage';

export const dynamic = 'force-dynamic';

interface Params {
  params: {
    folderName: string;
  };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const config = await readConfig();
    const post = await loadPostFromExport(config.rootExportDir, params.folderName);
    return success({ post });
  } catch (error) {
    return failure(error);
  }
}
