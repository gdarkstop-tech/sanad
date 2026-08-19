import { appendChunk } from '@sanad/core';
import { db } from '@sanad/db';
import { Errors } from '@sanad/core';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

/** Raw bytes with the byte offset in a header — no JSON wrapper, no base64. */
export const PUT = handler(async (request, { params }) => {
  const user = await requireUser();
  const { uploadId } = await params;

  const offsetHeader = request.headers.get('x-upload-offset');
  const offset = Number(offsetHeader);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Errors.validation('x-upload-offset must be a non-negative integer.');
  }

  const chunk = Buffer.from(await request.arrayBuffer());
  if (chunk.byteLength === 0) throw Errors.validation('Empty chunk.');

  const upload = await appendChunk(db(), subjectOf(user), uploadId as string, offset, chunk);
  return json({ upload });
});
