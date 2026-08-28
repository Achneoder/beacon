<script lang="ts">
	import type { Tone } from './types';

	type Props = {
		/** Already-localised initials, e.g. "LH". */
		initials: string;
		/** Full name, used as the accessible label. */
		name: string;
		size?: 'sm' | 'md' | 'lg';
		tone?: Extract<Tone, 'accent' | 'info' | 'neutral'>;
		class?: string;
	};

	let { initials, name, size = 'md', tone = 'accent', class: extra = '' }: Props = $props();

	const sizes = {
		sm: 'size-9 text-2xs',
		md: 'size-[34px] text-2xs',
		lg: 'size-[62px] text-xl'
	} as const;

	const tones = {
		accent: 'bg-accent-soft text-accent-on-soft',
		info: 'bg-info-soft text-info',
		neutral: 'bg-surface-muted text-ink-muted'
	} as const;
</script>

<span
	role="img"
	aria-label={name}
	class="grid shrink-0 place-items-center rounded-full font-bold {sizes[size]} {tones[
		tone
	]} {extra}"
>
	<span aria-hidden="true">{initials}</span>
</span>
