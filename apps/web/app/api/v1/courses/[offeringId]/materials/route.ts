import { Errors, listMaterials, runPending, uploadDirect } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const rows = await listMaterials(db(), subjectOf(user), offeringId as string);
  return json({
    materials: rows.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.materialType,
      byteSize: m.byteSize,
      pageCount: m.pageCount,
      lectureId: m.lectureId,
      processingStatus: m.processingStatus,
      processingError: m.processingError,
      createdAt: m.createdAt,
    })),
  });
});

/** Single-shot multipart upload, for files small enough not to need resuming. */
export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    throw Errors.validation('Send the file as multipart/form-data under the field "file".');
  }

  const lectureId = form.get('lectureId');
  const data = Buffer.from(await file.arrayBuffer());

  const result = await uploadDirect(db(), subjectOf(user), {
    clientRef: `direct-${crypto.randomUUID()}`,
    offeringId: offeringId as string,
    lectureId: typeof lectureId === 'string' && lectureId ? lectureId : null,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    data,
  });

  await runPending(db(), { max: 5 }).catch((error) => {
    console.error('[worker] inline drain failed', error);
  });

  return json({ material: result }, 201);
});
