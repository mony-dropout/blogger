import { failure, success } from '@/lib/http';
import { readConfig, saveLegacyHtml } from '@/lib/storage';

interface LegacySaveBody {
  folderName: string;
  html: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LegacySaveBody;
    const config = await readConfig();
    await saveLegacyHtml(config.rootExportDir, body.folderName, body.html);
    return success({});
  } catch (error) {
    return failure(error);
  }
}
