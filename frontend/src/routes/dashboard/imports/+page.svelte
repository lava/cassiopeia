<script lang="ts">
	import { onMount } from 'svelte';
	import { getRawImports, type RawImportRow } from '$lib/db';

	let imports: RawImportRow[] = $state([]);
	let loading = $state(true);

	const sourceLabels: Record<string, string> = {
		bearable: 'Bearable',
		oura: 'Oura',
		oura_csv: 'Oura CSV',
		garmin: 'Garmin',
		garmin_fit: 'Garmin FIT'
	};

	interface ImportMeta {
		rows?: number;
		columns?: string[];
		files?: string[] | number;
		sessions?: number;
		days?: number;
		start_date?: string;
		end_date?: string;
		record_counts?: Record<string, number>;
	}

	function parseMeta(data: string | null): ImportMeta | null {
		if (!data) return null;
		try {
			return JSON.parse(data) as ImportMeta;
		} catch {
			return null;
		}
	}

	function formatDate(iso: string): string {
		const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
		return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function formatDateTime(iso: string): string {
		const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
		return d.toLocaleDateString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function dateRange(meta: ImportMeta | null): string | null {
		if (!meta) return null;
		if (meta.start_date && meta.end_date) {
			return `${formatDate(meta.start_date)} – ${formatDate(meta.end_date)}`;
		}
		return null;
	}

	function metaSummary(meta: ImportMeta | null): string | null {
		if (!meta) return null;
		const parts: string[] = [];
		if (meta.rows !== undefined) parts.push(`${meta.rows} Zeilen`);
		if (meta.sessions !== undefined) parts.push(`${meta.sessions} Sessions`);
		if (meta.days !== undefined) parts.push(`${meta.days} Tage`);
		if (typeof meta.files === 'number') parts.push(`${meta.files} Dateien`);
		if (meta.record_counts) {
			for (const [k, v] of Object.entries(meta.record_counts)) {
				parts.push(`${k}: ${v}`);
			}
		}
		return parts.length > 0 ? parts.join(', ') : null;
	}

	function sqlUrl(imp: RawImportRow): string {
		const sql = `SELECT ri.source, ri.filename, ri.imported_at, ri.data,
  rid.content
FROM raw_imports ri
LEFT JOIN raw_import_data rid ON rid.import_id = ri.id
WHERE ri.id = ${imp.id};`;
		return `/dashboard/sql?q=${encodeURIComponent(sql)}`;
	}

	onMount(async () => {
		try {
			imports = await getRawImports();
		} finally {
			loading = false;
		}
	});
</script>

<div class="page">
	<div class="page-header">
		<h2>Imports</h2>
		<p class="page-desc">Alle bisherigen Datenimporte.</p>
	</div>

	{#if loading}
		<p class="muted">Laden...</p>
	{:else if imports.length === 0}
		<div class="card empty">
			<p>Noch keine Imports vorhanden.</p>
		</div>
	{:else}
		<div class="imports-table-wrap">
			<table class="imports-table">
				<thead>
					<tr>
						<th>Quelle</th>
						<th>Dateiname</th>
						<th>Importiert am</th>
						<th>Zeitraum</th>
						<th>Details</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each imports as imp}
						{@const meta = parseMeta(imp.data)}
						<tr>
							<td>
								<span class="source-badge source-{imp.source}">
									{sourceLabels[imp.source] ?? imp.source}
								</span>
							</td>
							<td class="filename">{imp.filename ?? '–'}</td>
							<td class="datetime">{formatDateTime(imp.imported_at)}</td>
							<td class="daterange">{dateRange(meta) ?? '–'}</td>
							<td class="details">{metaSummary(meta) ?? '–'}</td>
							<td>
								<a href={sqlUrl(imp)} class="sql-link" title="Im SQL Explorer anzeigen">SQL</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="total">{imports.length} Imports gesamt</p>
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem 2rem;
		max-width: 960px;
	}

	.page-header {
		margin-bottom: 1.5rem;
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

	.muted {
		color: #9ca3af;
	}

	.card.empty {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		text-align: center;
		color: #6b7280;
		padding: 2rem;
	}

	.card.empty p {
		margin: 0;
	}

	.imports-table-wrap {
		overflow-x: auto;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: #fff;
	}

	.imports-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.imports-table th {
		text-align: left;
		padding: 0.7rem 1rem;
		font-weight: 600;
		font-size: 0.8rem;
		color: #6b7280;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
		white-space: nowrap;
	}

	.imports-table td {
		padding: 0.6rem 1rem;
		border-bottom: 1px solid #f3f4f6;
		color: #374151;
	}

	.imports-table tbody tr:last-child td {
		border-bottom: none;
	}

	.imports-table tbody tr:hover {
		background: #f9fafb;
	}

	.source-badge {
		display: inline-block;
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
		font-weight: 500;
		background: #f3f4f6;
		color: #6b7280;
		white-space: nowrap;
	}

	.source-bearable {
		background: #fef3c7;
		color: #92400e;
	}

	.source-oura,
	.source-oura_csv {
		background: #dbeafe;
		color: #1e40af;
	}

	.source-garmin,
	.source-garmin_fit {
		background: #d1fae5;
		color: #065f46;
	}

	.filename {
		font-family: monospace;
		font-size: 0.8rem;
		max-width: 250px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.datetime,
	.daterange {
		white-space: nowrap;
		font-size: 0.825rem;
	}

	.details {
		font-size: 0.8rem;
		color: #6b7280;
	}

	.sql-link {
		display: inline-block;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		font-family: monospace;
		text-decoration: none;
		color: #6b7280;
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		transition: all 0.15s;
	}

	.sql-link:hover {
		color: #1f2937;
		background: #e5e7eb;
	}

	.total {
		margin-top: 0.75rem;
		font-size: 0.825rem;
		color: #9ca3af;
	}

	@media (max-width: 768px) {
		.page {
			padding: 1rem 1.25rem;
		}
	}
</style>
