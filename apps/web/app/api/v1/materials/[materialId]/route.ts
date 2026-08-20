import { z } from 'zod';
import { deleteMaterial, getMaterial, updateMaterial } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { materialId } = await params;
  const m = await getMaterial(db(), subjectOf(user), materialId as string);
  return json({
    material: {
      id: m.id,
      title: m.title,
      type: m.materialType,
      byteSize: m.byteSize,
      pageCount: m.pageCount,
      processingStatus: m.processingStatus,
      processingError: m.processingError,
      retentionExpiresAt: m.retentionExpiresAt,
    },
  });
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folder: z.string().trim().max(80).nullable().optional(),
});

export const PATCH = handler(async (request, { params }) => {
  const user = await requireUser();
  const { materialId } = await params;
  const patch = await parseBody(request, patchSchema);
  const material = await updateMaterial(db(), subjectOf(user), materialId as string, patch);
  return json({ material });
});

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { materialId } = await params;
  await deleteMaterial(db(), subjectOf(user), materialId as string);
  return json({ ok: true });
});
