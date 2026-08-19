import { listAcademicYears } from '@sanad/core';
import { db } from '@sanad/db';
import { handler, json } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const { id } = await params;
  const academicYears = await listAcademicYears(db(), id as string);
  return json({ academicYears });
});
