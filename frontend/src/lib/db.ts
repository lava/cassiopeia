import SQLiteAsyncESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from 'wa-sqlite';
// @ts-ignore - wa-sqlite VFS examples don't ship types
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';

import type { MetricDefinition } from './types';

type Param = string | number | null;

let sqlite3: ReturnType<typeof SQLite.Factory>;
let db: number;
let _initPromise: Promise<void> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metric_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL,
  original_min REAL NOT NULL DEFAULT 0,
  original_max REAL NOT NULL,
  category TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  metric_id INTEGER NOT NULL REFERENCES metric_definitions(id),
  raw_value REAL NOT NULL,
  normalized REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, metric_id)
);

CREATE TABLE IF NOT EXISTS raw_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  filename TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS user_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT UNIQUE NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export async function initDB(): Promise<void> {
	if (_initPromise) return _initPromise;
	_initPromise = _initDBInternal();
	return _initPromise;
}

async function _initDBInternal(): Promise<void> {
	const module = await SQLiteAsyncESMFactory();
	sqlite3 = SQLite.Factory(module);
	const vfs = await IDBBatchAtomicVFS.create('cassiopeia', module);
	sqlite3.vfs_register(vfs, true);
	db = await sqlite3.open_v2('cassiopeia');
	await sqlite3.exec(db, SCHEMA);
}

export async function query<T = Record<string, unknown>>(
	sql: string,
	params: Param[] = []
): Promise<T[]> {
	await initDB();

	if (params.length === 0) {
		const rows: T[] = [];
		await sqlite3.exec(db, sql, (row: (unknown)[], columns: string[]) => {
			const obj: Record<string, unknown> = {};
			columns.forEach((col, i) => {
				obj[col] = row[i];
			});
			rows.push(obj as T);
		});
		return rows;
	}

	// Use statements for parameterized queries
	const results: T[] = [];
	for await (const stmt of sqlite3.statements(db, sql)) {
		sqlite3.bind_collection(stmt, params);
		const colCount = sqlite3.column_count(stmt);
		const cols = Array.from({ length: colCount }, (_, i) => sqlite3.column_name(stmt, i));
		while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
			const obj: Record<string, unknown> = {};
			for (let i = 0; i < colCount; i++) {
				obj[cols[i]] = sqlite3.column(stmt, i);
			}
			results.push(obj as T);
		}
	}
	return results;
}

export async function execute(sql: string, params: Param[] = []): Promise<void> {
	await initDB();

	if (params.length === 0) {
		await sqlite3.exec(db, sql);
		return;
	}

	for await (const stmt of sqlite3.statements(db, sql)) {
		sqlite3.bind_collection(stmt, params);
		await sqlite3.step(stmt);
	}
}

export async function queryRaw(
	sql: string
): Promise<{ columns: string[]; rows: unknown[][] }> {
	await initDB();
	const columns: string[] = [];
	const rows: unknown[][] = [];

	await sqlite3.exec(db, sql, (row: (unknown)[], cols: string[]) => {
		if (columns.length === 0) columns.push(...cols);
		rows.push([...row]);
	});

	return { columns, rows };
}

// --- High-level data access ---

export async function getMetricDefinitions(): Promise<MetricDefinition[]> {
	const rows = await query<{
		id: number;
		name: string;
		display_name: string;
		source: string;
		original_min: number;
		original_max: number;
		category: string | null;
		is_default: number;
	}>('SELECT * FROM metric_definitions ORDER BY name');
	return rows.map((r) => ({ ...r, is_default: r.is_default === 1 }));
}

export async function getMetricsRaw(
	metricNames: string[],
	from: string,
	to: string
): Promise<{ date: string; metric_name: string; normalized: number }[]> {
	if (metricNames.length === 0) return [];
	const placeholders = metricNames.map(() => '?').join(',');
	return query(
		`SELECT dm.date, md.name as metric_name, dm.normalized
		 FROM daily_metrics dm
		 JOIN metric_definitions md ON dm.metric_id = md.id
		 WHERE md.name IN (${placeholders})
		   AND dm.date >= ? AND dm.date <= ?
		 ORDER BY dm.date`,
		[...metricNames, from, to]
	);
}

export async function upsertMetricDefinition(def: {
	name: string;
	display_name: string;
	source: string;
	original_min: number;
	original_max: number;
	category: string | null;
	is_default: boolean;
}): Promise<number> {
	await execute(
		`INSERT INTO metric_definitions (name, display_name, source, original_min, original_max, category, is_default, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(name) DO UPDATE SET
		   display_name = excluded.display_name,
		   original_max = excluded.original_max,
		   updated_at = datetime('now')`,
		[
			def.name,
			def.display_name,
			def.source,
			def.original_min,
			def.original_max,
			def.category,
			def.is_default ? 1 : 0
		]
	);
	const rows = await query<{ id: number }>('SELECT id FROM metric_definitions WHERE name = ?', [
		def.name
	]);
	return rows[0].id;
}

export async function upsertDailyMetric(
	date: string,
	metricId: number,
	rawValue: number,
	normalized: number
): Promise<void> {
	await execute(
		`INSERT INTO daily_metrics (date, metric_id, raw_value, normalized, updated_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(date, metric_id) DO UPDATE SET
		   raw_value = excluded.raw_value,
		   normalized = excluded.normalized,
		   updated_at = datetime('now')`,
		[date, metricId, rawValue, normalized]
	);
}

export async function addRawImport(
	source: string,
	filename: string | null,
	data: unknown
): Promise<void> {
	await execute('INSERT INTO raw_imports (source, filename, data) VALUES (?, ?, ?)', [
		source,
		filename,
		JSON.stringify(data)
	]);
}

// --- Token management ---

export async function getToken(service: string): Promise<string | null> {
	const rows = await query<{ token: string }>(
		'SELECT token FROM user_tokens WHERE service = ?',
		[service]
	);
	return rows.length > 0 ? rows[0].token : null;
}

export async function setToken(service: string, token: string): Promise<void> {
	await execute(
		`INSERT INTO user_tokens (service, token) VALUES (?, ?)
		 ON CONFLICT(service) DO UPDATE SET token = excluded.token`,
		[service, token]
	);
}

export async function deleteToken(service: string): Promise<void> {
	await execute('DELETE FROM user_tokens WHERE service = ?', [service]);
}

// --- Sync metadata ---

export async function getSyncMeta(key: string): Promise<string | null> {
	const rows = await query<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
	return rows.length > 0 ? rows[0].value : null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
	await execute(
		`INSERT INTO sync_meta (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		[key, value]
	);
}
