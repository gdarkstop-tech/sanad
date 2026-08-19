import { z } from 'zod';

/**
 * Contracts are defined once here and shared by every caller (ARCHITECTURE.md
 * §3.2). When the Python tier arrives in Phase 2, its Pydantic models are
 * generated from these schemas rather than hand-written.
 */

export const PASSWORD_MIN_LENGTH = 10;

const uuid = z.string().uuid();
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** BCP-47-ish. Deliberately permissive: the supported set is configuration. */
export const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/, 'Must be a BCP-47 language tag');

/**
 * Reference data may be selected by id OR created inline by name. Without the
 * second branch, registration deadlocks on empty reference tables (API.md §2).
 */
const referenceRef = <T extends z.ZodRawShape>(createShape: T) =>
  z.union([z.object({ id: uuid }), z.object(createShape)]);

export const universityRefSchema = referenceRef({
  name: nonEmpty(200),
  country: z.string().trim().max(100).optional(),
});
export const facultyRefSchema = referenceRef({ name: nonEmpty(200) });
export const departmentRefSchema = referenceRef({ name: nonEmpty(200) });

export const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
  fullName: nonEmpty(200),
  role: z.enum(['student', 'teaching_assistant', 'instructor']).default('student'),
  interfaceLocale: localeSchema.default('en'),
  timezone: z.string().trim().max(60).default('UTC'),
  profile: z
    .object({
      university: universityRefSchema.optional(),
      faculty: facultyRefSchema.optional(),
      department: departmentRefSchema.optional(),
      academicYearId: uuid.optional(),
      major: z.string().trim().max(200).optional(),
      studentNumber: z.string().trim().max(64).optional(),
    })
    .default({}),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

export const updateMeSchema = z
  .object({
    fullName: nonEmpty(200).optional(),
    interfaceLocale: localeSchema.optional(),
    timezone: z.string().trim().max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

/**
 * `title` is free text. Nothing about a subject is enumerated server-side:
 * every course name is just a string the student typed (brief §32).
 */
export const createCourseSchema = z.object({
  title: nonEmpty(200),
  code: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  departmentId: uuid.optional(),
  primaryLanguage: localeSchema.default('ar'),
  secondaryLanguages: z.array(localeSchema).max(10).default([]),
  term: z
    .union([z.object({ id: uuid }), z.object({ label: nonEmpty(60) })])
    .optional(),
});

export const updateCourseSchema = z
  .object({
    title: nonEmpty(200).optional(),
    code: z.string().trim().max(40).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    primaryLanguage: localeSchema.optional(),
    secondaryLanguages: z.array(localeSchema).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

/**
 * CSRF token transport names.
 *
 * These live in contracts, not core, because the browser and the edge
 * middleware both need them and neither may import server-only code — core
 * pulls in Argon2, which has no browser build.
 */
export const CSRF_COOKIE_NAME = 'sanad_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
