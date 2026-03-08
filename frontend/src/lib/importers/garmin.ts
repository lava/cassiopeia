import Papa from 'papaparse';
import { upsertMetricDefinition, upsertDailyMetric, addRawImport } from '$lib/db';
import type { ImportResult } from './bearable';

// GarminDB column -> [metric_name, display_name, source, original_min, original_max, category]
const COLUMN_MAP: Record<string, [string, string, string, number, number, string | null]> = {
	steps: ['steps', 'Schritte', 'garmin', 0, 10000, 'vitals'],
	rhr: ['resting_hr', 'Ruhepuls', 'garmin', 30, 100, 'vitals'],
	hr_min: ['hr_min', 'Puls Min', 'garmin', 30, 120, 'vitals'],
	hr_max: ['hr_max', 'Puls Max', 'garmin', 60, 200, 'vitals'],
	bb_max: ['body_battery', 'Body Battery', 'garmin', 0, 100, 'vitals'],
	bb_min: ['bb_min', 'Body Battery Min', 'garmin', 0, 100, 'vitals'],
	stress_avg: ['stress', 'Stress', 'garmin', 0, 100, 'vitals'],
	total_sleep: ['garmin_total_sleep', 'Schlaf Gesamt', 'garmin', 0, 600, 'sleep'],
	deep_sleep: ['garmin_deep_sleep', 'Tiefschlaf', 'garmin', 0, 300, 'sleep'],
	light_sleep: ['garmin_light_sleep', 'Leichtschlaf', 'garmin', 0, 400, 'sleep'],
	rem_sleep: ['garmin_rem_sleep', 'REM-Schlaf', 'garmin', 0, 200, 'sleep'],
	score: ['garmin_sleep_score', 'Schlafwert (Garmin)', 'garmin', 0, 100, 'sleep'],
	spo2_avg: ['spo2', 'SpO2', 'garmin', 80, 100, 'vitals'],
	rr_waking_avg: ['respiration', 'Atemfrequenz', 'garmin', 8, 30, 'vitals'],
	calories_active: ['calories_active', 'Aktive Kalorien', 'garmin', 0, 2000, 'vitals'],
	floors_up: ['floors_up', 'Stockwerke', 'garmin', 0, 30, 'vitals'],
	distance: ['distance', 'Distanz', 'garmin', 0, 15000, 'vitals']
};

const COLUMN_ALIASES: Record<string, string> = {
	resting_heart_rate: 'rhr',
	resting_hr: 'rhr',
	body_battery: 'bb_max',
	body_battery_max: 'bb_max',
	body_battery_min: 'bb_min',
	stress: 'stress_avg',
	avg_stress: 'stress_avg',
	sleep_score: 'score',
	spo2: 'spo2_avg',
	avg_spo2: 'spo2_avg',
	respiration_rate: 'rr_waking_avg'
};

const DATE_COLUMN_NAMES = ['day', 'date', 'calendarDate'];
const SLEEP_COLUMNS = new Set(['total_sleep', 'deep_sleep', 'light_sleep', 'rem_sleep']);

function findDateColumn(columns: string[]): string | null {
	for (const name of DATE_COLUMN_NAMES) {
		if (columns.includes(name)) return name;
	}
	return null;
}

function resolveColumn(col: string): string {
	return COLUMN_ALIASES[col] ?? col;
}

function parseSleepTime(value: string): number | null {
	if (!value || value.trim() === '') return null;
	const s = value.trim();
	if (s.includes(':')) {
		const parts = s.split(':');
		const hours = parseInt(parts[0], 10);
		const minutes = parseInt(parts[1], 10);
		if (isNaN(hours) || isNaN(minutes)) return null;
		return hours * 60 + minutes;
	}
	const n = parseFloat(s);
	return isNaN(n) ? null : n;
}

export async function importGarminCsv(
	csvContent: string,
	filename: string | null = null
): Promise<ImportResult> {
	const parsed = Papa.parse<Record<string, string>>(csvContent, {
		header: true,
		skipEmptyLines: true
	});

	const fields = parsed.meta.fields ?? [];
	const dateCol = findDateColumn(fields);
	if (!dateCol) {
		return {
			imported: 0,
			skipped: 0,
			errors: [`CSV missing date column (expected one of: ${DATE_COLUMN_NAMES.join(', ')})`]
		};
	}

	await addRawImport('garmin', filename, {
		rows: parsed.data.length,
		columns: fields
	});

	// Map CSV columns to metric definitions
	const columnMappings: Record<
		string,
		[string, string, string, number, number, string | null]
	> = {};
	for (const col of fields) {
		if (col === dateCol) continue;
		const canonical = resolveColumn(col);
		if (canonical in COLUMN_MAP) {
			columnMappings[col] = COLUMN_MAP[canonical];
		}
	}

	if (Object.keys(columnMappings).length === 0) {
		return {
			imported: 0,
			skipped: 0,
			errors: ['No recognized Garmin metric columns found in CSV']
		};
	}

	// Ensure metric definitions exist
	const metricIds: Record<string, number> = {};
	for (const [, [name, displayName, source, origMin, origMax, category]] of Object.entries(
		columnMappings
	)) {
		metricIds[name] = await upsertMetricDefinition({
			name,
			display_name: displayName,
			source,
			original_min: origMin,
			original_max: origMax,
			category,
			is_default: false
		});
	}

	let imported = 0;
	let skipped = 0;
	const errors: string[] = [];

	for (const row of parsed.data) {
		const dateStr = row[dateCol];
		if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
			errors.push(`Invalid date: ${dateStr}`);
			continue;
		}
		const date = dateStr.slice(0, 10);

		for (const [col, [name, , , origMin, origMax]] of Object.entries(columnMappings)) {
			const canonical = resolveColumn(col);
			let rawFloat: number;

			if (SLEEP_COLUMNS.has(canonical)) {
				const parsed = parseSleepTime(row[col]);
				if (parsed === null) {
					skipped++;
					continue;
				}
				rawFloat = parsed;
			} else {
				const rawStr = row[col];
				if (rawStr === undefined || rawStr === null || rawStr === '') {
					skipped++;
					continue;
				}
				rawFloat = parseFloat(rawStr);
				if (isNaN(rawFloat)) {
					skipped++;
					continue;
				}
			}

			const rangeSize = origMax - origMin;
			const normalized =
				rangeSize > 0 ? Math.max(0, Math.min(1, (rawFloat - origMin) / rangeSize)) : 0;

			await upsertDailyMetric(date, metricIds[name], rawFloat, normalized);
			imported++;
		}
	}

	return { imported, skipped, errors };
}
