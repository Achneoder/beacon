<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { waitLocale } from 'svelte-i18n';
	import '$lib/i18n';
	import { session } from '$lib/auth/session.svelte';

	let { children } = $props();

	// The access token lives in memory, so a reload starts signed out until the refresh
	// cookie is exchanged. Every route guard waits on this rather than racing it.
	const ready = Promise.all([waitLocale(), session.bootstrap()]);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#await ready}
	<p class="p-10 text-sm text-ink-muted">…</p>
{:then}
	{@render children()}
{/await}
