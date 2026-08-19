import { z } from 'zod';
import { verifyEmail } from '@sanad/core';
import { db } from '@sanad/db';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({ token: z.string().min(1).max(500) });

export const POST = handler(async (request) => {
  const { token } = await parseBody(request, schema);
  await verifyEmail(db(), token);
  return json({ verified: true });
});
