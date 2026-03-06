<script lang="ts">
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/api';
	import type { MetricDefinition, MetricsDataResponse } from '$lib/types';
	import ChartComponent from '$lib/components/Chart.svelte';
	import MetricToggle from '$lib/components/MetricToggle.svelte';
	import ImportPanel from '$lib/components/ImportPanel.svelte';

	const COLOR_PALETTE = [
		'#e6194b',
		'#3cb44b',
		'#4363d8',
		'#f58231',
		'#911eb4',
		'#42d4f4',
		'#f032e6',
		'#bfef45',
		'#469990',
		'#dcbeff',
		'#9a6324',
		'#800000'
	];

	const GRANULARITIES = [
		{ key: 'day', label: 'Tag' },
		{ key: 'week', label: 'Woche' },
		{ key: 'month', label: 'Monat' }
	] as const;

	const MONTH_NAMES = [
		'Januar',
		'Februar',
		'März',
		'April',
		'Mai',
		'Juni',
		'Juli',
		'August',
		'September',
		'Oktober',
		'November',
		'Dezember'
	];

	let metrics: MetricDefinition[] = $state([]);
	let activeMetrics: string[] = $state([]);
	let granularity: string = $state('day');
	let currentYear: number = $state(new Date().getFullYear());
	let currentMonth: number = $state(new Date().getMonth());

	let dates: string[] = $state([]);
	let series: Record<string, (number | null)[]> = $state({});
	let loading = $state(false);
	let fetchError: string | null = $state(null);

	let metricColors: Record<string, string> = $derived(
		Object.fromEntries(metrics.map((m, i) => [m.name, COLOR_PALETTE[i % COLOR_PALETTE.length]]))
	);

	let metricLabels: Record<string, string> = $derived(
		Object.fromEntries(metrics.map((m) => [m.name, m.display_name]))
	);

	let displayMonth = $derived(`${MONTH_NAMES[currentMonth]} ${currentYear}`);

	let dateRange = $derived.by(() => {
		const from = new Date(currentYear, currentMonth, 1);
		const to = new Date(currentYear, currentMonth + 1, 0);
		const fmt = (d: Date) => d.toISOString().slice(0, 10);
		return { from: fmt(from), to: fmt(to) };
	});

	function prevMonth() {
		if (currentMonth === 0) {
			currentMonth = 11;
			currentYear--;
		} else {
			currentMonth--;
		}
	}

	function nextMonth() {
		if (currentMonth === 11) {
			currentMonth = 0;
			currentYear++;
		} else {
			currentMonth++;
		}
	}

	function toggleMetric(name: string) {
		if (activeMetrics.includes(name)) {
			activeMetrics = activeMetrics.filter((m) => m !== name);
		} else {
			activeMetrics = [...activeMetrics, name];
		}
	}

	async function fetchData() {
		if (activeMetrics.length === 0) {
			dates = [];
			series = {};
			return;
		}
		loading = true;
		fetchError = null;
		try {
			const metricsParam = activeMetrics.join(',');
			const { from, to } = dateRange;
			const data = await apiFetch<MetricsDataResponse>(
				`/metrics/data?metrics=${metricsParam}&from=${from}&to=${to}&granularity=${granularity}`
			);
			dates = data.dates;
			series = data.series;
		} catch (e) {
			fetchError = e instanceof Error ? e.message : 'Failed to load data';
			console.error('Failed to fetch metrics data:', e);
		} finally {
			loading = false;
		}
	}

	// Refetch when params change
	$effect(() => {
		// Touch reactive deps to track them
		const _metrics = activeMetrics;
		const _range = dateRange;
		const _gran = granularity;
		// Use untrack for the actual fetch to avoid circular deps
		fetchData();
	});

	onMount(async () => {
		try {
			const data = await apiFetch<MetricDefinition[]>('/metrics');
			metrics = data;
			activeMetrics = data.filter((m) => m.is_default).map((m) => m.name);
		} catch (e) {
			console.error('Failed to fetch metric definitions:', e);
			fetchError = e instanceof Error ? e.message : 'Failed to load metrics';
		}
	});
</script>

<div class="dashboard">
	<header>
		<h1>Cassiopeia</h1>
		<ImportPanel onImported={fetchData} />
	</header>

	<div class="controls">
		<div class="granularity-tabs">
			{#each GRANULARITIES as g}
				<button
					class="tab"
					class:active={granularity === g.key}
					onclick={() => (granularity = g.key)}
				>
					{g.label}
				</button>
			{/each}
		</div>

		<div class="time-nav">
			<button class="nav-btn" onclick={prevMonth}>&lsaquo;</button>
			<span class="month-label">{displayMonth}</span>
			<button class="nav-btn" onclick={nextMonth}>&rsaquo;</button>
		</div>
	</div>

	<div class="chart-area">
		{#if loading}
			<div class="overlay">Laden...</div>
		{:else if fetchError}
			<div class="overlay error">{fetchError}</div>
		{:else if dates.length === 0 && metrics.length > 0}
			<div class="overlay muted">Keine Daten für diesen Zeitraum</div>
		{/if}
		<ChartComponent {dates} {series} {activeMetrics} {metricColors} {metricLabels} />
	</div>

	{#if metrics.length > 0}
		<div class="toggles">
			<MetricToggle {metrics} {activeMetrics} colors={metricColors} onToggle={toggleMetric} />
		</div>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem 1.25rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	header h1 {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.granularity-tabs {
		display: flex;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid #d1d5db;
	}

	.tab {
		padding: 0.5rem 1.25rem;
		border: none;
		background: #fff;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		color: #374151;
		transition: all 0.15s ease;
	}

	.tab:not(:last-child) {
		border-right: 1px solid #d1d5db;
	}

	.tab:hover {
		background: #f3f4f6;
	}

	.tab.active {
		background: #1f2937;
		color: #fff;
	}

	.time-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.nav-btn {
		width: 2.25rem;
		height: 2.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		font-size: 1.25rem;
		color: #374151;
		transition: all 0.15s ease;
	}

	.nav-btn:hover {
		background: #f3f4f6;
	}

	.nav-btn:active {
		background: #e5e7eb;
	}

	.month-label {
		min-width: 10rem;
		text-align: center;
		font-weight: 600;
		font-size: 1rem;
		color: #111827;
	}

	.chart-area {
		position: relative;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1.25rem;
		min-height: 250px;
	}

	.overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #6b7280;
		font-size: 0.95rem;
		z-index: 1;
	}

	.overlay.error {
		color: #dc2626;
	}

	.overlay.muted {
		color: #9ca3af;
	}

	.toggles {
		margin-top: 0.25rem;
	}
</style>
