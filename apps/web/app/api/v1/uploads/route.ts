import { z } from 'zod';
import { openUpload } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

/**
 * Opens (or resumes) an upload. `clientRef` is generated on the device before
 * recording starts, so replaying this call after an ambiguous network failure
 * returns the existing session instead of creating a second lecture.
 */
const schema = z.object({
  clientRef: z.string().trim().min(8).max(200),
  offeringId: z.string().uuid(),
  lectureId: z.string().uuid().nullish(),
  filename: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(1).max(200),
  totalBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const POST = handler(async (request) => {
  const user = await requireUser();
  const input = await parseBody(request, schema);
  const session = await openUpload(db(), subjectOf(user), input);
  return json({ upload: session }, session.resumed ? 200 : 201);
});
