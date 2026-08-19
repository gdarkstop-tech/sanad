import { updateMeSchema } from '@sanad/contracts';
import { updateProfile } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ user });
});

export const PATCH = handler(async (request) => {
  const user = await requireUser();
  const patch = await parseBody(request, updateMeSchema);
  const updated = await updateProfile(db(), user.id, patch);
  return json({ user: updated });
});
