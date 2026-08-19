import { deleteMaterial, getMaterial } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

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

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { materialId } = await params;
  await deleteMaterial(db(), subjectOf(user), materialId as string);
  return json({ ok: true });
});
