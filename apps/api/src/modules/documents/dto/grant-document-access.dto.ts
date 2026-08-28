import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { DocumentAccessLevel, DocumentAccessSubject, GrantDocumentAccessRequest } from '@beacon/shared';
import { DOCUMENT_ACCESS_LEVELS, DOCUMENT_ACCESS_SUBJECTS } from '@beacon/shared';

export class GrantDocumentAccessDto implements GrantDocumentAccessRequest {
  @IsIn(DOCUMENT_ACCESS_SUBJECTS)
  subject!: DocumentAccessSubject;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsIn(DOCUMENT_ACCESS_LEVELS)
  level?: DocumentAccessLevel;
}
