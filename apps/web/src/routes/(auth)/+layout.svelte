<script lang="ts">
	import { goto } from '$app/navigation';
	import { session } from '$lib/auth/session.svelte';

	let { children } = $props();

	// Signing in again while already signed in is a dead end — send them to the app.
	$effect(() => {
		if (session.isAuthenticated) goto('/');
	});
</script>

<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
	{@render children()}
</main>
