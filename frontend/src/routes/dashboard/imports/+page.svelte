<script lang="ts">
	import { onMount } from 'svelte';
	import { importBearableCsv } from '$lib/importers/bearable';
	import { importGarminCsv, importGarminFit } from '$lib/importers/garmin';
	import { syncOura, importOuraCsv } from '$lib/importers/oura';
	import { getToken, setToken, deleteToken, getRawImports, type RawImportRow } from '$lib/db';
	import type { ImportResult } from '$lib/types';

	// --- Overlay state ---
	let activeOverlay: 'oura' | 'garmin' | 'bearable' | null = $state(null);

	function openOverlay(source: 'oura' | 'garmin' | 'bearable') {
		activeOverlay = source;
	}

	function closeOverlay() {
		activeOverlay = null;
	}

	// --- Imports table ---
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
		const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
		return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function formatDateTime(iso: string): string {
		const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
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
		const meta = parseMeta(imp.data);
		const columns = meta?.columns;
		let sql: string;
		if (columns && columns.length > 0) {
			const selects = columns
				.slice(0, 30)
				.map((c: string) => `json_extract(row_data, '$.${c.replace(/'/g, "''")}') as "${c.replace(/"/g, '""')}"`)
				.join(',\n  ');
			sql = `SELECT\n  ${selects}\nFROM raw_import_rows\nWHERE import_id = ${imp.id}\nORDER BY id;`;
		} else {
			sql = `SELECT row_data FROM raw_import_rows WHERE import_id = ${imp.id} ORDER BY id;`;
		}
		return `/dashboard/sql?q=${encodeURIComponent(sql)}`;
	}

	async function refreshImports() {
		imports = await getRawImports();
	}

	// --- Bearable ---
	let bearableFile: File | null = $state(null);
	let bearableUploading = $state(false);
	let bearableResult: ImportResult | null = $state(null);
	let bearableError: string | null = $state(null);
	let bearableDragover = $state(false);

	function handleBearableDrop(e: DragEvent) {
		e.preventDefault();
		bearableDragover = false;
		const f = e.dataTransfer?.files?.[0];
		if (f && f.name.endsWith('.csv')) {
			bearableFile = f;
			bearableResult = null;
			bearableError = null;
		}
	}

	function handleBearableFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		bearableFile = input.files?.[0] ?? null;
		bearableResult = null;
		bearableError = null;
	}

	async function handleImportBearable() {
		if (!bearableFile) return;
		bearableUploading = true;
		bearableResult = null;
		bearableError = null;
		try {
			const text = await bearableFile.text();
			bearableResult = await importBearableCsv(text, bearableFile.name);
			await refreshImports();
		} catch (e) {
			bearableError = e instanceof Error ? e.message : 'Import fehlgeschlagen';
		} finally {
			bearableUploading = false;
		}
	}

	// --- Garmin ---
	let garminFiles: File[] = $state([]);
	let garminUploading = $state(false);
	let garminResult: ImportResult | null = $state(null);
	let garminError: string | null = $state(null);
	let garminDragover = $state(false);

	function handleGarminDrop(e: DragEvent) {
		e.preventDefault();
		garminDragover = false;
		const dropped = e.dataTransfer?.files;
		if (!dropped) return;
		const accepted = Array.from(dropped).filter(
			(f) => f.name.endsWith('.csv') || f.name.endsWith('.fit')
		);
		if (accepted.length > 0) {
			garminFiles = accepted;
			garminResult = null;
			garminError = null;
		}
	}

	function handleGarminFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		garminFiles = input.files ? Array.from(input.files) : [];
		garminResult = null;
		garminError = null;
	}

	async function handleImportGarmin() {
		if (garminFiles.length === 0) return;
		garminUploading = true;
		garminResult = null;
		garminError = null;
		try {
			const csvFiles = garminFiles.filter((f) => f.name.endsWith('.csv'));
			const fitFiles = garminFiles.filter((f) => f.name.endsWith('.fit'));
			let totalImported = 0;
			let totalSkipped = 0;
			const allErrors: string[] = [];
			for (const f of csvFiles) {
				const text = await f.text();
				const result = await importGarminCsv(text, f.name);
				totalImported += result.imported;
				totalSkipped += result.skipped;
				allErrors.push(...result.errors);
			}
			if (fitFiles.length > 0) {
				const fitData = await Promise.all(
					fitFiles.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() }))
				);
				const result = await importGarminFit(fitData);
				totalImported += result.imported;
				totalSkipped += result.skipped;
				allErrors.push(...result.errors);
			}
			garminResult = { imported: totalImported, skipped: totalSkipped, errors: allErrors };
			await refreshImports();
		} catch (e) {
			garminError = e instanceof Error ? e.message : 'Import fehlgeschlagen';
		} finally {
			garminUploading = false;
		}
	}

	// --- Oura CSV ---
	let ouraCsvFiles: File[] = $state([]);
	let ouraCsvUploading = $state(false);
	let ouraCsvResult: ImportResult | null = $state(null);
	let ouraCsvError: string | null = $state(null);
	let ouraCsvDragover = $state(false);

	function handleOuraCsvDrop(e: DragEvent) {
		e.preventDefault();
		ouraCsvDragover = false;
		const dropped = e.dataTransfer?.files;
		if (!dropped) return;
		const csvFiles = Array.from(dropped).filter((f) => f.name.endsWith('.csv'));
		if (csvFiles.length > 0) {
			ouraCsvFiles = csvFiles;
			ouraCsvResult = null;
			ouraCsvError = null;
		}
	}

	function handleOuraCsvFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		ouraCsvFiles = input.files ? Array.from(input.files) : [];
		ouraCsvResult = null;
		ouraCsvError = null;
	}

	async function handleImportOuraCsv() {
		if (ouraCsvFiles.length === 0) return;
		ouraCsvUploading = true;
		ouraCsvResult = null;
		ouraCsvError = null;
		try {
			const fileData = await Promise.all(
				ouraCsvFiles.map(async (f) => ({ name: f.name, content: await f.text() }))
			);
			ouraCsvResult = await importOuraCsv(fileData);
			await refreshImports();
		} catch (e) {
			ouraCsvError = e instanceof Error ? e.message : 'Import fehlgeschlagen';
		} finally {
			ouraCsvUploading = false;
		}
	}

	// --- Oura Ring sync ---
	let ouraTokenConfigured = $state(false);
	let ouraTokenInput = $state('');
	let ouraTokenSaving = $state(false);
	let ouraTokenError: string | null = $state(null);
	let ouraSyncing = $state(false);
	let ouraResult: ImportResult | null = $state(null);
	let ouraError: string | null = $state(null);
	let ouraDays = $state(30);

	async function saveOuraToken() {
		if (!ouraTokenInput.trim()) return;
		ouraTokenSaving = true;
		ouraTokenError = null;
		try {
			await setToken('oura', ouraTokenInput.trim());
			ouraTokenConfigured = true;
			ouraTokenInput = '';
		} catch (e) {
			ouraTokenError = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
		} finally {
			ouraTokenSaving = false;
		}
	}

	async function removeOuraToken() {
		await deleteToken('oura');
		ouraTokenConfigured = false;
		ouraResult = null;
		ouraError = null;
	}

	async function handleSyncOura() {
		ouraSyncing = true;
		ouraResult = null;
		ouraError = null;
		try {
			const end = new Date();
			const start = new Date();
			start.setDate(end.getDate() - ouraDays);
			ouraResult = await syncOura(
				start.toISOString().slice(0, 10),
				end.toISOString().slice(0, 10)
			);
			await refreshImports();
		} catch (e) {
			ouraError = e instanceof Error ? e.message : 'Sync fehlgeschlagen';
		} finally {
			ouraSyncing = false;
		}
	}

	// --- Init ---
	onMount(async () => {
		const [token] = await Promise.all([getToken('oura'), refreshImports()]);
		ouraTokenConfigured = !!token;
		loading = false;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->

<div class="page">
	<div class="page-header">
		<h2>Imports</h2>
		<p class="page-desc">Gesundheitsdaten aus verschiedenen Quellen importieren.</p>
	</div>

	<div class="import-buttons">
		<button class="import-btn oura" onclick={() => openOverlay('oura')}>
			<span class="import-btn-icon">
				<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
					<path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 110 12 6 6 0 010-12zm0 2a4 4 0 100 8 4 4 0 000-8z" />
				</svg>
			</span>
			Import Oura
		</button>
		<button class="import-btn garmin" onclick={() => openOverlay('garmin')}>
			<span class="import-btn-icon">
				<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
					<path d="M10 2L3 7v6l7 5 7-5V7l-7-5zm0 2.5L14.5 8 10 11.5 5.5 8 10 4.5z" />
				</svg>
			</span>
			Import Garmin
		</button>
		<button class="import-btn bearable" onclick={() => openOverlay('bearable')}>
			<span class="import-btn-icon">
				<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
					<path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
				</svg>
			</span>
			Import Bearable
		</button>
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
								<a href={sqlUrl(imp)} class="sql-link" title="Im SQL Explorer anzeigen">View Data</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="total">{imports.length} Imports gesamt</p>
	{/if}
</div>

<!-- Overlays -->
{#if activeOverlay}
	<div class="overlay-backdrop" onclick={closeOverlay}></div>
	<div class="overlay">
		<button class="overlay-close" onclick={closeOverlay}>&times;</button>

		{#if activeOverlay === 'bearable'}
			<h3>Bearable CSV importieren</h3>
			<p class="overlay-desc">Bearable-Export im CSV-Format importieren.</p>

			<div
				class="drop-zone"
				class:dragover={bearableDragover}
				class:has-file={!!bearableFile}
				ondrop={handleBearableDrop}
				ondragover={(e: DragEvent) => { e.preventDefault(); bearableDragover = true; }}
				ondragleave={() => (bearableDragover = false)}
			>
				{#if bearableFile}
					<span class="file-name">{bearableFile.name}</span>
					<span class="file-size">{(bearableFile.size / 1024).toFixed(0)} KB</span>
					<button class="file-clear" onclick={() => (bearableFile = null)}>&times;</button>
				{:else}
					<span class="drop-text">CSV-Datei hierher ziehen</span>
					<span class="drop-hint">oder</span>
					<label class="file-select-btn">
						Datei auswaehlen
						<input type="file" accept=".csv" onchange={handleBearableFileChange} hidden />
					</label>
				{/if}
			</div>

			<button class="upload-btn" onclick={handleImportBearable} disabled={!bearableFile || bearableUploading}>
				{bearableUploading ? 'Wird importiert...' : 'Importieren'}
			</button>

			{#if bearableResult}
				<div class="result success">
					<strong>{bearableResult.imported}</strong> Datenpunkte importiert
					{#if bearableResult.skipped > 0}
						&middot; <strong>{bearableResult.skipped}</strong> uebersprungen
					{/if}
					{#if bearableResult.errors.length > 0}
						<div class="result-errors">
							{#each bearableResult.errors as err}<div>{err}</div>{/each}
						</div>
					{/if}
				</div>
			{/if}
			{#if bearableError}
				<div class="result error-msg">{bearableError}</div>
			{/if}

		{:else if activeOverlay === 'garmin'}
			<h3>Garmin importieren</h3>
			<p class="overlay-desc">
				Garmin-Daten importieren: Aggregator-CSV aus dem Garmin Connect Export
				und/oder .fit-Aktivitaetsdateien. Mehrere Dateien gleichzeitig auswaehlen.
			</p>

			<div
				class="drop-zone"
				class:dragover={garminDragover}
				class:has-file={garminFiles.length > 0}
				ondrop={handleGarminDrop}
				ondragover={(e: DragEvent) => { e.preventDefault(); garminDragover = true; }}
				ondragleave={() => (garminDragover = false)}
			>
				{#if garminFiles.length > 0}
					<span class="file-name">{garminFiles.length} Datei{garminFiles.length > 1 ? 'en' : ''}</span>
					<span class="file-size">
						{garminFiles.filter((f) => f.name.endsWith('.csv')).length} CSV,
						{garminFiles.filter((f) => f.name.endsWith('.fit')).length} FIT
					</span>
					<button class="file-clear" onclick={() => (garminFiles = [])}>&times;</button>
				{:else}
					<span class="drop-text">CSV- oder FIT-Dateien hierher ziehen</span>
					<span class="drop-hint">oder</span>
					<label class="file-select-btn">
						Dateien auswaehlen
						<input type="file" accept=".csv,.fit" multiple onchange={handleGarminFileChange} hidden />
					</label>
				{/if}
			</div>

			<button class="upload-btn" onclick={handleImportGarmin} disabled={garminFiles.length === 0 || garminUploading}>
				{garminUploading ? 'Wird importiert...' : 'Importieren'}
			</button>

			{#if garminResult}
				<div class="result success">
					<strong>{garminResult.imported}</strong> Datenpunkte importiert
					{#if garminResult.skipped > 0}
						&middot; <strong>{garminResult.skipped}</strong> uebersprungen
					{/if}
					{#if garminResult.errors.length > 0}
						<div class="result-errors">
							{#each garminResult.errors as err}<div>{err}</div>{/each}
						</div>
					{/if}
				</div>
			{/if}
			{#if garminError}
				<div class="result error-msg">{garminError}</div>
			{/if}

		{:else if activeOverlay === 'oura'}
			<h3>Oura importieren</h3>

			<!-- CSV import -->
			<h4>CSV-Dateien</h4>
			<p class="overlay-desc">
				Oura-Export CSV-Dateien importieren (dailysleep, dailyreadiness, dailyactivity).
			</p>

			<div
				class="drop-zone"
				class:dragover={ouraCsvDragover}
				class:has-file={ouraCsvFiles.length > 0}
				ondrop={handleOuraCsvDrop}
				ondragover={(e: DragEvent) => { e.preventDefault(); ouraCsvDragover = true; }}
				ondragleave={() => (ouraCsvDragover = false)}
			>
				{#if ouraCsvFiles.length > 0}
					<span class="file-name">{ouraCsvFiles.length} Datei{ouraCsvFiles.length > 1 ? 'en' : ''}</span>
					<span class="file-size">{ouraCsvFiles.map((f) => f.name).join(', ')}</span>
					<button class="file-clear" onclick={() => (ouraCsvFiles = [])}>&times;</button>
				{:else}
					<span class="drop-text">CSV-Dateien hierher ziehen</span>
					<span class="drop-hint">oder</span>
					<label class="file-select-btn">
						Dateien auswaehlen
						<input type="file" accept=".csv" multiple onchange={handleOuraCsvFileChange} hidden />
					</label>
				{/if}
			</div>

			<button class="upload-btn" onclick={handleImportOuraCsv} disabled={ouraCsvFiles.length === 0 || ouraCsvUploading}>
				{ouraCsvUploading ? 'Wird importiert...' : 'Importieren'}
			</button>

			{#if ouraCsvResult}
				<div class="result success">
					<strong>{ouraCsvResult.imported}</strong> Datenpunkte importiert
					{#if ouraCsvResult.skipped > 0}
						&middot; <strong>{ouraCsvResult.skipped}</strong> uebersprungen
					{/if}
					{#if ouraCsvResult.errors.length > 0}
						<div class="result-errors">
							{#each ouraCsvResult.errors as err}<div>{err}</div>{/each}
						</div>
					{/if}
				</div>
			{/if}
			{#if ouraCsvError}
				<div class="result error-msg">{ouraCsvError}</div>
			{/if}

			<!-- Oura Ring sync -->
			<div class="section-divider"></div>
			<h4>Oura Ring Sync</h4>

			{#if !ouraTokenConfigured}
				<p class="overlay-desc">
					Oura Personal Access Token eingeben, um Schlaf- und Bereitschaftsdaten zu synchronisieren.
				</p>
				<div class="token-form">
					<input
						type="password"
						class="token-input"
						placeholder="Personal Access Token"
						bind:value={ouraTokenInput}
					/>
					<button
						class="token-save-btn"
						onclick={saveOuraToken}
						disabled={!ouraTokenInput.trim() || ouraTokenSaving}
					>
						{ouraTokenSaving ? 'Speichert...' : 'Speichern'}
					</button>
				</div>
				{#if ouraTokenError}
					<div class="result error-msg">{ouraTokenError}</div>
				{/if}
			{:else}
				<p class="overlay-desc">
					Schlaf-, Bereitschafts- und Aktivitaetsdaten vom Oura Ring synchronisieren.
				</p>
				<div class="sync-controls">
					<label class="days-label">
						Letzte
						<select bind:value={ouraDays}>
							<option value={7}>7 Tage</option>
							<option value={30}>30 Tage</option>
							<option value={90}>90 Tage</option>
							<option value={180}>180 Tage</option>
							<option value={365}>1 Jahr</option>
						</select>
					</label>
					<button class="sync-btn" onclick={handleSyncOura} disabled={ouraSyncing}>
						{ouraSyncing ? 'Synchronisiere...' : 'Synchronisieren'}
					</button>
				</div>

				{#if ouraResult}
					<div class="result success">
						<strong>{ouraResult.imported}</strong> Datenpunkte importiert
						{#if ouraResult.skipped > 0}
							&middot; <strong>{ouraResult.skipped}</strong> uebersprungen
						{/if}
						{#if ouraResult.errors.length > 0}
							<div class="result-errors">
								{#each ouraResult.errors as err}<div>{err}</div>{/each}
							</div>
						{/if}
					</div>
				{/if}
				{#if ouraError}
					<div class="result error-msg">{ouraError}</div>
				{/if}

				<button class="token-remove-btn" onclick={removeOuraToken}>
					Token entfernen
				</button>
			{/if}
		{/if}
	</div>
{/if}

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

	/* Import buttons */
	.import-buttons {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.import-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		border-radius: 10px;
		border: 1px solid #e5e7eb;
		background: #fff;
		color: #374151;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.import-btn:hover {
		border-color: #d1d5db;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
	}

	.import-btn.oura:hover {
		background: #eff6ff;
		border-color: #93c5fd;
		color: #1e40af;
	}

	.import-btn.garmin:hover {
		background: #ecfdf5;
		border-color: #6ee7b7;
		color: #065f46;
	}

	.import-btn.bearable:hover {
		background: #fffbeb;
		border-color: #fcd34d;
		color: #92400e;
	}

	.import-btn-icon {
		display: flex;
		align-items: center;
		opacity: 0.7;
	}

	/* Overlay */
	.overlay-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.overlay {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: #fff;
		border-radius: 14px;
		padding: 1.75rem;
		width: 90%;
		max-width: 520px;
		max-height: 85vh;
		overflow-y: auto;
		z-index: 101;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
	}

	.overlay h3 {
		margin: 0 0 0.25rem;
		font-size: 1.15rem;
		font-weight: 700;
		color: #111827;
	}

	.overlay h4 {
		margin: 0 0 0.25rem;
		font-size: 0.95rem;
		font-weight: 650;
		color: #111827;
	}

	.overlay-desc {
		margin: 0 0 1rem;
		color: #6b7280;
		font-size: 0.875rem;
	}

	.overlay-close {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		background: none;
		border: none;
		font-size: 1.5rem;
		color: #9ca3af;
		cursor: pointer;
		line-height: 1;
		padding: 0.25rem;
	}

	.overlay-close:hover {
		color: #374151;
	}

	.section-divider {
		border-top: 1px solid #e5e7eb;
		margin: 1.25rem 0;
	}

	/* Drop zone */
	.drop-zone {
		border: 2px dashed #d1d5db;
		border-radius: 10px;
		padding: 2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		transition: all 0.15s ease;
		cursor: default;
	}

	.drop-zone.dragover {
		border-color: #6d28d9;
		background: #f5f3ff;
	}

	.drop-zone.has-file {
		border-style: solid;
		border-color: #d1d5db;
		background: #f9fafb;
		flex-direction: row;
		justify-content: center;
		padding: 1rem 1.5rem;
	}

	.drop-text {
		color: #374151;
		font-weight: 500;
		font-size: 0.95rem;
	}

	.drop-hint {
		color: #9ca3af;
		font-size: 0.8rem;
	}

	.file-select-btn {
		display: inline-block;
		padding: 0.4rem 1rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #374151;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.file-select-btn:hover {
		background: #f3f4f6;
	}

	.file-name {
		font-weight: 600;
		color: #111827;
		font-size: 0.9rem;
	}

	.file-size {
		color: #9ca3af;
		font-size: 0.8rem;
	}

	.file-clear {
		margin-left: 0.5rem;
		background: none;
		border: none;
		color: #9ca3af;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 0.3rem;
		line-height: 1;
	}

	.file-clear:hover {
		color: #dc2626;
	}

	.upload-btn {
		width: 100%;
		margin-top: 1rem;
		padding: 0.65rem 1rem;
		border-radius: 10px;
		border: none;
		background: #1f2937;
		color: #fff;
		cursor: pointer;
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.15s ease;
	}

	.upload-btn:hover:not(:disabled) {
		background: #374151;
	}

	.upload-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Token / sync */
	.token-form {
		display: flex;
		gap: 0.5rem;
	}

	.token-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		font-size: 0.9rem;
		color: #374151;
	}

	.token-input:focus {
		outline: none;
		border-color: #6d28d9;
		box-shadow: 0 0 0 2px rgba(109, 40, 217, 0.1);
	}

	.token-save-btn {
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		border: none;
		background: #1f2937;
		color: #fff;
		cursor: pointer;
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.token-save-btn:hover:not(:disabled) {
		background: #374151;
	}

	.token-save-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.token-remove-btn {
		margin-top: 1rem;
		padding: 0.4rem 0.75rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: #fff;
		color: #dc2626;
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.token-remove-btn:hover {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.sync-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.days-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #374151;
		font-size: 0.9rem;
	}

	.days-label select {
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #374151;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.sync-btn {
		margin-left: auto;
		padding: 0.5rem 1.25rem;
		border-radius: 10px;
		border: none;
		background: #1f2937;
		color: #fff;
		cursor: pointer;
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.15s ease;
	}

	.sync-btn:hover:not(:disabled) {
		background: #374151;
	}

	.sync-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Results */
	.result {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-size: 0.875rem;
	}

	.result.success {
		background: #f0fdf4;
		color: #166534;
		border: 1px solid #bbf7d0;
	}

	.result-errors {
		margin-top: 0.5rem;
		color: #dc2626;
		font-size: 0.8rem;
	}

	.error-msg {
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
	}

	/* Table */
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

		.import-buttons {
			flex-direction: column;
		}

		.token-form {
			flex-direction: column;
		}
	}
</style>
