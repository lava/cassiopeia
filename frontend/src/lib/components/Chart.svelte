<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		Chart,
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Tooltip,
		Legend,
		Filler
	} from 'chart.js';

	Chart.register(
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Tooltip,
		Legend,
		Filler
	);

	interface Props {
		dates: string[];
		series: Record<string, (number | null)[]>;
		activeMetrics: string[];
		metricColors: Record<string, string>;
		metricLabels: Record<string, string>;
	}

	let { dates, series, activeMetrics, metricColors, metricLabels }: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | undefined;

	function updateChart() {
		if (!canvas) return;

		const datasets = activeMetrics
			.filter((m) => series[m])
			.map((metric) => ({
				label: metricLabels[metric] || metric,
				data: series[metric],
				borderColor: metricColors[metric] || '#888',
				backgroundColor: 'transparent',
				borderWidth: 2,
				pointRadius: dates.length > 60 ? 0 : 3,
				pointHoverRadius: 5,
				tension: 0.3,
				spanGaps: true
			}));

		if (chart) {
			chart.data.labels = dates;
			chart.data.datasets = datasets;
			chart.update('none');
		} else {
			chart = new Chart(canvas, {
				type: 'line',
				data: { labels: dates, datasets },
				options: {
					responsive: true,
					maintainAspectRatio: true,
					animation: { duration: 300 },
					scales: {
						y: {
							min: 0,
							max: 1,
							grid: { color: '#f3f4f6' },
							border: { display: false },
							ticks: {
								stepSize: 0.25,
								color: '#9ca3af',
								font: { size: 11 }
							}
						},
						x: {
							grid: { display: false },
							border: { display: false },
							ticks: {
								autoSkip: true,
								maxRotation: 0,
								color: '#9ca3af',
								font: { size: 11 }
							}
						}
					},
					plugins: {
						legend: { display: false },
						tooltip: {
							mode: 'index',
							intersect: false,
							backgroundColor: '#1f2937',
							titleFont: { size: 12 },
							bodyFont: { size: 12 },
							padding: 10,
							cornerRadius: 8,
							callbacks: {
								label: (ctx) => {
									const val = ctx.parsed.y;
									return val != null
										? `${ctx.dataset.label}: ${(val * 100).toFixed(0)}%`
										: '';
								}
							}
						}
					},
					interaction: {
						mode: 'nearest',
						axis: 'x',
						intersect: false
					}
				}
			});
		}
	}

	$effect(() => {
		// Track reactive props
		dates;
		series;
		activeMetrics;
		metricColors;
		metricLabels;
		updateChart();
	});

	onDestroy(() => {
		chart?.destroy();
		chart = undefined;
	});
</script>

<div class="chart-container">
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.chart-container {
		position: relative;
		width: 100%;
	}
</style>
