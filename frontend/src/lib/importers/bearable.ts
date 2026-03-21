import Papa from 'papaparse';
import { upsertMetricDefinition, upsertDailyMetric, addRawImport } from '$lib/db';

/**
 * Bearable exports a long/tall CSV format: one row per measurement per time-of-day.
 * Columns: date, date formatted, weekday, time of day, category, rating/amount, detail, notes
 *
 * We group by date and aggregate:
 * - Mood: average of all rating/amount values for the day
 * - Energy: average of all rating/amount values for the day
 * - Sleep Quality: single daily value (take first or average)
 * - Symptom: extract symptom name from detail, average severity across time-of-day entries
 * - Factor: presence-based, count occurrences or use rating if available
 */

// Category config: [metric_name, display_name, source, original_max, db_category]
const CATEGORY_CONFIG: Record<string, [string, string, string, number, string]> = {
	Mood: ['mood', 'Stimmung', 'bearable', 10, 'mood'],
	Energy: ['energy', 'Energie', 'bearable', 5, 'vitals'],
	'Sleep Quality': ['sleep_quality', 'Schlafqualität', 'bearable', 5, 'sleep'],
	Sleep: ['sleep_hours', 'Schlafdauer', 'bearable', 24, 'sleep']
};

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

/** Extract the symptom/factor name from the detail field, stripping severity suffix like "(Mild)" */
function extractName(detail: string): string {
	return detail.replace(/\s*\((Mild|Moderate|Severe|V\. Severe|None)\)\s*$/, '').trim();
}

interface MeasurementRow {
	date: string;
	category: string;
	rating: number | null;
	detail: string;
}

export interface ImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

export async function importBearableCsv(
	csvContent: string,
	filename: string | null = null
): Promise<ImportResult> {
	const parsed = Papa.parse<Record<string, string>>(csvContent, {
		header: true,
		skipEmptyLines: true
	});

	await addRawImport(
		'bearable',
		filename,
		{ rows: parsed.data.length, columns: parsed.meta.fields },
		csvContent
	);

	const warnings: string[] = [];
	if (!parsed.meta.fields?.includes('date formatted')) {
		warnings.push("Warnung: Spalte 'date formatted' nicht gefunden – Bearable-Format nicht erkannt");
		return { imported: 0, skipped: 0, errors: warnings };
	}
	if (!parsed.meta.fields?.includes('category')) {
		warnings.push("Warnung: Spalte 'category' nicht gefunden – Bearable-Format nicht erkannt");
		return { imported: 0, skipped: 0, errors: warnings };
	}

	// Parse all rows into typed measurements
	const measurements: MeasurementRow[] = [];
	const errors: string[] = [];

	for (const row of parsed.data) {
		const dateStr = row['date formatted'];
		if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
			errors.push(`Invalid date: ${dateStr}`);
			continue;
		}

		const category = row['category'] ?? '';
		if (!category) continue;

		const ratingStr = row['rating/amount'] ?? '';
		const rating = ratingStr !== '' ? parseFloat(ratingStr) : null;
		const detail = (row['detail'] ?? '').trim();

		measurements.push({ date: dateStr, category, rating, detail });
	}

	// Group by date, then by category, then by detail (for symptoms/factors)
	// Structure: date -> category -> detail -> number[]
	const grouped = new Map<string, Map<string, Map<string, number[]>>>();

	for (const m of measurements) {
		if (!grouped.has(m.date)) grouped.set(m.date, new Map());
		const dateMap = grouped.get(m.date)!;

		if (!dateMap.has(m.category)) dateMap.set(m.category, new Map());
		const catMap = dateMap.get(m.category)!;

		// For categories with detail-level breakdown (Symptom, Factor),
		// group by the extracted name. For simple categories (Mood, Energy),
		// use empty string as the detail key.
		const isDetailCategory = m.category === 'Symptom' || m.category === 'Factor';
		const detailKey = isDetailCategory && m.detail ? extractName(m.detail) : '';

		if (!catMap.has(detailKey)) catMap.set(detailKey, []);
		if (m.rating !== null && !isNaN(m.rating)) {
			catMap.get(detailKey)!.push(m.rating);
		}
	}

	// Now upsert metric definitions and daily values
	const metricIdCache: Record<string, number> = {};

	async function ensureMetric(
		name: string,
		displayName: string,
		source: string,
		originalMax: number,
		category: string
	): Promise<number> {
		if (metricIdCache[name]) return metricIdCache[name];
		const id = await upsertMetricDefinition({
			name,
			display_name: displayName,
			source,
			original_min: 0,
			original_max: originalMax,
			category,
			is_default: false
		});
		metricIdCache[name] = id;
		return id;
	}

	let imported = 0;
	let skipped = 0;

	for (const [date, categoryMap] of grouped) {
		for (const [category, detailMap] of categoryMap) {
			const config = CATEGORY_CONFIG[category];

			if (config) {
				// Simple category (Mood, Energy, Sleep Quality, Sleep)
				const values = detailMap.get('') ?? [];
				if (values.length === 0) {
					skipped++;
					continue;
				}
				const avg = values.reduce((a, b) => a + b, 0) / values.length;
				const [name, displayName, source, originalMax, dbCategory] = config;
				const metricId = await ensureMetric(name, displayName, source, originalMax, dbCategory);
				const normalized = originalMax > 0 ? Math.max(0, Math.min(1, avg / originalMax)) : 0;
				await upsertDailyMetric(date, metricId, avg, normalized);
				imported++;
			} else if (category === 'Symptom') {
				// Each symptom name becomes its own metric
				for (const [symptomName, values] of detailMap) {
					if (!symptomName || values.length === 0) {
						skipped++;
						continue;
					}
					const avg = values.reduce((a, b) => a + b, 0) / values.length;
					const metricName = `symptom_${slugify(symptomName)}`;
					const metricId = await ensureMetric(
						metricName,
						`Symptom: ${symptomName}`,
						'bearable',
						3,
						'symptoms'
					);
					const normalized = Math.max(0, Math.min(1, avg / 3));
					await upsertDailyMetric(date, metricId, avg, normalized);
					imported++;
				}
			} else if (category === 'Factor') {
				// Each factor becomes its own metric
				for (const [factorName, values] of detailMap) {
					if (!factorName || values.length === 0) {
						skipped++;
						continue;
					}
					const avg = values.reduce((a, b) => a + b, 0) / values.length;
					const metricName = `factor_${slugify(factorName)}`;
					const metricId = await ensureMetric(
						metricName,
						`Factor: ${factorName}`,
						'bearable',
						10,
						'factors'
					);
					const normalized = Math.max(0, Math.min(1, avg / 10));
					await upsertDailyMetric(date, metricId, avg, normalized);
					imported++;
				}
			} else {
				// Categories we don't import as numeric metrics (Lifestyle, Active,
				// Supplements, Meds, etc.) — skip silently
				skipped++;
			}
		}
	}

	return { imported, skipped, errors };
}
