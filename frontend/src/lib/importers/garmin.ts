import Papa from 'papaparse';
import { upsertMetricDefinition, upsertDailyMetric, addRawImport } from '$lib/db';
import type { ImportResult } from './bearable';

// Metric definition: [metric_name, display_name, source, original_min, original_max, category]
type MetricDef = [string, string, string, number, number, string | null];

// ── Garmin Connect aggregator CSV column mappings ──────────────────────
// Maps real Garmin Connect export column names to metric definitions.
const CONNECT_COLUMN_MAP: Record<string, MetricDef> = {
	totalSteps: ['steps', 'Schritte', 'garmin', 0, 10000, 'vitals'],
	restingHeartRate: ['resting_hr', 'Ruhepuls', 'garmin', 30, 100, 'vitals'],
	minHeartRate: ['hr_min', 'Puls Min', 'garmin', 30, 120, 'vitals'],
	maxHeartRate: ['hr_max', 'Puls Max', 'garmin', 60, 200, 'vitals'],
	averageSpo2Value: ['spo2', 'SpO2', 'garmin', 80, 100, 'vitals'],
	activeKilocalories: ['calories_active', 'Aktive Kalorien', 'garmin', 0, 2000, 'vitals'],
	totalDistanceMeters: ['distance', 'Distanz', 'garmin', 0, 15000, 'vitals'],
	'respiration.avgWakingRespirationValue': [
		'respiration',
		'Atemfrequenz',
		'garmin',
		8,
		30,
		'vitals'
	]
};

// Metrics that require special extraction (not simple column reads)
const DERIVED_METRICS: Record<string, MetricDef> = {
	body_battery: ['body_battery', 'Body Battery', 'garmin', 0, 100, 'vitals'],
	bb_min: ['bb_min', 'Body Battery Min', 'garmin', 0, 100, 'vitals'],
	stress: ['stress', 'Stress', 'garmin', 0, 100, 'vitals'],
	floors_up: ['floors_up', 'Stockwerke', 'garmin', 0, 30, 'vitals']
};

// ── Legacy (pre-processed) CSV column mappings ─────────────────────────
const LEGACY_COLUMN_MAP: Record<string, MetricDef> = {
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

const LEGACY_ALIASES: Record<string, string> = {
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
const LEGACY_SLEEP_COLUMNS = new Set(['total_sleep', 'deep_sleep', 'light_sleep', 'rem_sleep']);

// ── Helpers ────────────────────────────────────────────────────────────

function findDateColumn(columns: string[]): string | null {
	for (const name of DATE_COLUMN_NAMES) {
		if (columns.includes(name)) return name;
	}
	return null;
}

/**
 * Detect whether this is a Garmin Connect export (has columns like totalSteps,
 * restingHeartRate) or the legacy pre-processed format (has columns like steps, rhr).
 */
function isConnectFormat(fields: string[]): boolean {
	const connectIndicators = ['totalSteps', 'restingHeartRate', 'totalDistanceMeters'];
	return connectIndicators.some((c) => fields.includes(c));
}

/**
 * Parse a Python-style dict/list string into a JS object.
 * Garmin Connect exports embed Python repr strings like:
 *   [{'type': 'TOTAL', 'averageStressLevel': 30}, ...]
 */
function parsePythonLiteral(value: string): unknown {
	if (!value || value.trim() === '') return null;
	try {
		// Replace Python single-quoted strings with double quotes,
		// handle True/False/None
		const json = value
			.replace(/'/g, '"')
			.replace(/\bTrue\b/g, 'true')
			.replace(/\bFalse\b/g, 'false')
			.replace(/\bNone\b/g, 'null');
		return JSON.parse(json);
	} catch {
		return null;
	}
}

/**
 * Extract body battery highest value from bodyBattery.bodyBatteryStatList
 * or fall back to bodyBattery.chargedValue.
 */
function extractBodyBatteryMax(row: Record<string, string>): number | null {
	const statList = row['bodyBattery.bodyBatteryStatList'];
	if (statList) {
		const parsed = parsePythonLiteral(statList);
		if (Array.isArray(parsed)) {
			const highest = parsed.find(
				(s: { bodyBatteryStatType?: string }) => s.bodyBatteryStatType === 'HIGHEST'
			);
			if (highest && typeof highest.statsValue === 'number') {
				return highest.statsValue;
			}
		}
	}
	// Fallback: chargedValue is the amount charged, not the max level.
	// But it can serve as a rough proxy if stat list is missing.
	const charged = row['bodyBattery.chargedValue'];
	if (charged && charged.trim() !== '') {
		const n = parseFloat(charged);
		return isNaN(n) ? null : n;
	}
	return null;
}

/**
 * Extract body battery lowest value from bodyBattery.bodyBatteryStatList.
 */
function extractBodyBatteryMin(row: Record<string, string>): number | null {
	const statList = row['bodyBattery.bodyBatteryStatList'];
	if (statList) {
		const parsed = parsePythonLiteral(statList);
		if (Array.isArray(parsed)) {
			const lowest = parsed.find(
				(s: { bodyBatteryStatType?: string }) => s.bodyBatteryStatType === 'LOWEST'
			);
			if (lowest && typeof lowest.statsValue === 'number') {
				return lowest.statsValue;
			}
		}
	}
	return null;
}

/**
 * Extract average stress level from allDayStress.aggregatorList.
 * Uses the TOTAL entry's averageStressLevel.
 */
function extractStress(row: Record<string, string>): number | null {
	const aggList = row['allDayStress.aggregatorList'];
	if (!aggList) return null;
	const parsed = parsePythonLiteral(aggList);
	if (!Array.isArray(parsed)) return null;
	const total = parsed.find((s: { type?: string }) => s.type === 'TOTAL');
	if (total && typeof total.averageStressLevel === 'number') {
		return total.averageStressLevel;
	}
	return null;
}

/**
 * Convert floorsAscendedInMeters to floor count (1 floor ≈ 3m).
 */
function extractFloors(row: Record<string, string>): number | null {
	const val = row['floorsAscendedInMeters'];
	if (!val || val.trim() === '') return null;
	const meters = parseFloat(val);
	if (isNaN(meters)) return null;
	return Math.round(meters / 3);
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

// ── Import: Garmin Connect format ──────────────────────────────────────

async function importConnectFormat(
	parsed: Papa.ParseResult<Record<string, string>>,
	dateCol: string,
	fields: string[],
	csvContent: string,
	filename: string | null
): Promise<ImportResult> {
	await addRawImport(
		'garmin',
		filename,
		{ rows: parsed.data.length, columns: fields },
		csvContent
	);

	// Collect all metric defs we'll use
	const allMetrics: Record<string, MetricDef> = {};

	// Direct column mappings
	const directColumns: Record<string, MetricDef> = {};
	for (const col of fields) {
		if (col in CONNECT_COLUMN_MAP) {
			const def = CONNECT_COLUMN_MAP[col];
			directColumns[col] = def;
			allMetrics[def[0]] = def;
		}
	}

	// Check which derived metrics we can extract
	const hasBBStatList = fields.includes('bodyBattery.bodyBatteryStatList');
	const hasBBCharged = fields.includes('bodyBattery.chargedValue');
	const hasStress = fields.includes('allDayStress.aggregatorList');
	const hasFloors = fields.includes('floorsAscendedInMeters');

	if (hasBBStatList || hasBBCharged) {
		allMetrics['body_battery'] = DERIVED_METRICS['body_battery'];
		allMetrics['bb_min'] = DERIVED_METRICS['bb_min'];
	}
	if (hasStress) {
		allMetrics['stress'] = DERIVED_METRICS['stress'];
	}
	if (hasFloors) {
		allMetrics['floors_up'] = DERIVED_METRICS['floors_up'];
	}

	if (Object.keys(allMetrics).length === 0) {
		return {
			imported: 0,
			skipped: 0,
			errors: ['No recognized Garmin metric columns found in CSV']
		};
	}

	// Ensure metric definitions exist
	const metricIds: Record<string, number> = {};
	for (const [name, [, displayName, source, origMin, origMax, category]] of Object.entries(
		allMetrics
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

		// Process direct column mappings
		for (const [col, [name, , , origMin, origMax]] of Object.entries(directColumns)) {
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
			const rangeSize = origMax - origMin;
			const normalized =
				rangeSize > 0 ? Math.max(0, Math.min(1, (rawFloat - origMin) / rangeSize)) : 0;
			await upsertDailyMetric(date, metricIds[name], rawFloat, normalized);
			imported++;
		}

		// Process derived metrics
		const derivedValues: [string, number | null][] = [];

		if (hasBBStatList || hasBBCharged) {
			derivedValues.push(['body_battery', extractBodyBatteryMax(row)]);
			derivedValues.push(['bb_min', extractBodyBatteryMin(row)]);
		}
		if (hasStress) {
			derivedValues.push(['stress', extractStress(row)]);
		}
		if (hasFloors) {
			derivedValues.push(['floors_up', extractFloors(row)]);
		}

		for (const [metricName, value] of derivedValues) {
			if (value === null) {
				skipped++;
				continue;
			}
			const [, , , origMin, origMax] = allMetrics[metricName];
			const rangeSize = origMax - origMin;
			const normalized =
				rangeSize > 0 ? Math.max(0, Math.min(1, (value - origMin) / rangeSize)) : 0;
			await upsertDailyMetric(date, metricIds[metricName], value, normalized);
			imported++;
		}
	}

	return { imported, skipped, errors };
}

// ── Import: Legacy pre-processed format ────────────────────────────────

async function importLegacyFormat(
	parsed: Papa.ParseResult<Record<string, string>>,
	dateCol: string,
	fields: string[],
	csvContent: string,
	filename: string | null
): Promise<ImportResult> {
	await addRawImport(
		'garmin',
		filename,
		{ rows: parsed.data.length, columns: fields },
		csvContent
	);

	const columnMappings: Record<string, MetricDef> = {};
	for (const col of fields) {
		if (col === dateCol) continue;
		const canonical = LEGACY_ALIASES[col] ?? col;
		if (canonical in LEGACY_COLUMN_MAP) {
			columnMappings[col] = LEGACY_COLUMN_MAP[canonical];
		}
	}

	if (Object.keys(columnMappings).length === 0) {
		return {
			imported: 0,
			skipped: 0,
			errors: ['No recognized Garmin metric columns found in CSV']
		};
	}

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
			const canonical = LEGACY_ALIASES[col] ?? col;
			let rawFloat: number;

			if (LEGACY_SLEEP_COLUMNS.has(canonical)) {
				const p = parseSleepTime(row[col]);
				if (p === null) {
					skipped++;
					continue;
				}
				rawFloat = p;
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

// ── Main entry point ───────────────────────────────────────────────────

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

	if (isConnectFormat(fields)) {
		return importConnectFormat(parsed, dateCol, fields, csvContent, filename);
	} else {
		return importLegacyFormat(parsed, dateCol, fields, csvContent, filename);
	}
}

// ── FIT file import ────────────────────────────────────────────────────

interface FitSession {
	date: string;
	sport: string;
	subSport: string;
	totalCalories: number | null;
	totalDistance: number | null;
	durationMinutes: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	avgStress: number | null;
	avgSpo2: number | null;
	avgRespirationRate: number | null;
}

const FIT_METRICS: Record<string, MetricDef> = {
	fit_calories: ['fit_calories', 'Aktivitaetskalorien', 'garmin_fit', 0, 3000, 'vitals'],
	fit_distance: ['fit_distance', 'Aktivitaetsdistanz (m)', 'garmin_fit', 0, 20000, 'vitals'],
	fit_duration: ['fit_duration', 'Aktivitaetsdauer (min)', 'garmin_fit', 0, 180, 'vitals'],
	fit_activity_count: [
		'fit_activity_count',
		'Aktivitaeten',
		'garmin_fit',
		0,
		10,
		'vitals'
	],
	fit_avg_hr: ['fit_avg_hr', 'Durchschn. Puls (Aktivitaet)', 'garmin_fit', 30, 200, 'vitals'],
	fit_max_hr: ['fit_max_hr', 'Max Puls (Aktivitaet)', 'garmin_fit', 60, 220, 'vitals']
};

async function parseFitFile(bytes: ArrayBuffer): Promise<FitSession[]> {
	const { Decoder, Stream } = await import('@garmin/fitsdk');
	const stream = Stream.fromArrayBuffer(bytes);
	const decoder = new Decoder(stream);

	if (!decoder.isFIT()) return [];

	const { messages, errors } = decoder.read({
		convertDateTimesToDates: true,
		convertTypesToStrings: true,
		includeUnknownData: false
	});

	if (errors.length > 0) {
		console.warn('FIT decode errors:', errors);
	}

	const sessions: FitSession[] = [];
	const sessionMesgs = messages.sessionMesgs ?? [];

	for (const s of sessionMesgs) {
		const startTime: Date | undefined = s.startTime ?? s.timestamp;
		if (!startTime || !(startTime instanceof Date)) continue;

		// Use local date: offset by timezone if available, else use UTC
		const date = startTime.toISOString().slice(0, 10);

		sessions.push({
			date,
			sport: s.sport ?? 'unknown',
			subSport: s.subSport ?? 'unknown',
			totalCalories: typeof s.totalCalories === 'number' ? s.totalCalories : null,
			totalDistance: typeof s.totalDistance === 'number' ? s.totalDistance : null,
			durationMinutes:
				typeof s.totalTimerTime === 'number' ? Math.round(s.totalTimerTime / 60) : null,
			avgHeartRate: typeof s.avgHeartRate === 'number' ? s.avgHeartRate : null,
			maxHeartRate: typeof s.maxHeartRate === 'number' ? s.maxHeartRate : null,
			avgStress: typeof s.avgStress === 'number' ? s.avgStress : null,
			avgSpo2: typeof s.avgSpo2 === 'number' ? s.avgSpo2 : null,
			avgRespirationRate:
				typeof s.enhancedAvgRespirationRate === 'number'
					? s.enhancedAvgRespirationRate
					: null
		});
	}

	return sessions;
}

export async function importGarminFit(
	files: { name: string; bytes: ArrayBuffer }[]
): Promise<ImportResult> {
	let imported = 0;
	let skipped = 0;
	const errors: string[] = [];

	// Parse all FIT files and collect sessions
	const allSessions: FitSession[] = [];
	for (const file of files) {
		try {
			const sessions = await parseFitFile(file.bytes);
			if (sessions.length === 0) {
				skipped++;
			}
			allSessions.push(...sessions);
		} catch (e) {
			errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Parse-Fehler'}`);
		}
	}

	if (allSessions.length === 0) {
		return { imported, skipped, errors };
	}

	// Group sessions by date
	const byDate = new Map<string, FitSession[]>();
	for (const session of allSessions) {
		const existing = byDate.get(session.date);
		if (existing) {
			existing.push(session);
		} else {
			byDate.set(session.date, [session]);
		}
	}

	// Register metric definitions
	const metricIds: Record<string, number> = {};
	for (const [name, [, displayName, source, origMin, origMax, category]] of Object.entries(
		FIT_METRICS
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

	// Aggregate per day and upsert
	for (const [date, sessions] of byDate) {
		const totalCalories = sessions.reduce((sum, s) => sum + (s.totalCalories ?? 0), 0);
		const totalDistance = sessions.reduce((sum, s) => sum + (s.totalDistance ?? 0), 0);
		const totalDuration = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
		const activityCount = sessions.length;

		// Weighted average HR (by duration)
		let avgHr: number | null = null;
		let maxHr: number | null = null;
		{
			let hrSum = 0;
			let hrWeight = 0;
			let maxHrVal = 0;
			for (const s of sessions) {
				const dur = s.durationMinutes ?? 1;
				if (s.avgHeartRate !== null) {
					hrSum += s.avgHeartRate * dur;
					hrWeight += dur;
				}
				if (s.maxHeartRate !== null && s.maxHeartRate > maxHrVal) {
					maxHrVal = s.maxHeartRate;
				}
			}
			if (hrWeight > 0) avgHr = Math.round(hrSum / hrWeight);
			if (maxHrVal > 0) maxHr = maxHrVal;
		}

		const dailyValues: [string, number | null][] = [
			['fit_calories', totalCalories > 0 ? totalCalories : null],
			['fit_distance', totalDistance > 0 ? totalDistance : null],
			['fit_duration', totalDuration > 0 ? totalDuration : null],
			['fit_activity_count', activityCount],
			['fit_avg_hr', avgHr],
			['fit_max_hr', maxHr]
		];

		for (const [metricName, value] of dailyValues) {
			if (value === null) {
				skipped++;
				continue;
			}
			const [, , , origMin, origMax] = FIT_METRICS[metricName];
			const rangeSize = origMax - origMin;
			const normalized =
				rangeSize > 0 ? Math.max(0, Math.min(1, (value - origMin) / rangeSize)) : 0;
			await upsertDailyMetric(date, metricIds[metricName], value, normalized);
			imported++;
		}
	}

	await addRawImport(
		'garmin_fit',
		files.map((f) => f.name).join(', '),
		{ files: files.length, sessions: allSessions.length, days: byDate.size },
		null
	);

	return { imported, skipped, errors };
}
