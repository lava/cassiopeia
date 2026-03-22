import Papa from 'papaparse';
import { upsertMetricDefinition, upsertDailyMetric, addRawImport, getToken } from '$lib/db';
import type { ImportResult } from './bearable';

const OURA_BASE = 'https://api.ouraring.com/v2/usercollection';

// metric_key -> [metric_name, display_name, original_max, category]
const OURA_METRICS: Record<string, [string, string, number, string]> = {
	sleep_score: ['sleep_score', 'Schlafwert', 100, 'sleep'],
	readiness_score: ['readiness_score', 'Bereitschaft', 100, 'vitals'],
	hrv_balance: ['hrv_balance', 'HRV Balance', 100, 'vitals'],
	resting_heart_rate: ['resting_heart_rate', 'Ruhepuls', 120, 'vitals'],
	activity_score: ['activity_score', 'Aktivitätswert', 100, 'vitals']
};

const DEFAULT_METRICS = new Set(['sleep_score']);

async function fetchOura(
	endpoint: string,
	startDate: string,
	endDate: string,
	token: string,
	useProxy: boolean
): Promise<Record<string, unknown>[]> {
	const items: Record<string, unknown>[] = [];

	if (useProxy) {
		const proxyResp = await fetch('/api/proxy/oura', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				token,
				endpoint,
				params: { start_date: startDate, end_date: endDate }
			})
		});
		if (!proxyResp.ok) throw new Error(`Proxy error: ${proxyResp.status}`);
		const proxyBody: Record<string, unknown> = await proxyResp.json();
		items.push(...((proxyBody.data as Record<string, unknown>[]) ?? []));
		return items;
	}

	let url: string | null = `${OURA_BASE}/${endpoint}?start_date=${startDate}&end_date=${endDate}`;
	while (url) {
		const fetchResp: Response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!fetchResp.ok) throw new Error(`Oura API error: ${fetchResp.status}`);
		const fetchBody: Record<string, unknown> = await fetchResp.json();
		items.push(...((fetchBody.data as Record<string, unknown>[]) ?? []));
		url = (fetchBody.next_token as string) ?? null;
	}

	return items;
}

function extractSleep(record: Record<string, unknown>): Record<string, number | null> {
	return { sleep_score: (record.score as number) ?? null };
}

function extractReadiness(record: Record<string, unknown>): Record<string, number | null> {
	const contributors = (record.contributors ?? {}) as Record<string, unknown>;
	return {
		readiness_score: (record.score as number) ?? null,
		hrv_balance: (contributors.hrv_balance as number) ?? null,
		resting_heart_rate: (contributors.resting_heart_rate as number) ?? null
	};
}

function extractActivity(record: Record<string, unknown>): Record<string, number | null> {
	return { activity_score: (record.score as number) ?? null };
}

export async function syncOura(startDate: string, endDate: string): Promise<ImportResult> {
	const token = await getToken('oura');
	if (!token) {
		return {
			imported: 0,
			skipped: 0,
			errors: ['Kein Oura-Token hinterlegt. Bitte zuerst unter Import konfigurieren.']
		};
	}

	// Ensure metric definitions exist
	const metricIds: Record<string, number> = {};
	for (const [key, [name, displayName, originalMax, category]] of Object.entries(OURA_METRICS)) {
		metricIds[key] = await upsertMetricDefinition({
			name,
			display_name: displayName,
			source: 'oura',
			original_min: 0,
			original_max: originalMax,
			category,
			is_default: DEFAULT_METRICS.has(key)
		});
	}

	let imported = 0;
	let skipped = 0;
	const errors: string[] = [];
	const allRawData: Record<string, unknown[]> = {};

	// Try direct first, fall back to proxy
	let useProxy = false;

	const extractors: [
		string,
		(r: Record<string, unknown>) => Record<string, number | null>
	][] = [
		['daily_sleep', extractSleep],
		['daily_readiness', extractReadiness],
		['daily_activity', extractActivity]
	];

	for (const [endpoint, extractor] of extractors) {
		let records: Record<string, unknown>[];
		try {
			records = await fetchOura(endpoint, startDate, endDate, token, useProxy);
		} catch (e) {
			if (!useProxy && e instanceof TypeError) {
				// Likely CORS error, try proxy
				useProxy = true;
				try {
					records = await fetchOura(endpoint, startDate, endDate, token, true);
				} catch (proxyErr) {
					errors.push(
						`Oura API error for ${endpoint}: ${proxyErr instanceof Error ? proxyErr.message : String(proxyErr)}`
					);
					continue;
				}
			} else {
				errors.push(
					`Oura API error for ${endpoint}: ${e instanceof Error ? e.message : String(e)}`
				);
				continue;
			}
		}

		allRawData[endpoint] = records;

		for (const record of records) {
			const dayStr = record.day as string | undefined;
			if (!dayStr) {
				skipped++;
				continue;
			}

			const metrics = extractor(record);
			for (const [metricKey, value] of Object.entries(metrics)) {
				if (value === null || value === undefined) {
					skipped++;
					continue;
				}
				const metricId = metricIds[metricKey];
				if (!metricId) {
					skipped++;
					continue;
				}
				const [, , originalMax] = OURA_METRICS[metricKey];
				const normalized =
					originalMax > 0 ? Math.max(0, Math.min(1, value / originalMax)) : 0;
				await upsertDailyMetric(dayStr, metricId, value, normalized);
				imported++;
			}
		}
	}

	const flatRows: Record<string, unknown>[] = [];
	for (const [endpoint, records] of Object.entries(allRawData)) {
		for (const record of records) {
			flatRows.push({ _source: endpoint, ...(record as Record<string, unknown>) });
		}
	}
	const ouraColumns = flatRows.length > 0
		? Object.keys(flatRows[0])
		: ['_source', 'day'];

	await addRawImport(
		'oura',
		null,
		{
			start_date: startDate,
			end_date: endDate,
			columns: ouraColumns,
			record_counts: Object.fromEntries(
				Object.entries(allRawData).map(([k, v]) => [k, v.length])
			)
		},
		JSON.stringify(allRawData),
		flatRows
	);

	return { imported, skipped, errors };
}

/**
 * Parse a Python-style dict string like "{'key': 42, 'other': 88}" into a JS object.
 * Handles single-quoted keys and numeric values.
 */
function parsePythonDict(raw: string): Record<string, number> {
	const result: Record<string, number> = {};
	if (!raw || !raw.includes('{')) return result;
	// Remove outer braces and whitespace
	const inner = raw.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
	// Match 'key': value pairs
	const re = /'([^']+)'\s*:\s*([0-9.eE+-]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(inner)) !== null) {
		const val = parseFloat(m[2]);
		if (!isNaN(val)) {
			result[m[1]] = val;
		}
	}
	return result;
}

/**
 * Classify an Oura CSV file by its filename prefix.
 * Returns 'dailysleep' | 'dailyreadiness' | 'dailyactivity' | null.
 */
function classifyOuraFile(filename: string): string | null {
	const lower = filename.toLowerCase();
	if (lower.startsWith('dailysleep')) return 'dailysleep';
	if (lower.startsWith('dailyreadiness')) return 'dailyreadiness';
	if (lower.startsWith('dailyactivity')) return 'dailyactivity';
	return null;
}

/**
 * Import Oura data from CSV files (the export format from the Oura web dashboard).
 * Accepts multiple CSV file contents keyed by filename.
 */
export async function importOuraCsv(
	files: { name: string; content: string }[]
): Promise<ImportResult> {
	// Ensure metric definitions exist
	const metricIds: Record<string, number> = {};
	for (const [key, [name, displayName, originalMax, category]] of Object.entries(OURA_METRICS)) {
		metricIds[key] = await upsertMetricDefinition({
			name,
			display_name: displayName,
			source: 'oura',
			original_min: 0,
			original_max: originalMax,
			category,
			is_default: DEFAULT_METRICS.has(key)
		});
	}

	let imported = 0;
	let skipped = 0;
	const errors: string[] = [];
	const allRawData: Record<string, unknown[]> = {};

	for (const file of files) {
		const parsed = Papa.parse<Record<string, string>>(file.content, {
			header: true,
			skipEmptyLines: true
		});

		const fileType = classifyOuraFile(file.name);
		if (!fileType) {
			// Store raw data for unrecognized files
			allRawData[file.name] = parsed.data;
			errors.push(`${file.name}: Oura-Dateiformat nicht erkannt (Rohdaten gespeichert)`);
			continue;
		}

		const fields = parsed.meta.fields ?? [];
		if (!fields.includes('day')) {
			allRawData[file.name] = parsed.data;
			errors.push(`${file.name}: Spalte 'day' nicht gefunden (Rohdaten gespeichert)`);
			continue;
		}

		allRawData[fileType] = parsed.data;

		for (const row of parsed.data) {
			const dayStr = row['day'];
			if (!dayStr || !/^\d{4}-\d{2}-\d{2}/.test(dayStr)) {
				skipped++;
				continue;
			}

			let metrics: Record<string, number | null> = {};

			if (fileType === 'dailysleep') {
				const score = parseFloat(row['score']);
				metrics = { sleep_score: isNaN(score) ? null : score };
			} else if (fileType === 'dailyreadiness') {
				const score = parseFloat(row['score']);
				const contributors = parsePythonDict(row['contributors'] ?? '');
				metrics = {
					readiness_score: isNaN(score) ? null : score,
					hrv_balance: contributors['hrv_balance'] ?? null,
					resting_heart_rate: contributors['resting_heart_rate'] ?? null
				};
			} else if (fileType === 'dailyactivity') {
				const score = parseFloat(row['score']);
				metrics = { activity_score: isNaN(score) ? null : score };
			}

			for (const [metricKey, value] of Object.entries(metrics)) {
				if (value === null || value === undefined) {
					skipped++;
					continue;
				}
				const metricId = metricIds[metricKey];
				if (!metricId) {
					skipped++;
					continue;
				}
				const [, , originalMax] = OURA_METRICS[metricKey];
				const normalized =
					originalMax > 0 ? Math.max(0, Math.min(1, value / originalMax)) : 0;
				await upsertDailyMetric(dayStr, metricId, value, normalized);
				imported++;
			}
		}
	}

	const csvFlatRows: Record<string, unknown>[] = [];
	for (const [fileType, records] of Object.entries(allRawData)) {
		for (const record of records) {
			csvFlatRows.push({ _source: fileType, ...(record as Record<string, unknown>) });
		}
	}
	const csvOuraColumns = csvFlatRows.length > 0
		? Object.keys(csvFlatRows[0])
		: ['_source', 'day'];

	await addRawImport(
		'oura',
		files.map((f) => f.name).join(', '),
		{
			files: files.map((f) => f.name),
			columns: csvOuraColumns,
			record_counts: Object.fromEntries(
				Object.entries(allRawData).map(([k, v]) => [k, v.length])
			)
		},
		JSON.stringify(allRawData),
		csvFlatRows
	);

	return { imported, skipped, errors };
}
