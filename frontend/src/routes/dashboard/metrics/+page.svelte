<script lang="ts">
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/api';
	import type { MetricDefinition } from '$lib/types';

	let metrics: MetricDefinition[] = $state([]);
	let loading = $state(true);

	const sourceLabels: Record<string, string> = {
		bearable: 'Bearable',
		oura: 'Oura',
		garmin: 'Garmin'
	};

	onMount(async () => {
		try {
			metrics = await apiFetch<MetricDefinition[]>('/metrics');
		} finally {
			loading = false;
		}
	});
</script>

<div class="page">
	<div class="page-header">
		<h2>Metriken</h2>
		<p class="page-desc">Alle erfassten Gesundheitsmetriken und ihre Quellen.</p>
	</div>

	{#if loading}
		<p class="muted">Laden...</p>
	{:else if metrics.length === 0}
		<div class="card empty">
			<p>Noch keine Metriken vorhanden. Importiere zuerst Daten.</p>
		</div>
	{:else}
		<div class="metrics-grid">
			{#each metrics as m}
				<div class="card metric-card">
					<div class="metric-top">
						<span class="metric-name">{m.display_name}</span>
						<span class="metric-badge">{sourceLabels[m.source] ?? m.source}</span>
					</div>
					<div class="metric-details">
						<span>Bereich: {m.original_min} – {m.original_max}</span>
						{#if m.category}
							<span>Kategorie: {m.category}</span>
						{/if}
						{#if m.is_default}
							<span class="default-badge">Standard</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem 2rem;
		max-width: 720px;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h2 {
		margin: 0 0 0.25rem;
		font-size: 1.35rem;
		font-weight: 700;
		color: #111827;
	}

	.page-desc {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.muted {
		color: #9ca3af;
	}

	.metrics-grid {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 1rem 1.25rem;
	}

	.card.empty {
		text-align: center;
		color: #6b7280;
		padding: 2rem;
	}

	.card.empty p {
		margin: 0;
	}

	.metric-card {
		transition: border-color 0.15s ease;
	}

	.metric-card:hover {
		border-color: #d1d5db;
	}

	.metric-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.4rem;
	}

	.metric-name {
		font-weight: 600;
		font-size: 0.95rem;
		color: #111827;
	}

	.metric-badge {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
		background: #f3f4f6;
		color: #6b7280;
		font-weight: 500;
	}

	.metric-details {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: #9ca3af;
		flex-wrap: wrap;
	}

	.default-badge {
		color: #6d28d9;
		font-weight: 500;
	}

	@media (max-width: 768px) {
		.page {
			padding: 1rem 1.25rem;
		}
	}
</style>
