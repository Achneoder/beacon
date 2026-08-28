<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { goto } from '$app/navigation';
	import { SEARCH_MIN_TERM_LENGTH, type SearchResult, type SearchResultType } from '@beacon/shared';
	import { search } from '$lib/api/search';

	/**
	 * Global search, in the one piece of chrome that is on every screen.
	 *
	 * The design canvas has no search entry point anywhere — this is the roadmap's
	 * open question 3, answered here so the feature has somewhere to live. It should
	 * still go back to the canvas; what is built to the existing tokens is the
	 * sidebar's one structural gap, between the brand and the nav.
	 *
	 * It is an ARIA combobox rather than an input with a div under it, because the
	 * whole interaction is keyboard-driven: ↑/↓ move through results without moving
	 * focus off the field, Enter opens the active one, Escape closes, and `/` from
	 * anywhere on the page focuses it. The canvas leans on hover throughout and must
	 * not be copied literally here.
	 */

	const LIST_ID = 'sidebar-search-results';
	const OPTION_ID = (index: number) => `${LIST_ID}-option-${index}`;
	/** Long enough to not fire on every keystroke, short enough to feel live. */
	const DEBOUNCE_MS = 200;

	let term = $state('');
	let results = $state<SearchResult[]>([]);
	let open = $state(false);
	let loading = $state(false);
	let active = $state(-1);
	let input = $state<HTMLInputElement | null>(null);

	let debounce: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Responses can land out of order — a two-letter query is cheaper than the
	 * four-letter one typed after it. Only the newest request may write to `results`,
	 * or the list flickers back to a stale, broader match.
	 */
	let generation = 0;

	const trimmed = $derived(term.trim());
	const eligible = $derived(trimmed.length >= SEARCH_MIN_TERM_LENGTH);

	/** Grouped for display; `results` stays flat so the keyboard index is unambiguous. */
	const groups = $derived(
		(['document', 'employee'] as SearchResultType[])
			.map((type) => ({ type, items: results.filter((result) => result.type === type) }))
			.filter((group) => group.items.length > 0)
	);

	/** The flat index of a result, so ↑/↓ and the rendered ids agree across groups. */
	function indexOf(result: SearchResult): number {
		return results.indexOf(result);
	}

	function reset(): void {
		open = false;
		active = -1;
	}

	function run(): void {
		clearTimeout(debounce);

		if (!eligible) {
			generation += 1;
			results = [];
			loading = false;
			reset();
			return;
		}

		loading = true;
		open = true;

		debounce = setTimeout(async () => {
			const mine = ++generation;

			try {
				const response = await search(trimmed);
				if (mine !== generation) return;

				results = response.results;
				active = -1;
			} catch {
				// A failed search is an empty one. There is nothing useful to say in a
				// popover this small, and the field must not trap the user in an error.
				if (mine !== generation) return;
				results = [];
			} finally {
				if (mine === generation) loading = false;
			}
		}, DEBOUNCE_MS);
	}

	async function choose(result: SearchResult): Promise<void> {
		term = '';
		results = [];
		reset();
		await goto(result.href);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			reset();
			return;
		}

		if (event.key === 'Enter') {
			if (open && active >= 0 && results[active]) {
				event.preventDefault();
				void choose(results[active]);
			}
			return;
		}

		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		if (results.length === 0) return;

		event.preventDefault();
		open = true;
		// Wraps at both ends, so the list can be walked without watching it.
		const step = event.key === 'ArrowDown' ? 1 : -1;
		active = (active + step + results.length) % results.length;
	}

	/** `/` focuses the field from anywhere, unless the user is already typing. */
	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

		const target = event.target as HTMLElement | null;
		const tag = target?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
			return;
		}

		event.preventDefault();
		input?.focus();
	}

	const statusMessage = $derived(
		!eligible || loading
			? ''
			: results.length === 0
				? $_('search.noResults')
				: $_('search.resultCount', { values: { count: results.length } })
	);
</script>

<svelte:window on:keydown={onWindowKeydown} />

<!-- Blur closes the popover, but only once focus has actually left the whole widget —
     clicking a result moves focus before the click resolves. -->
<div
	class="relative"
	onfocusout={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) reset();
	}}
>
	<label for="sidebar-search" class="sr-only">{$_('search.label')}</label>
	<input
		bind:this={input}
		bind:value={term}
		oninput={run}
		onfocus={() => {
			if (eligible && results.length > 0) open = true;
		}}
		onkeydown={onKeydown}
		id="sidebar-search"
		type="text"
		role="combobox"
		spellcheck="false"
		autocomplete="off"
		placeholder={$_('search.placeholder')}
		aria-expanded={open}
		aria-controls={LIST_ID}
		aria-autocomplete="list"
		aria-activedescendant={active >= 0 ? OPTION_ID(active) : undefined}
		class="w-full rounded-control border border-border-default bg-surface-muted px-3 py-2 text-sm
		       text-ink transition-colors placeholder:text-ink-muted hover:border-ink-muted
		       focus:border-accent focus:outline-2 focus:outline-offset-2 focus:outline-accent"
	/>

	<!-- Announced rather than shown: the count is already visible as a list. -->
	<p aria-live="polite" class="sr-only">{statusMessage}</p>

	{#if open}
		<div
			class="absolute top-full right-0 left-0 z-20 mt-1.5 max-h-80 overflow-y-auto rounded-card
			       border border-border-subtle bg-surface p-1.5 shadow-overlay"
		>
			{#if loading}
				<p class="px-2.5 py-2 text-xs text-ink-muted">{$_('search.searching')}</p>
			{:else if results.length === 0}
				<p class="px-2.5 py-2 text-xs text-ink-muted">{$_('search.noResults')}</p>
			{/if}

			<!-- Divs rather than nested lists: a `listbox` may only contain `option` and
			     `group`, and an intervening `ul`/`li` would break that relationship for a
			     screen reader even though it looks like the right markup. -->
			<div id={LIST_ID} role="listbox" aria-label={$_('search.label')}>
				{#each groups as group (group.type)}
					<div role="group" aria-label={$_(`search.group.${group.type}`)}>
						<p
							aria-hidden="true"
							class="px-2.5 pt-2 pb-1 text-[0.6875rem] font-bold tracking-wider text-ink-muted uppercase"
						>
							{$_(`search.group.${group.type}`)}
						</p>
						{#each group.items as result (result.id)}
							{@const index = indexOf(result)}
							<!--
								Never in the tab order: focus stays in the field and
								`aria-activedescendant` points here, which is what lets ↑/↓ browse
								the list without losing the caret. `tabindex="-1"` marks it
								focusable-by-script only, as the combobox pattern requires.

								The keyboard path for these is `onKeydown` on the input above —
								Enter opens whichever option is active — so the click handler here
								is purely the mouse equivalent and needs no key handler of its own.
							-->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id={OPTION_ID(index)}
								role="option"
								tabindex="-1"
								aria-selected={index === active}
								onclick={() => void choose(result)}
								onmouseenter={() => (active = index)}
								class="cursor-pointer rounded-control px-2.5 py-1.5 aria-selected:bg-accent-soft"
							>
								<span class="block truncate text-sm font-semibold text-ink">{result.title}</span>
								{#if result.subtitle}
									<span class="block truncate text-xs text-ink-muted">{result.subtitle}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
