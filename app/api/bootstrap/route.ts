import { getLatestDraft, listExportedPosts, readConfig } from '@/lib/storage';
import { failure, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await readConfig();
    const [posts, latestDraft] = await Promise.all([
      listExportedPosts(config.rootExportDir),
      getLatestDraft()
    ]);

    return success({ config, posts, latestDraft });
  } catch (error) {
    return failure(error);
  }
}
