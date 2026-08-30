import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/** The shape `randomUUID()` produces, and the only one any Beacon id ever has. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An optional `?userId=`/`?categoryId=` query parameter, validated.
 *
 * Path params have always gone through `ParseUUIDPipe`; query params went straight to
 * MikroORM, where a malformed value reaches Postgres as `invalid input syntax for type
 * uuid` and comes back as a 500. A 400 naming the parameter is both honest and cheaper
 * — a bad id is a client bug, not a server fault.
 *
 * Absent, empty and blank all read as "not filtering", which is what they already
 * meant: every service here tests `if (filter.userId)`, so `?userId=` was ignored
 * rather than refused, and turning that into a 400 would break a caller that works
 * today. `ParseUUIDPipe({ optional: true })` exempts only null and undefined, which is
 * why this is its own pipe rather than a configuration of that one.
 */
@Injectable()
export class OptionalUuidPipe implements PipeTransform<unknown, string | undefined> {
  transform(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;

    const text = String(value).trim();
    if (text === '') return undefined;

    if (!UUID.test(text)) throw new BadRequestException('that id is not a valid uuid');

    return text;
  }
}

/** One instance is enough — the pipe holds no state. */
export const optionalUuid = new OptionalUuidPipe();
