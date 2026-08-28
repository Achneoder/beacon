/**
 * Client-side form rules, kept in step with the server DTOs in
 * `apps/api/src/modules/auth/dto/`. The API revalidates everything — these exist to
 * name the problem in the user's language before a round trip, not to be the gate.
 *
 * Every failure is reported as a translation key so nothing here is locale-specific.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MIN_ORGANIZATION_NAME_LENGTH = 2;

/**
 * Deliberately not RFC 5322 — that grammar accepts addresses no mail server would.
 * This mirrors what the server's `@IsEmail` accepts: one @, a dotted domain, a
 * two-character-or-longer TLD, and no whitespace.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
	const trimmed = value.trim();

	return EMAIL.test(trimmed) && !trimmed.includes('..');
}

export interface RegistrationFields {
	organizationName: string;
	firstName: string;
	lastName: string;
	email: string;
	password: string;
	passwordConfirm: string;
}

export type FieldErrors<Fields> = Partial<Record<keyof Fields, string>>;

export function validateRegistration(fields: RegistrationFields): FieldErrors<RegistrationFields> {
	const errors: FieldErrors<RegistrationFields> = {};
	const organizationName = fields.organizationName.trim();

	if (!organizationName) errors.organizationName = 'errors.required';
	else if (organizationName.length < MIN_ORGANIZATION_NAME_LENGTH)
		errors.organizationName = 'errors.organizationTooShort';

	if (!fields.firstName.trim()) errors.firstName = 'errors.required';
	if (!fields.lastName.trim()) errors.lastName = 'errors.required';

	if (!fields.email.trim()) errors.email = 'errors.required';
	else if (!isValidEmail(fields.email)) errors.email = 'errors.email';

	if (!fields.password) errors.password = 'errors.required';
	else if (fields.password.length < MIN_PASSWORD_LENGTH)
		errors.password = 'errors.passwordTooShort';

	if (!fields.passwordConfirm) errors.passwordConfirm = 'errors.required';
	// Only worth reporting a mismatch once the password itself is usable, so a short
	// password does not produce two complaints about the same mistake.
	else if (!errors.password && fields.passwordConfirm !== fields.password)
		errors.passwordConfirm = 'errors.passwordMismatch';

	return errors;
}

export interface LoginFields {
	email: string;
	password: string;
}

export function validateLogin(fields: LoginFields): FieldErrors<LoginFields> {
	const errors: FieldErrors<LoginFields> = {};

	if (!fields.email.trim()) errors.email = 'errors.required';
	else if (!isValidEmail(fields.email)) errors.email = 'errors.email';

	if (!fields.password) errors.password = 'errors.required';

	return errors;
}
