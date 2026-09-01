/**
 * Documents: the categories an organization files things under, the documents
 * themselves (owned by one person or organization-wide), their version history, and
 * the access grants that widen who may see one beyond its owner.
 *
 * The upload contract — pdf · docx · jpg, max 20 MB — is defined once here so the
 * dropzone can pre-flight a file before it is sent and the API enforces the same
 * numbers. The file-size formatter lives here for the same reason the time formatters
 * do: a figure printed by the API and one printed by the browser must never disagree.
 */

export const DOCUMENT_ACCESS_SUBJECTS = ['user', 'department', 'role'] as const;

export type DocumentAccessSubject = (typeof DOCUMENT_ACCESS_SUBJECTS)[number];

export const DOCUMENT_ACCESS_LEVELS = ['read', 'write'] as const;

export type DocumentAccessLevel = (typeof DOCUMENT_ACCESS_LEVELS)[number];

/** The three content types the dropzone accepts, by their sniffed MIME type. */
export const ACCEPTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
] as const;

export type AcceptedDocumentType = (typeof ACCEPTED_DOCUMENT_TYPES)[number];

export const ACCEPTED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg'] as const;

/** 20 MB, the cap the canvas's dropzone states. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export function isAcceptedDocumentType(contentType: string): contentType is AcceptedDocumentType {
  return (ACCEPTED_DOCUMENT_TYPES as readonly string[]).includes(contentType);
}

/** Drives the table row's icon — a coarser grouping than the exact MIME type. */
export function documentKindOf(contentType: string): 'pdf' | 'docx' | 'image' | 'other' {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx';
  }
  if (contentType.startsWith('image/')) return 'image';
  return 'other';
}

const BYTES_PER_KILOBYTE = 1024;

/**
 * `0 B`, `812 KB`, `1.4 MB` — base 1024, one decimal above a kilobyte. Rendered in
 * `font-mono` like every other number in the design, per the roadmap's rule that a
 * figure has exactly one formatter shared by every client.
 */
export function formatFileSize(bytes: number): string {
  const value = Math.max(0, Math.round(bytes));
  if (value < BYTES_PER_KILOBYTE) return `${value} B`;

  const units = ['KB', 'MB', 'GB'] as const;
  let scaled = value / BYTES_PER_KILOBYTE;
  let unitIndex = 0;
  while (scaled >= BYTES_PER_KILOBYTE && unitIndex < units.length - 1) {
    scaled /= BYTES_PER_KILOBYTE;
    unitIndex += 1;
  }

  const rounded = scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  return `${rounded} ${units[unitIndex]}`;
}

/** The six categories the canvas names, seeded per organization on first read. */
export interface DocumentCategorySeed {
  key: string;
  name: string;
}

export const DEFAULT_DOCUMENT_CATEGORIES: readonly DocumentCategorySeed[] = [
  { key: 'employment-contract', name: 'Employment contract' },
  { key: 'payslips', name: 'Payslips' },
  { key: 'certificates', name: 'Certificates / trainings' },
  { key: 'id-permits', name: 'ID & permits' },
  { key: 'signed-policies', name: 'Signed policies' },
  { key: 'sick-notes', name: 'Sick notes' },
] as const;

export interface DocumentCategorySummary {
  id: string;
  key: string;
  name: string;
  position: number;
  active: boolean;
}

export interface DocumentSummary {
  id: string;
  title: string;
  categoryId: string;
  categoryName: string;
  ownerId: string | null;
  ownerName: string | null;
  /** Derived from a null owner — the one representation of "organization-wide". */
  scope: 'personal' | 'organization';
  versionId: string;
  versionNumber: number;
  size: number;
  contentType: string;
  filename: string;
  uploadedAt: string;
  uploadedById: string | null;
  uploadedByName: string | null;
  retentionUntil: string | null;
  /** What this caller may do with the document — the UI uses it to decide what to offer. */
  canWrite: boolean;
  canManage: boolean;
}

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  size: number;
  contentType: string;
  filename: string;
  checksum: string;
  uploadedAt: string;
  uploadedById: string | null;
  uploadedByName: string | null;
}

export interface DocumentAccessSummary {
  id: string;
  subject: DocumentAccessSubject;
  subjectId: string;
  subjectName: string;
  level: DocumentAccessLevel;
  grantedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  versions: DocumentVersionSummary[];
  access: DocumentAccessSummary[];
}

/** What the dropzone is actually allowed to promise, read from the server at load. */
export interface DocumentUploadPolicy {
  maxBytes: number;
  acceptedTypes: string[];
  acceptedExtensions: string[];
  encryptedAtRest: boolean;
}

export interface CreateDocumentRequest {
  title: string;
  categoryId: string;
  /** Filing into someone else's record, or organization-wide, needs `document:manage`. */
  ownerId?: string | null;
  organizationWide?: boolean;
  retentionUntil?: string | null;
}

export interface UpdateDocumentRequest {
  title?: string;
  categoryId?: string;
  retentionUntil?: string | null;
}

export interface GrantDocumentAccessRequest {
  subject: DocumentAccessSubject;
  subjectId: string;
  level?: DocumentAccessLevel;
}

export interface CreateDocumentCategoryRequest {
  key: string;
  name: string;
  position?: number;
}
