<script lang="ts">
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
	let chart: Chart | undefined = $state();

	$effect(() => {
		if (!canvas) return;

		const datasets = activeMetrics
			.filter((m) => series[m])
			.map((metric) => ({
				label: metricLabels[metric] || metric,
				data: series[metric],
				borderColor: metricColors[metric] || '#888',
				backgroundColor: 'transparent',
				borderWidth: 2,
				pointRadius: 2,
				pointHoverRadius: 5,
				tension: 0.3,
				spanGaps: true
			}));

		if (chart) {
			chart.data.labels = dates;
			chart.data.datasets = datasets;
			chart.update();
		} else {
			chart = new Chart(canvas, {
				type: 'line',
				data: {
					labels: dates,
					datasets
				},
				options: {
					responsive: true,
					maintainAspectRatio: true,
					scales: {
						y: {
							min: 0,
							max: 1,
							ticks: {
								callback: (value) => {
									const v = Number(value);
									return v === 0 || v === 0.5 || v === 1 ? v.toString() : '';
								}
							}
						},
						x: {
							ticks: {
								autoSkip: true,
								maxRotation: 0
							}
						}
					},
					plugins: {
						legend: {
							display: true,
							position: 'top'
						},
						tooltip: {
							mode: 'index',
							intersect: false
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

		return () => {
			if (chart) {
				chart.destroy();
				chart = undefined;
			}
		};
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
