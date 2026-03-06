<script lang="ts">
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
		'#fabed4',
		'#469990',
		'#dcbeff',
		'#9a6324',
		'#800000',
		'#aaffc3',
		'#808000',
		'#000075'
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
	let currentMonth: number = $state(new Date().getMonth()); // 0-indexed

	let dates: string[] = $state([]);
	let series: Record<string, (number | null)[]> = $state({});
	let loading = $state(false);

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

	// Fetch metric definitions on mount
	$effect(() => {
		apiFetch<MetricDefinition[]>('/metrics').then((data) => {
			metrics = data;
			activeMetrics = data.filter((m) => m.is_default).map((m) => m.name);
		});
	});

	// Fetch data when params change
	$effect(() => {
		if (activeMetrics.length === 0) {
			dates = [];
			series = {};
			return;
		}

		const metricsParam = activeMetrics.join(',');
		const { from, to } = dateRange;
		const gran = granularity;

		loading = true;
		apiFetch<MetricsDataResponse>(
			`/metrics/data?metrics=${metricsParam}&from=${from}&to=${to}&granularity=${gran}`
		)
			.then((data) => {
				dates = data.dates;
				series = data.series;
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

<div class="dashboard">
	<header>
		<h1>Cassiopeia</h1>
		<ImportPanel />
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
			<button class="nav-arrow" onclick={prevMonth}>&lsaquo;</button>
			<span class="month-label">{displayMonth}</span>
			<button class="nav-arrow" onclick={nextMonth}>&rsaquo;</button>
		</div>
	</div>

	<div class="chart-area">
		{#if loading}
			<div class="loading">Loading...</div>
		{/if}
		<ChartComponent {dates} {series} {activeMetrics} {metricColors} {metricLabels} />
	</div>

	<div class="toggles">
		<MetricToggle {metrics} {activeMetrics} colors={metricColors} onToggle={toggleMetric} />
	</div>
</div>

<style>
	.dashboard {
		max-width: 900px;
		margin: 0 auto;
		padding: 16px 20px;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	header h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
		flex-wrap: wrap;
		gap: 12px;
	}

	.granularity-tabs {
		display: flex;
		gap: 0;
	}

	.tab {
		padding: 6px 16px;
		border: 1px solid #ccc;
		background: #fff;
		cursor: pointer;
		font-size: 0.9rem;
	}

	.tab:first-child {
		border-radius: 6px 0 0 6px;
	}

	.tab:last-child {
		border-radius: 0 6px 6px 0;
	}

	.tab:not(:first-child) {
		border-left: none;
	}

	.tab.active {
		background: #333;
		color: #fff;
		border-color: #333;
	}

	.time-nav {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.nav-arrow {
		padding: 4px 10px;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
		font-size: 1.2rem;
		line-height: 1;
	}

	.month-label {
		min-width: 140px;
		text-align: center;
		font-weight: 500;
	}

	.chart-area {
		position: relative;
		margin-bottom: 20px;
	}

	.loading {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #999;
		z-index: 1;
	}

	.toggles {
		margin-top: 8px;
	}
</style>
