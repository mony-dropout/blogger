import { AppError } from '@/lib/errors';
import { failure, success } from '@/lib/http';
import { publishPost, readConfig } from '@/lib/storage';

interface PublishBody {
  folderName: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PublishBody;
    if (!body?.folderName) {
      throw new AppError('folderName is required.', 'INVALID_INPUT', 400);
    }

    const config = await readConfig();
    const result = await publishPost(config, body.folderName);
    return success({ result });
  } catch (error) {
    return failure(error);
  }
}
