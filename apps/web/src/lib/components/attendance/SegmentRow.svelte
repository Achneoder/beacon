<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import { formatDuration, type AttendanceSegment } from '@beacon/shared';
	import { Badge } from '$lib/components/ui';
	import { formatTimeRange, sourceKey } from '$lib/attendance/labels';

	type Props = {
		segment: AttendanceSegment;
		/** The user's zone, as the API stated it — never the browser's guess. */
		timezone: string;
	};

	let { segment, timezone }: Props = $props();

	const lang = $derived($locale ?? 'en');
	const range = $derived(
		formatTimeRange(segment.startedAt, segment.endedAt, timezone, lang, $_('today.running'))
	);
	const duration = $derived(
		segment.durationMinutes === null ? null : formatDuration(segment.durationMinutes)
	);
</script>

<li
	class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-3 last:border-b-0"
>
	<span class="font-mono text-sm tabular-nums">{range}</span>
	<Badge tone={segment.kind === 'break' ? 'warning' : 'accent'}>
		{$_(`today.segment.${segment.kind}`)}
	</Badge>
	<span class="text-2xs text-ink-muted">{$_(sourceKey(segment.source))}</span>
	{#if segment.note}
		<span class="min-w-0 flex-1 truncate text-2xs text-ink-muted">{segment.note}</span>
	{/if}
	<span class="ml-auto font-mono text-sm tabular-nums">
		{duration ?? $_('today.running')}
	</span>
</li>
