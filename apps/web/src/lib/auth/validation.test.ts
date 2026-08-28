import { describe, expect, it } from 'vitest';
import { isValidEmail, validateLogin, validateRegistration } from './validation';

const complete = {
	organizationName: 'Acme',
	firstName: 'Ada',
	lastName: 'Lovelace',
	email: 'owner@acme.test',
	password: 'correct-horse-battery',
	passwordConfirm: 'correct-horse-battery'
};

describe('isValidEmail', () => {
	it.each(['owner@acme.test', 'a.b+tag@sub.domain.co.uk', '  spaced@acme.test  '])(
		'accepts %s',
		(value) => expect(isValidEmail(value)).toBe(true)
	);

	// Every one of these passed the old `email.includes('@')` check.
	it.each(['', '@', 'a@', '@b.com', 'owner@acme', 'ow ner@acme.test', 'a@b..com', 'a@@b.com'])(
		'rejects %s',
		(value) => expect(isValidEmail(value)).toBe(false)
	);
});

describe('validateRegistration', () => {
	it('passes a complete form', () => {
		expect(validateRegistration(complete)).toEqual({});
	});

	it('reports a malformed email address', () => {
		expect(validateRegistration({ ...complete, email: 'owner@acme' })).toEqual({
			email: 'errors.email'
		});
	});

	it('distinguishes a missing address from a malformed one', () => {
		expect(validateRegistration({ ...complete, email: '   ' })).toEqual({
			email: 'errors.required'
		});
	});

	it.each(['organizationName', 'firstName', 'lastName'] as const)('requires %s', (field) => {
		expect(validateRegistration({ ...complete, [field]: '  ' })[field]).toBe('errors.required');
	});

	it('rejects an organization name below the length the API accepts', () => {
		expect(validateRegistration({ ...complete, organizationName: 'A' })).toEqual({
			organizationName: 'errors.organizationTooShort'
		});
	});

	it('rejects a short password', () => {
		const errors = validateRegistration({
			...complete,
			password: 'short',
			passwordConfirm: 'short'
		});

		expect(errors.password).toBe('errors.passwordTooShort');
	});

	it('does not complain twice about one short password', () => {
		const errors = validateRegistration({
			...complete,
			password: 'short',
			passwordConfirm: 'short'
		});

		expect(errors.passwordConfirm).toBeUndefined();
	});

	it('reports a mismatched confirmation', () => {
		expect(
			validateRegistration({ ...complete, passwordConfirm: 'correct-horse-batteries' })
		).toEqual({ passwordConfirm: 'errors.passwordMismatch' });
	});

	it('collects every problem at once', () => {
		expect(
			Object.keys(
				validateRegistration({
					organizationName: '',
					firstName: '',
					lastName: '',
					email: 'nope',
					password: '',
					passwordConfirm: ''
				})
			)
		).toHaveLength(6);
	});
});

describe('validateLogin', () => {
	it('passes a filled form', () => {
		expect(validateLogin({ email: 'owner@acme.test', password: 'anything' })).toEqual({});
	});

	it('flags an empty form instead of letting the API answer', () => {
		expect(validateLogin({ email: '', password: '' })).toEqual({
			email: 'errors.required',
			password: 'errors.required'
		});
	});
});
