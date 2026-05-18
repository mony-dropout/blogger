import { AppError } from '@/lib/errors';
import { failure, success } from '@/lib/http';
import { exportPost, readConfig } from '@/lib/storage';
import type { StructuredSource } from '@/lib/types';

interface ExportBody {
  draft: StructuredSource;
  overwrite?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportBody;
    if (!body?.draft) {
      throw new AppError('Missing draft payload.', 'INVALID_INPUT', 400);
    }

    const config = await readConfig();
    const result = await exportPost(config, body.draft, Boolean(body.overwrite));
    return success({ result });
  } catch (error) {
    return failure(error);
  }
}
