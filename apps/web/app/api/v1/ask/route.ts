import { z } from 'zod';
import { RATE_LIMITS, ask, identifierKey, rateLimit } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({
  question: z.string().trim().min(3).max(1000),
  courseId: z.string().uuid().optional(),
});

/**
 * Grounded Q&A. A refusal is a successful response, not an error: the client
 * renders it as an answer, and no generator ran to produce it.
 */
export const POST = handler(async (request) => {
  const user = await requireUser();
  const input = await parseBody(request, schema);

  await rateLimit.enforce(db(), identifierKey('ask', user.id), RATE_LIMITS.askAi);

  const answer = await ask(db(), subjectOf(user), input.question, {
    ...(input.courseId ? { offeringId: input.courseId } : {}),
  });

  return json({
    answer: answer.answer,
    refused: answer.refused,
    refusalReason: answer.refusalReason,
    citations: answer.citations,
    meta: {
      topScore: Number(answer.topScore.toFixed(5)),
      generator: answer.generator,
      mode: answer.mode,
      latencyMs: answer.latencyMs,
    },
  });
});
