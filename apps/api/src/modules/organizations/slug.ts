/**
 * Turns an organization name into a URL-safe slug. German umlauts get their
 * conventional transliteration ("Groß Büro" -> "gross-buero") rather than being
 * stripped, since de is a first-class locale.
 */
const TRANSLITERATIONS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

export function slugify(name: string): string {
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

/**
 * Appends -2, -3, … until `isTaken` says the candidate is free. The caller supplies the
 * lookup so this stays a pure function over its inputs.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = base || 'organization';

  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? root : `${root.slice(0, 94)}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}
