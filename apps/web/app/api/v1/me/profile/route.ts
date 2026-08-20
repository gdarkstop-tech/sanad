import { z } from 'zod';
import { readProfile, updateStudentProfile } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

/**
 * The student's own profile. Scoped to the caller by construction — there is no
 * user id in the path, so there is no other user's profile to ask for.
 */
const schema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  interfaceLocale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  universityName: z.string().trim().max(200).nullable().optional(),
  facultyName: z.string().trim().max(200).nullable().optional(),
  departmentName: z.string().trim().max(200).nullable().optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  major: z.string().trim().max(200).nullable().optional(),
  studentNumber: z.string().trim().max(60).nullable().optional(),
});

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ profile: await readProfile(db(), user) });
});

export const PATCH = handler(async (request) => {
  const user = await requireUser();
  const patch = await parseBody(request, schema);
  return json({ profile: await updateStudentProfile(db(), user, patch) });
});
