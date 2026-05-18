import { failure, success } from '@/lib/http';
import { listExportedPosts, readConfig } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await readConfig();
    const posts = await listExportedPosts(config.rootExportDir);
    return success({ posts });
  } catch (error) {
    return failure(error);
  }
}
