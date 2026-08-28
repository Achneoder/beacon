import { describe, expect, it } from 'vitest';
import {
  formatEmployeeNumber,
  fullName,
  initialsOf,
  parseEmployeeNumber,
} from './employee.js';

describe('formatEmployeeNumber', () => {
  it('pads to four digits behind the prefix', () => {
    expect(formatEmployeeNumber(148)).toBe('BCN-0148');
    expect(formatEmployeeNumber(1)).toBe('BCN-0001');
  });

  it('widens past four digits rather than wrapping', () => {
    expect(formatEmployeeNumber(12_345)).toBe('BCN-12345');
  });

  it('starts at one, so a zero or negative sequence is still a valid number', () => {
    expect(formatEmployeeNumber(0)).toBe('BCN-0001');
    expect(formatEmployeeNumber(-4)).toBe('BCN-0001');
  });

  it('takes a per-organization prefix', () => {
    expect(formatEmployeeNumber(7, 'ACME')).toBe('ACME-0007');
  });
});

describe('parseEmployeeNumber', () => {
  it('round-trips what it formatted', () => {
    expect(parseEmployeeNumber(formatEmployeeNumber(148))).toBe(148);
  });

  it('rejects anything hand-typed', () => {
    expect(parseEmployeeNumber('0148')).toBeNull();
    expect(parseEmployeeNumber('BCN-')).toBeNull();
    expect(parseEmployeeNumber('BCN-0000')).toBeNull();
    expect(parseEmployeeNumber('BCN-12a')).toBeNull();
  });
});

describe('fullName and initialsOf', () => {
  it('joins and initials the two halves', () => {
    const ada = { firstName: 'Ada', lastName: 'Lovelace' };

    expect(fullName(ada)).toBe('Ada Lovelace');
    expect(initialsOf(ada)).toBe('AL');
  });

  it('survives a person recorded with only one name', () => {
    const mononym = { firstName: 'Prince', lastName: '' };

    expect(fullName(mononym)).toBe('Prince');
    expect(initialsOf(mononym)).toBe('P');
  });
});
