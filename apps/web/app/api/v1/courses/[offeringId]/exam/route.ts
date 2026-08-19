import { z } from 'zod';
import { generateExam } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({
  questionCount: z.number().int().min(1).max(40).optional(),
  emphasisWeight: z.number().min(0).max(10).optional(),
  weakTopicWeight: z.number().min(0).max(10).optional(),
});

/** Exam Mode: builds a pack from what this course actually contains. */
export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const config = await parseBody(request, schema);
  const pack = await generateExam(db(), subjectOf(user), offeringId as string, config);
  return json({ exam: pack }, 201);
});
