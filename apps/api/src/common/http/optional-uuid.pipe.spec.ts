import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OptionalUuidPipe } from './optional-uuid.pipe.js';

const pipe = new OptionalUuidPipe();

describe('OptionalUuidPipe', () => {
  it('passes a real uuid through unchanged', () => {
    const id = randomUUID();

    expect(pipe.transform(id)).toBe(id);
  });

  it('accepts an uppercase uuid — Postgres does', () => {
    const id = randomUUID().toUpperCase();

    expect(pipe.transform(id)).toBe(id);
  });

  it.each([undefined, null, '', '   '])('reads %p as no filter at all', (value) => {
    expect(pipe.transform(value)).toBeUndefined();
  });

  it.each(['not-a-uuid', '1', "' or 1=1--", '../../etc/passwd', `${randomUUID()}x`])(
    'refuses %p with a 400 rather than letting Postgres 500',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
