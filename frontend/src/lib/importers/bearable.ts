import Papa from 'papaparse';
import { upsertMetricDefinition, upsertDailyMetric, addRawImport } from '$lib/db';

// Known column -> [metric_name, display_name, source, original_max, category]
const KNOWN_COLUMNS: Record<string, [string, string, string, number, string | null]> = {
	'Mood (average)': ['mood', 'Stimmung', 'bearable', 10, 'mood'],
	'Energy (average)': ['energy', 'Energie', 'bearable', 5, 'vitals'],
	'Sleep quality': ['sleep_quality', 'Schlafqualität', 'bearable', 5, 'sleep'],
	Tagesform: ['daily_form', 'Tagesform', 'bearable', 100, 'vitals'],
	'Daily form': ['daily_form', 'Tagesform', 'bearable', 100, 'vitals']
};

const SYMPTOM_RE = /^Symptom:\s*(.+)$/;
const FACTOR_RE = /^Factor:\s*(.+)$/;

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
}

function parseColumn(
	col: string
): [string, string, string, number, string | null] | null {
	if (col in KNOWN_COLUMNS) return KNOWN_COLUMNS[col];

	let m = SYMPTOM_RE.exec(col);
	if (m) {
		const label = m[1].trim();
		return [`symptom_${slugify(label)}`, `Symptom: ${label}`, 'bearable', 10, 'symptoms'];
	}

	m = FACTOR_RE.exec(col);
	if (m) {
		const label = m[1].trim();
		return [`factor_${slugify(label)}`, `Factor: ${label}`, 'bearable', 10, 'factors'];
	}

	return null;
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

	if (!parsed.meta.fields?.includes('date')) {
		return { imported: 0, skipped: 0, errors: ["CSV missing 'date' column"] };
	}

	await addRawImport('bearable', filename, {
		rows: parsed.data.length,
		columns: parsed.meta.fields
	});

	// Map columns to metric definitions
	const columnMappings: Record<string, [string, string, string, number, string | null]> = {};
	for (const col of parsed.meta.fields) {
		if (col === 'date') continue;
		const mapping = parseColumn(col);
		if (mapping) columnMappings[col] = mapping;
	}

	// Ensure metric definitions exist, collect IDs
	const metricIds: Record<string, number> = {};
	for (const [_col, [name, displayName, source, originalMax, category]] of Object.entries(
		columnMappings
	)) {
		metricIds[name] = await upsertMetricDefinition({
			name,
			display_name: displayName,
			source,
			original_min: 0,
			original_max: originalMax,
			category,
			is_default: false
		});
	}

	let imported = 0;
	let skipped = 0;
	const errors: string[] = [];

	for (const row of parsed.data) {
		const dateStr = row['date'];
		if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
			errors.push(`Invalid date: ${dateStr}`);
			continue;
		}
		const date = dateStr.slice(0, 10);

		for (const [col, [name, , , originalMax]] of Object.entries(columnMappings)) {
			const rawStr = row[col];
			if (rawStr === undefined || rawStr === null || rawStr === '') {
				skipped++;
				continue;
			}

			const rawFloat = parseFloat(rawStr);
			if (isNaN(rawFloat)) {
				skipped++;
				continue;
			}

			const normalized =
				originalMax > 0 ? Math.max(0, Math.min(1, rawFloat / originalMax)) : 0;

			await upsertDailyMetric(date, metricIds[name], rawFloat, normalized);
			imported++;
		}
	}

	return { imported, skipped, errors };
}
