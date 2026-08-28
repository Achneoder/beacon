<script lang="ts">
	import { locale } from 'svelte-i18n';
	import { session } from '$lib/auth/session.svelte';
	import { formatHeaderDate, resolveTimezone, timezoneLabel } from '$lib/time/zone';

	type Props = {
		/** Localised uppercase kicker above the title. */
		kicker: string;
		/** Localised page title. */
		title: string;
	};

	let { kicker, title }: Props = $props();

	// Phase 1 adds `User.timezone`; until then this is the browser's own zone.
	const timezone = $derived(resolveTimezone(null));
	const lang = $derived($locale ?? session.user?.locale ?? 'en');

	// Read once per render rather than ticking — the header shows a date, not a clock.
	const today = new Date();
	const date = $derived(formatHeaderDate(today, timezone, lang));
	const zone = $derived(timezoneLabel(timezone, lang, today));
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<p class="text-eyebrow font-semibold tracking-eyebrow text-ink-muted uppercase">{kicker}</p>
		<h1 class="mt-1.5 text-3xl font-bold tracking-tighter">{title}</h1>
	</div>
	<p class="text-2xs text-ink-muted">
		{date}
		<span aria-hidden="true" class="px-1.5 text-border-default">/</span>
		<span class="font-mono">{zone}</span>
	</p>
</header>
