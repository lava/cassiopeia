import type { DbRequest, DbResponse, Param } from './db.protocol';
import type { MetricDefinition } from './types';

let worker: Worker;
let nextId = 0;
const pending = new Map<number, { resolve: (v: DbResponse) => void; reject: (e: Error) => void }>();
let _initPromise: Promise<void> | null = null;

function send(request: DbRequest): Promise<DbResponse> {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		if (request.type === 'serialize') {
			worker.postMessage({ id, request });
		} else {
			worker.postMessage({ id, request });
		}
	});
}

function unwrap(response: DbResponse): void {
	if (response.type === 'error') throw new Error(response.message);
}

export async function initDB(): Promise<void> {
	if (_initPromise) return _initPromise;
	_initPromise = _initDBInternal();
	return _initPromise;
}

async function _initDBInternal(): Promise<void> {
	worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });
	worker.onmessage = (e: MessageEvent<{ id: number; response: DbResponse }>) => {
		const { id, response } = e.data;
		const p = pending.get(id);
		if (p) {
			pending.delete(id);
			p.resolve(response);
		}
	};
	worker.onerror = (e) => {
		console.error('DB worker error:', e);
	};

	const resp = await send({ type: 'init' });
	unwrap(resp);

	// Migrate data from old IDBBatchAtomicVFS if it exists
	await migrateFromIDB();
}

// --- Migration from IDBBatchAtomicVFS ---

async function migrateFromIDB(): Promise<void> {
	if (localStorage.getItem('cassiopeia-migrated-opfs')) return;

	// Check if old IDB database exists
	const databases = await indexedDB.databases();
	const hasOldDb = databases.some((db) => db.name === 'cassiopeia');
	if (!hasOldDb) {
		localStorage.setItem('cassiopeia-migrated-opfs', '1');
		return;
	}

	// Dynamically import the old async build to read data
	const [SQLiteAsyncESMFactory, SQLiteModule, { IDBBatchAtomicVFS }] = await Promise.all([
		import('wa-sqlite/dist/wa-sqlite-async.mjs').then((m) => m.default),
		import('wa-sqlite'),
		import('wa-sqlite/src/examples/IDBBatchAtomicVFS.js')
	]);

	const SQLite = SQLiteModule;
	const module = await SQLiteAsyncESMFactory();
	const oldSqlite3 = SQLite.Factory(module);
	const vfs = new IDBBatchAtomicVFS('cassiopeia');
	oldSqlite3.vfs_register(vfs, true);
	const oldDb = await oldSqlite3.open_v2('cassiopeia');

	// Get all tables
	const tables: string[] = [];
	await oldSqlite3.exec(
		oldDb,
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
		(row: unknown[]) => {
			tables.push(row[0] as string);
		}
	);

	// Dump each table and insert into new database
	for (const table of tables) {
		const rows: unknown[][] = [];
		let columns: string[] = [];
		await oldSqlite3.exec(oldDb, `SELECT * FROM "${table}"`, (row: unknown[], cols: string[]) => {
			if (columns.length === 0) columns = [...cols];
			rows.push([...row]);
		});

		if (rows.length === 0) continue;

		// Build INSERT statements in batches
		const placeholders = columns.map(() => '?').join(',');
		const colList = columns.map((c) => `"${c}"`).join(',');
		const insertSql = `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`;

		for (const row of rows) {
			const params = row.map((v) => (v === undefined ? null : (v as Param)));
			const resp = await send({ type: 'query', sql: insertSql, params });
			unwrap(resp);
		}
	}

	await oldSqlite3.close(oldDb);

	// Delete old IDB database
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase('cassiopeia');
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});

	localStorage.setItem('cassiopeia-migrated-opfs', '1');
	console.log('Migrated database from IndexedDB to OPFS');
}

// --- Core query functions ---

export async function query<T = Record<string, unknown>>(
	sql: string,
	params: Param[] = []
): Promise<T[]> {
	await initDB();
	const resp = await send({ type: 'query', sql, params });
	if (resp.type === 'error') throw new Error(resp.message);
	if (resp.type === 'rows') return resp.rows as T[];
	return [];
}

export async function execute(sql: string, params: Param[] = []): Promise<void> {
	await initDB();
	if (params.length === 0) {
		const resp = await send({ type: 'exec', sql });
		unwrap(resp);
	} else {
		const resp = await send({ type: 'query', sql, params });
		unwrap(resp);
	}
}

export async function queryRaw(
	sql: string
): Promise<{ columns: string[]; rows: unknown[][] }> {
	await initDB();
	const resp = await send({ type: 'queryRaw', sql });
	if (resp.type === 'error') throw new Error(resp.message);
	if (resp.type === 'raw') return { columns: resp.columns, rows: resp.rows };
	return { columns: [], rows: [] };
}

export async function exportDatabase(): Promise<Uint8Array> {
	await initDB();
	const resp = await send({ type: 'serialize' });
	if (resp.type === 'error') throw new Error(resp.message);
	if (resp.type !== 'dump') throw new Error('Unexpected response type');

	// Reconstruct a standard .sqlite file using sql.js on the main thread.
	// sql.js includes sqlite3_serialize via db.export(), which wa-sqlite lacks.
	const initSqlJs = (await import('sql.js')).default;
	const sqlWasmUrl = new URL('sql.js/dist/sql-wasm.wasm', import.meta.url).href;
	const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
	const exportDb = new SQL.Database();

	for (const table of resp.tables) {
		exportDb.run(table.sql);
		if (table.rows.length === 0) continue;
		const placeholders = table.columns.map(() => '?').join(',');
		const colList = table.columns.map((c) => `"${c}"`).join(',');
		const sql = `INSERT INTO "${table.name}" (${colList}) VALUES (${placeholders})`;
		for (const row of table.rows) {
			exportDb.run(sql, row as (string | number | null)[]);
		}
	}

	const data = exportDb.export();
	exportDb.close();
	return data;
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
	data: unknown,
	rawContent: string | null = null
): Promise<number> {
	await execute('INSERT INTO raw_imports (source, filename, data) VALUES (?, ?, ?)', [
		source,
		filename,
		JSON.stringify(data)
	]);
	const rows = await query<{ id: number }>('SELECT last_insert_rowid() as id');
	const importId = rows[0].id;

	if (rawContent) {
		await execute('INSERT INTO raw_import_data (import_id, content) VALUES (?, ?)', [
			importId,
			rawContent
		]);
	}

	return importId;
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
