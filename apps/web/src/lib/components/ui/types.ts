/** Semantic colour roles shared by the UI primitives. */
export const TONES = ['accent', 'success', 'warning', 'info', 'neutral'] as const;
export type Tone = (typeof TONES)[number];
