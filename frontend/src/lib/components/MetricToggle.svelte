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
		{@const color = colors[metric.name] || '#888'}
		<button
			class="pill"
			class:active={isActive}
			style:--pill-color={color}
			onclick={() => onToggle(metric.name)}
		>
			<span class="dot"></span>
			{metric.display_name}
		</button>
	{/each}
</div>

<style>
	.metric-toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.9rem;
		border-radius: 99px;
		border: 2px solid var(--pill-color);
		background: transparent;
		color: var(--pill-color);
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
		transition: all 0.15s ease;
		-webkit-tap-highlight-color: transparent;
	}

	.pill:hover {
		opacity: 0.85;
	}

	.pill:active {
		transform: scale(0.96);
	}

	.pill.active {
		background: var(--pill-color);
		color: #fff;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}
</style>
