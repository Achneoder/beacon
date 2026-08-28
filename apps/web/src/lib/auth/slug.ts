/**
 * Preview of the slug the API will derive from an organization name. The API decides the
 * real value — including any -2 suffix when the name is taken — so this is only a hint.
 * Kept in step with `apps/api/src/modules/organizations/slug.ts`.
 */
const TRANSLITERATIONS: Record<string, string> = {
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
	ß: 'ss'
};

export function previewSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[äöüß]/g, (char) => TRANSLITERATIONS[char] ?? char)
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100)
		.replace(/-+$/g, '');
}
