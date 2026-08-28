<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { Card } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/shell';
</script>

<PageHeader kicker={$_('today.kicker')} title={$_('today.title')} />

<Card variant="panel" as="section" class="mt-6">
	<p class="text-sm text-ink-muted">{$_('today.empty')}</p>
</Card>
