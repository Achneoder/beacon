<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { waitLocale } from 'svelte-i18n';
	import '$lib/i18n';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#await waitLocale() then}
	{@render children()}
{/await}
