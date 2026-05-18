import { failure, success } from '@/lib/http';
import { readConfig, writeConfig } from '@/lib/storage';
import type { AppConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await readConfig();
    return success({ config });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AppConfig;
    const config = await writeConfig(body);
    return success({ config });
  } catch (error) {
    return failure(error);
  }
}
