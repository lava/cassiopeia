<script lang="ts">
	import { queryRaw } from '$lib/db';

	let sqlInput = $state(`-- All metrics for the last 30 days
SELECT d.date, m.display_name, d.raw_value, d.normalized
FROM daily_metrics d
JOIN metric_definitions m ON d.metric_id = m.id
WHERE d.date >= date('now', '-30 days')
ORDER BY d.date DESC
LIMIT 100;`);

	let columns: string[] = $state([]);
	let rows: unknown[][] = $state([]);
	let error: string | null = $state(null);
	let running = $state(false);
	let executionTime: number | null = $state(null);

	let schemaOpen = $state(false);
	let schema: { name: string; columns: { name: string; type: string }[] }[] = $state([]);

	async function loadSchema() {
		try {
			const tables = await queryRaw(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
			);
			const result: typeof schema = [];
			for (const [name] of tables.rows) {
				const info = await queryRaw(`PRAGMA table_info('${name}')`);
				result.push({
					name: name as string,
					columns: info.rows.map((r) => ({
						name: r[1] as string,
						type: r[2] as string
					}))
				});
			}
			schema = result;
		} catch {
			// ignore
		}
	}

	async function runQuery() {
		const sql = sqlInput.trim();
		if (!sql) return;

		running = true;
		error = null;
		columns = [];
		rows = [];
		executionTime = null;

		try {
			const start = performance.now();
			const result = await queryRaw(sql);
			executionTime = Math.round(performance.now() - start);
			columns = result.columns;
			rows = result.rows;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			running = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			runQuery();
		}
	}

	function downloadCsv() {
		if (columns.length === 0 || rows.length === 0) return;
		const header = columns.join(',');
		const body = rows
			.map((row) =>
				row
					.map((cell) => {
						const s = cell === null ? '' : String(cell);
						return s.includes(',') || s.includes('"') || s.includes('\n')
							? `"${s.replace(/"/g, '""')}"`
							: s;
					})
					.join(',')
			)
			.join('\n');
		const csv = header + '\n' + body;
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'query-result.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

	$effect(() => {
		loadSchema();
	});
</script>

<div class="page">
	<div class="page-header">
		<h2>SQL Explorer</h2>
		<p class="page-desc">SQL-Abfragen direkt auf der lokalen Datenbank ausfuehren.</p>
	</div>

	<div class="layout">
		<div class="main-panel">
			<div class="editor-card">
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					class="sql-editor"
					bind:value={sqlInput}
					onkeydown={handleKeydown}
					placeholder="SELECT * FROM daily_metrics LIMIT 10;"
					spellcheck="false"
					autofocus
				></textarea>
				<div class="editor-toolbar">
					<button class="run-btn" onclick={runQuery} disabled={running}>
						{running ? 'Wird ausgefuehrt...' : 'Ausfuehren'}
						<kbd>Ctrl+Enter</kbd>
					</button>
					{#if rows.length > 0}
						<button class="export-btn" onclick={downloadCsv}>CSV Export</button>
					{/if}
					{#if executionTime !== null}
						<span class="exec-time">{rows.length} Zeilen in {executionTime}ms</span>
					{/if}
				</div>
			</div>

			{#if error}
				<div class="error-card">{error}</div>
			{/if}

			{#if columns.length > 0}
				<div class="results-card">
					<div class="table-scroll">
						<table>
							<thead>
								<tr>
									{#each columns as col}
										<th>{col}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each rows as row}
									<tr>
										{#each row as cell}
											<td>{cell === null ? 'NULL' : cell}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>

		<div class="schema-panel">
			<button class="schema-toggle" onclick={() => (schemaOpen = !schemaOpen)}>
				Schema {schemaOpen ? '−' : '+'}
			</button>
			{#if schemaOpen}
				<div class="schema-list">
					{#each schema as table}
						<div class="schema-table">
							<span class="table-name">{table.name}</span>
							<div class="table-columns">
								{#each table.columns as col}
									<span class="col-entry">
										<span class="col-name">{col.name}</span>
										<span class="col-type">{col.type}</span>
									</span>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.page {
		padding: 1.5rem 2rem;
		max-width: 1100px;
	}

	.page-header {
		margin-bottom: 1.25rem;
	}

	.page-header h2 {
		margin: 0 0 0.25rem;
		font-size: 1.35rem;
		font-weight: 700;
		color: #111827;
	}

	.page-desc {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.layout {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}

	.main-panel {
		flex: 1;
		min-width: 0;
	}

	.editor-card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
		margin-bottom: 1rem;
	}

	.sql-editor {
		width: 100%;
		min-height: 160px;
		padding: 1rem;
		border: none;
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		font-size: 0.875rem;
		line-height: 1.6;
		color: #1f2937;
		background: #fafbfc;
		resize: vertical;
		outline: none;
	}

	.editor-toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 1rem;
		border-top: 1px solid #e5e7eb;
		background: #fff;
	}

	.run-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 1rem;
		border-radius: 8px;
		border: none;
		background: #1f2937;
		color: #fff;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		transition: background 0.15s;
	}

	.run-btn:hover:not(:disabled) {
		background: #374151;
	}

	.run-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.run-btn kbd {
		font-size: 0.7rem;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.15);
		font-family: inherit;
	}

	.export-btn {
		padding: 0.4rem 0.75rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #374151;
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 500;
		transition: all 0.15s;
	}

	.export-btn:hover {
		background: #f3f4f6;
	}

	.exec-time {
		margin-left: auto;
		font-size: 0.8rem;
		color: #9ca3af;
	}

	.error-card {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 10px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		color: #dc2626;
		font-size: 0.875rem;
		font-family: monospace;
		white-space: pre-wrap;
	}

	.results-card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
	}

	.table-scroll {
		overflow-x: auto;
		max-height: 500px;
		overflow-y: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.825rem;
	}

	th {
		position: sticky;
		top: 0;
		background: #f9fafb;
		text-align: left;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		color: #374151;
		border-bottom: 1px solid #e5e7eb;
		white-space: nowrap;
	}

	td {
		padding: 0.4rem 0.75rem;
		border-bottom: 1px solid #f3f4f6;
		color: #4b5563;
		white-space: nowrap;
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	tr:hover td {
		background: #f9fafb;
	}

	/* Schema panel */
	.schema-panel {
		width: 200px;
		flex-shrink: 0;
	}

	.schema-toggle {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: #fff;
		color: #374151;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		text-align: left;
	}

	.schema-list {
		margin-top: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.schema-table {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
	}

	.table-name {
		font-weight: 600;
		font-size: 0.8rem;
		color: #111827;
		display: block;
		margin-bottom: 0.25rem;
	}

	.table-columns {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.col-entry {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.7rem;
	}

	.col-name {
		color: #4b5563;
	}

	.col-type {
		color: #9ca3af;
		text-transform: uppercase;
	}

	@media (max-width: 768px) {
		.page {
			padding: 1rem 1.25rem;
		}

		.layout {
			flex-direction: column;
		}

		.schema-panel {
			width: 100%;
		}
	}
</style>
