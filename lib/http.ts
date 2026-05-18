import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';

export function success(data: unknown) {
  return NextResponse.json({ ok: true, ...((data as object) || {}) });
}

export function failure(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { ok: false, code: error.code, message: error.message },
      { status: error.status }
    );
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json({ ok: false, code: 'INTERNAL_ERROR', message }, { status: 500 });
}
