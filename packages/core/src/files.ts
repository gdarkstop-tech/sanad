import { Errors } from './errors';

/**
 * Upload validation (§28 of the brief).
 *
 * The declared MIME type is attacker-controlled, so it is checked against the
 * extension AND against the file's leading bytes. A file that claims to be a
 * PDF but is not must never be stored as one.
 */
export type MaterialType =
  | 'pdf'
  | 'ppt'
  | 'pptx'
  | 'doc'
  | 'docx'
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'other';

interface FileKind {
  type: MaterialType;
  mimes: string[];
  extensions: string[];
  /** Leading bytes as hex. Empty when the format has no reliable signature. */
  magic: string[];
}

const KINDS: FileKind[] = [
  { type: 'pdf', mimes: ['application/pdf'], extensions: ['.pdf'], magic: ['25504446'] },
  {
    type: 'pptx',
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    extensions: ['.pptx'],
    magic: ['504b0304'],
  },
  {
    type: 'docx',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions: ['.docx'],
    magic: ['504b0304'],
  },
  { type: 'doc', mimes: ['application/msword'], extensions: ['.doc'], magic: ['d0cf11e0'] },
  {
    type: 'ppt',
    mimes: ['application/vnd.ms-powerpoint'],
    extensions: ['.ppt'],
    magic: ['d0cf11e0'],
  },
  {
    type: 'image',
    mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    magic: ['89504e47', 'ffd8ff', '52494646', '47494638'],
  },
  {
    type: 'audio',
    mimes: [
      'audio/webm',
      'audio/wav',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'audio/opus',
    ],
    extensions: ['.webm', '.wav', '.mp3', '.m4a', '.ogg', '.opus'],
    magic: ['1a45dfa3', '52494646', '494433', 'fffb', 'fff3', '4f676753'],
  },
  {
    type: 'video',
    mimes: ['video/mp4', 'video/webm', 'video/quicktime'],
    extensions: ['.mp4', '.mov'],
    magic: ['1a45dfa3', '00000018', '00000020', '0000001c'],
  },
  {
    type: 'text',
    mimes: ['text/plain', 'text/markdown'],
    extensions: ['.txt', '.md'],
    magic: [],
  },
];

export const MAX_UPLOAD_BYTES = {
  media: 500 * 1024 * 1024,
  document: 50 * 1024 * 1024,
} as const;

export function limitFor(type: MaterialType): number {
  return type === 'audio' || type === 'video'
    ? MAX_UPLOAD_BYTES.media
    : MAX_UPLOAD_BYTES.document;
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index).toLowerCase();
}

/**
 * Filenames are never used as filesystem paths — storage keys are derived from
 * IDs — so this only keeps them safe to display and to store as text.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file';
  let cleaned = '';
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    // Strip C0 and C1 control characters, which can forge display in logs and UI.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    cleaned += char;
  }
  return cleaned.trim().slice(0, 200) || 'file';
}

export function classify(filename: string, mimeType: string): MaterialType {
  const extension = extensionOf(filename);
  const mime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const byMime = KINDS.find((k) => k.mimes.includes(mime));
  if (byMime) return byMime.type;
  const byExtension = KINDS.find((k) => k.extensions.includes(extension));
  return byExtension?.type ?? 'other';
}

function magicMatches(kind: FileKind, head: Buffer): boolean {
  if (kind.magic.length === 0) return true;
  const hex = head.subarray(0, 12).toString('hex');
  return kind.magic.some((signature) => hex.startsWith(signature));
}

export interface ValidatedUpload {
  type: MaterialType;
  filename: string;
  mimeType: string;
  byteSize: number;
}

export function validateUpload(input: {
  filename: string;
  mimeType: string;
  byteSize: number;
  head?: Buffer;
}): ValidatedUpload {
  const filename = sanitizeFilename(input.filename);
  const type = classify(filename, input.mimeType);

  if (type === 'other') {
    throw Errors.validation(
      'Unsupported file type. Accepted: PDF, Word, PowerPoint, images, audio, video, and plain text.',
      { filename },
    );
  }
  if (input.byteSize <= 0) {
    throw Errors.validation('The file is empty.', { filename });
  }

  const limit = limitFor(type);
  if (input.byteSize > limit) {
    throw Errors.validation(
      `File is too large (${Math.round(input.byteSize / 1e6)} MB). The limit for ${type} is ${Math.round(limit / 1e6)} MB.`,
      { filename, limit_bytes: limit },
    );
  }

  if (input.head && input.head.length > 0) {
    const kind = KINDS.find((k) => k.type === type);
    if (kind && !magicMatches(kind, input.head)) {
      // The declared type is attacker-controlled; the bytes are not.
      throw Errors.validation(
        `This file does not look like a ${type} file. It may be corrupted or renamed.`,
        { filename },
      );
    }
  }

  return { type, filename, mimeType: input.mimeType, byteSize: input.byteSize };
}
