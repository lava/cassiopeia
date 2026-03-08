import { createClient, type Client } from '@libsql/client/web';
import { query, execute, getSyncMeta, setSyncMeta } from '$lib/db';

/** Format a Date to match SQLite's datetime('now'): 'YYYY-MM-DD HH:MM:SS' */
function sqliteNow(): string {
	return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

let tursoClient: Client | null = null;

interface SyncCredentials {
	url: string;
	token: string;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'disconnected';

let _syncState: SyncState = $state('disconnected');
let _lastSync: string | null = $state(null);

export function getSyncState(): SyncState {
	return _syncState;
}

export function getLastSync(): string | null {
	return _lastSync;
}

async function getCredentials(): Promise<SyncCredentials | null> {
	try {
		const resp = await fetch('/api/sync/credentials');
		if (!resp.ok) return null;
		return await resp.json();
	} catch {
		return null;
	}
}

async function ensureClient(): Promise<Client | null> {
	if (tursoClient) return tursoClient;

	const creds = await getCredentials();
	if (!creds) return null;

	tursoClient = createClient({ url: creds.url, authToken: creds.token });
	return tursoClient;
}

async function pushChanges(): Promise<void> {
	const client = await ensureClient();
	if (!client) return;

	let lastPush = (await getSyncMeta('last_push')) ?? '1970-01-01 00:00:00';
	// Migrate old ISO format (with T) to SQLite format (with space) — force full re-push
	if (lastPush.includes('T')) lastPush = '1970-01-01 00:00:00';

	// Push metric definitions
	const newDefs = await query<{
		id: number;
		name: string;
		display_name: string;
		source: string;
		original_min: number;
		original_max: number;
		category: string | null;
		is_default: number;
		updated_at: string;
	}>('SELECT * FROM metric_definitions WHERE updated_at > ?', [lastPush]);

	for (const def of newDefs) {
		await client.execute({
			sql: `INSERT INTO metric_definitions (id, name, display_name, source, original_min, original_max, category, is_default, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			      ON CONFLICT(name) DO UPDATE SET
			        display_name = excluded.display_name,
			        original_max = excluded.original_max,
			        is_default = excluded.is_default,
			        updated_at = excluded.updated_at`,
			args: [
				def.id,
				def.name,
				def.display_name,
				def.source,
				def.original_min,
				def.original_max,
				def.category,
				def.is_default,
				def.updated_at
			]
		});
	}

	// Push daily metrics
	const newMetrics = await query<{
		id: number;
		date: string;
		metric_id: number;
		raw_value: number;
		normalized: number;
		updated_at: string;
	}>('SELECT * FROM daily_metrics WHERE updated_at > ?', [lastPush]);

	for (const m of newMetrics) {
		await client.execute({
			sql: `INSERT INTO daily_metrics (id, date, metric_id, raw_value, normalized, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?)
			      ON CONFLICT(date, metric_id) DO UPDATE SET
			        raw_value = excluded.raw_value,
			        normalized = excluded.normalized,
			        updated_at = excluded.updated_at`,
			args: [m.id, m.date, m.metric_id, m.raw_value, m.normalized, m.updated_at]
		});
	}

	// Push raw imports
	const newImports = await query<{
		id: number;
		source: string;
		imported_at: string;
		filename: string | null;
		data: string | null;
	}>('SELECT * FROM raw_imports WHERE imported_at > ?', [lastPush]);

	for (const imp of newImports) {
		await client.execute({
			sql: `INSERT INTO raw_imports (id, source, imported_at, filename, data)
			      VALUES (?, ?, ?, ?, ?)
			      ON CONFLICT(id) DO NOTHING`,
			args: [imp.id, imp.source, imp.imported_at, imp.filename, imp.data]
		});

		const dataRows = await query<{
			id: number;
			import_id: number;
			content: string;
		}>('SELECT * FROM raw_import_data WHERE import_id = ?', [imp.id]);

		for (const d of dataRows) {
			await client.execute({
				sql: `INSERT INTO raw_import_data (id, import_id, content)
				      VALUES (?, ?, ?)
				      ON CONFLICT(id) DO NOTHING`,
				args: [d.id, d.import_id, d.content]
			});
		}
	}

	// Push user tokens
	const newTokens = await query<{
		id: number;
		service: string;
		token: string;
		created_at: string;
	}>('SELECT * FROM user_tokens WHERE created_at > ?', [lastPush]);

	for (const tok of newTokens) {
		await client.execute({
			sql: `INSERT INTO user_tokens (id, service, token, created_at)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT(service) DO UPDATE SET
			        token = excluded.token,
			        created_at = excluded.created_at`,
			args: [tok.id, tok.service, tok.token, tok.created_at]
		});
	}

	await setSyncMeta('last_push', sqliteNow());
}

async function pullChanges(): Promise<void> {
	const client = await ensureClient();
	if (!client) return;

	let lastPull = (await getSyncMeta('last_pull')) ?? '1970-01-01 00:00:00';
	// Migrate old ISO format (with T) to SQLite format (with space) — force full re-pull
	if (lastPull.includes('T')) lastPull = '1970-01-01 00:00:00';

	// Pull metric definitions
	const defsResult = await client.execute({
		sql: 'SELECT * FROM metric_definitions WHERE updated_at > ?',
		args: [lastPull]
	});

	for (const row of defsResult.rows) {
		await execute(
			`INSERT INTO metric_definitions (id, name, display_name, source, original_min, original_max, category, is_default, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(name) DO UPDATE SET
			   display_name = CASE WHEN excluded.updated_at > metric_definitions.updated_at THEN excluded.display_name ELSE metric_definitions.display_name END,
			   original_max = CASE WHEN excluded.updated_at > metric_definitions.updated_at THEN excluded.original_max ELSE metric_definitions.original_max END,
			   is_default = CASE WHEN excluded.updated_at > metric_definitions.updated_at THEN excluded.is_default ELSE metric_definitions.is_default END,
			   updated_at = CASE WHEN excluded.updated_at > metric_definitions.updated_at THEN excluded.updated_at ELSE metric_definitions.updated_at END`,
			[
				row.id as number,
				row.name as string,
				row.display_name as string,
				row.source as string,
				row.original_min as number,
				row.original_max as number,
				row.category as string | null,
				row.is_default as number,
				row.updated_at as string
			]
		);
	}

	// Pull daily metrics
	const metricsResult = await client.execute({
		sql: 'SELECT * FROM daily_metrics WHERE updated_at > ?',
		args: [lastPull]
	});

	for (const row of metricsResult.rows) {
		await execute(
			`INSERT INTO daily_metrics (id, date, metric_id, raw_value, normalized, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(date, metric_id) DO UPDATE SET
			   raw_value = CASE WHEN excluded.updated_at > daily_metrics.updated_at THEN excluded.raw_value ELSE daily_metrics.raw_value END,
			   normalized = CASE WHEN excluded.updated_at > daily_metrics.updated_at THEN excluded.normalized ELSE daily_metrics.normalized END,
			   updated_at = CASE WHEN excluded.updated_at > daily_metrics.updated_at THEN excluded.updated_at ELSE daily_metrics.updated_at END`,
			[
				row.id as number,
				row.date as string,
				row.metric_id as number,
				row.raw_value as number,
				row.normalized as number,
				row.updated_at as string
			]
		);
	}

	// Pull raw imports
	const importsResult = await client.execute({
		sql: 'SELECT * FROM raw_imports WHERE imported_at > ?',
		args: [lastPull]
	});

	for (const row of importsResult.rows) {
		await execute(
			`INSERT INTO raw_imports (id, source, imported_at, filename, data)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO NOTHING`,
			[
				row.id as number,
				row.source as string,
				row.imported_at as string,
				row.filename as string | null,
				row.data as string | null
			]
		);

		const dataResult = await client.execute({
			sql: 'SELECT * FROM raw_import_data WHERE import_id = ?',
			args: [row.id as number]
		});

		for (const d of dataResult.rows) {
			await execute(
				`INSERT INTO raw_import_data (id, import_id, content)
				 VALUES (?, ?, ?)
				 ON CONFLICT(id) DO NOTHING`,
				[d.id as number, d.import_id as number, d.content as string]
			);
		}
	}

	// Pull user tokens
	const tokensResult = await client.execute({
		sql: 'SELECT * FROM user_tokens WHERE created_at > ?',
		args: [lastPull]
	});

	for (const row of tokensResult.rows) {
		await execute(
			`INSERT INTO user_tokens (id, service, token, created_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(service) DO UPDATE SET
			   token = excluded.token,
			   created_at = excluded.created_at`,
			[
				row.id as number,
				row.service as string,
				row.token as string,
				row.created_at as string
			]
		);
	}

	await setSyncMeta('last_pull', sqliteNow());
}

export async function syncNow(): Promise<void> {
	if (_syncState === 'syncing') return;

	if (!navigator.onLine) {
		_syncState = 'offline';
		return;
	}

	_syncState = 'syncing';
	try {
		await pushChanges();
		await pullChanges();
		_lastSync = sqliteNow();
		await setSyncMeta('last_sync', _lastSync);
		_syncState = 'idle';
	} catch (e) {
		console.error('Sync failed:', e);
		_syncState = 'idle';
	}
}

export async function provisionSync(): Promise<boolean> {
	try {
		const resp = await fetch('/api/sync/provision', { method: 'POST' });
		return resp.ok;
	} catch {
		return false;
	}
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(): void {
	if (syncInterval) return;
	syncNow();
	syncInterval = setInterval(syncNow, 5 * 60 * 1000);
}

export function stopAutoSync(): void {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	tursoClient = null;
	_syncState = 'disconnected';
}

export async function initSync(): Promise<void> {
	_lastSync = await getSyncMeta('last_sync');
	const creds = await getCredentials();
	if (creds) {
		_syncState = 'idle';
		startAutoSync();
	}
}
