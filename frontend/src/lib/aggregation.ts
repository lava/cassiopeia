export type Granularity = 'day' | 'week' | 'month';

function periodStart(dateStr: string, granularity: Granularity): string {
	if (granularity === 'day') return dateStr;

	const [year, month, day] = dateStr.split('-').map(Number);

	if (granularity === 'month') {
		return `${year}-${String(month).padStart(2, '0')}-01`;
	}

	// Week: find Monday (ISO week start)
	const d = new Date(year, month - 1, day);
	const dayOfWeek = d.getDay();
	const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	const monday = new Date(d);
	monday.setDate(d.getDate() + diff);
	return monday.toISOString().slice(0, 10);
}

export function aggregateToPeriods(
	rows: { date: string; metric_name: string; normalized: number }[],
	granularity: Granularity
): { dates: string[]; series: Record<string, (number | null)[]> } {
	const periodValues = new Map<string, Map<string, number[]>>();
	const allMetrics = new Set<string>();

	for (const { date, metric_name, normalized } of rows) {
		const period = periodStart(date, granularity);
		if (!periodValues.has(period)) periodValues.set(period, new Map());
		const metricMap = periodValues.get(period)!;
		if (!metricMap.has(metric_name)) metricMap.set(metric_name, []);
		metricMap.get(metric_name)!.push(normalized);
		allMetrics.add(metric_name);
	}

	const sortedDates = [...periodValues.keys()].sort();
	const sortedMetrics = [...allMetrics].sort();

	const series: Record<string, (number | null)[]> = {};
	for (const metric of sortedMetrics) {
		series[metric] = sortedDates.map((date) => {
			const vals = periodValues.get(date)?.get(metric);
			if (vals && vals.length > 0) {
				const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
				return Math.round(avg * 10000) / 10000;
			}
			return null;
		});
	}

	return { dates: sortedDates, series };
}
