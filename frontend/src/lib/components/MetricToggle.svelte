<script lang="ts">
	import type { MetricDefinition } from '$lib/types';

	interface Props {
		metrics: MetricDefinition[];
		activeMetrics: string[];
		colors: Record<string, string>;
		onToggle: (metricName: string) => void;
	}

	let { metrics, activeMetrics, colors, onToggle }: Props = $props();
</script>

<div class="metric-toggles">
	{#each metrics as metric}
		{@const isActive = activeMetrics.includes(metric.name)}
		<button
			class="metric-pill"
			class:active={isActive}
			style={isActive
				? `background-color: ${colors[metric.name] || '#888'}; color: #fff; border-color: ${colors[metric.name] || '#888'};`
				: `border-color: ${colors[metric.name] || '#888'}; color: ${colors[metric.name] || '#888'};`}
			onclick={() => onToggle(metric.name)}
		>
			{metric.display_name}
		</button>
	{/each}
</div>

<style>
	.metric-toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: center;
	}

	.metric-pill {
		padding: 6px 16px;
		border-radius: 20px;
		border: 2px solid;
		background: transparent;
		cursor: pointer;
		font-size: 0.9rem;
		font-weight: 500;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.metric-pill:hover {
		opacity: 0.85;
	}
</style>
