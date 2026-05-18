import { failure, success } from '@/lib/http';
import { saveDraft } from '@/lib/storage';
import type { StructuredSource } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StructuredSource;
    const draft = await saveDraft(body);
    return success({ draft });
  } catch (error) {
    return failure(error);
  }
}
