import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
// @ts-ignore - wa-sqlite VFS examples don't ship types
import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js';

import type { DbRequest, DbResponse, Param, TableDump } from './db.protocol';

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

CREATE TABLE IF NOT EXISTS raw_import_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES raw_imports(id),
  content TEXT NOT NULL
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

let sqlite3: ReturnType<typeof SQLite.Factory>;
let db: number;
async function init(): Promise<void> {
	const module = await SQLiteESMFactory();
	sqlite3 = SQLite.Factory(module);

	const vfs = new AccessHandlePoolVFS('/cassiopeia');
	await vfs.isReady;
	sqlite3.vfs_register(vfs, true);

	db = await sqlite3.open_v2('cassiopeia');
	await sqlite3.exec(db, SCHEMA);
}

async function handleQuery(sql: string, params: Param[]): Promise<Record<string, unknown>[]> {
	if (params.length === 0) {
		const rows: Record<string, unknown>[] = [];
		await sqlite3.exec(db, sql, (row: unknown[], columns: string[]) => {
			const obj: Record<string, unknown> = {};
			columns.forEach((col, i) => {
				obj[col] = row[i];
			});
			rows.push(obj);
		});
		return rows;
	}

	const results: Record<string, unknown>[] = [];
	for await (const stmt of sqlite3.statements(db, sql)) {
		sqlite3.bind_collection(stmt, params);
		const colCount = sqlite3.column_count(stmt);
		const cols = Array.from({ length: colCount }, (_, i) => sqlite3.column_name(stmt, i));
		while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
			const obj: Record<string, unknown> = {};
			for (let i = 0; i < colCount; i++) {
				obj[cols[i]] = sqlite3.column(stmt, i);
			}
			results.push(obj);
		}
	}
	return results;
}

async function handleQueryRaw(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
	const columns: string[] = [];
	const rows: unknown[][] = [];

	await sqlite3.exec(db, sql, (row: unknown[], cols: string[]) => {
		if (columns.length === 0) columns.push(...cols);
		rows.push([...row]);
	});

	return { columns, rows };
}

async function handleDump(): Promise<TableDump[]> {
	const tables: TableDump[] = [];

	// Get all table schemas
	const schemas: { name: string; sql: string }[] = [];
	await sqlite3.exec(
		db,
		"SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
		(row: unknown[]) => schemas.push({ name: row[0] as string, sql: row[1] as string })
	);

	// Dump data for each table
	for (const s of schemas) {
		const columns: string[] = [];
		const rows: unknown[][] = [];
		await sqlite3.exec(db, `SELECT * FROM "${s.name}"`, (row: unknown[], cols: string[]) => {
			if (columns.length === 0) columns.push(...cols);
			rows.push([...row]);
		});
		tables.push({ name: s.name, sql: s.sql, columns, rows });
	}

	return tables;
}

self.onmessage = async (e: MessageEvent<{ id: number; request: DbRequest }>) => {
	const { id, request } = e.data;

	try {
		let response: DbResponse;
		switch (request.type) {
			case 'init':
				await init();
				response = { type: 'ok' };
				break;
			case 'exec':
				await handleQuery(request.sql, []);
				response = { type: 'ok' };
				break;
			case 'query':
				response = { type: 'rows', rows: await handleQuery(request.sql, request.params) };
				break;
			case 'queryRaw':
				response = { type: 'raw', ...(await handleQueryRaw(request.sql)) };
				break;
			case 'serialize': {
				const tables = await handleDump();
				response = { type: 'dump', tables };
				break;
			}
			default:
				response = { type: 'error', message: 'Unknown request type' };
		}
		self.postMessage({ id, response });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		self.postMessage({ id, response: { type: 'error', message } });
	}
};
