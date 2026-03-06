<script lang="ts">
	import { onMount } from 'svelte';
	import type { ImportResult } from '$lib/types';

	interface UploadState {
		file: File | null;
		uploading: boolean;
		result: ImportResult | null;
		error: string | null;
		dragover: boolean;
	}

	function createUploadState(): UploadState {
		return { file: null, uploading: false, result: null, error: null, dragover: false };
	}

	let bearable: UploadState = $state(createUploadState());
	let garmin: UploadState = $state(createUploadState());

	function handleFileChange(state: UploadState, e: Event) {
		const input = e.target as HTMLInputElement;
		state.file = input.files?.[0] ?? null;
		state.result = null;
		state.error = null;
	}

	function handleDrop(state: UploadState, e: DragEvent) {
		e.preventDefault();
		state.dragover = false;
		const f = e.dataTransfer?.files?.[0];
		if (f && f.name.endsWith('.csv')) {
			state.file = f;
			state.result = null;
			state.error = null;
		}
	}

	async function upload(state: UploadState, endpoint: string) {
		if (!state.file) return;
		state.uploading = true;
		state.result = null;
		state.error = null;

		try {
			const formData = new FormData();
			formData.append('file', state.file);
			const response = await fetch(endpoint, {
				method: 'POST',
				body: formData
			});
			if (!response.ok) {
				throw new Error(`Upload fehlgeschlagen: ${response.status} ${response.statusText}`);
			}
			state.result = (await response.json()) as ImportResult;
		} catch (e) {
			state.error = e instanceof Error ? e.message : 'Upload fehlgeschlagen';
		} finally {
			state.uploading = false;
		}
	}

	let ouraTokenConfigured = $state(false);
	let ouraTokenInput = $state('');
	let ouraTokenSaving = $state(false);
	let ouraTokenError: string | null = $state(null);
	let ouraSyncing = $state(false);
	let ouraResult: ImportResult | null = $state(null);
	let ouraError: string | null = $state(null);
	let ouraDays = $state(30);

	onMount(async () => {
		try {
			const resp = await fetch('/api/import/oura/token');
			if (resp.ok) {
				const data = await resp.json();
				ouraTokenConfigured = data.configured;
			}
		} catch {
			// ignore
		}
	});

	async function saveOuraToken() {
		if (!ouraTokenInput.trim()) return;
		ouraTokenSaving = true;
		ouraTokenError = null;

		try {
			const resp = await fetch('/api/import/oura/token', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: ouraTokenInput.trim() })
			});
			if (!resp.ok) {
				const body = await resp.json().catch(() => null);
				throw new Error(body?.detail || 'Speichern fehlgeschlagen');
			}
			ouraTokenConfigured = true;
			ouraTokenInput = '';
		} catch (e) {
			ouraTokenError = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
		} finally {
			ouraTokenSaving = false;
		}
	}

	async function deleteOuraToken() {
		try {
			await fetch('/api/import/oura/token', { method: 'DELETE' });
			ouraTokenConfigured = false;
			ouraResult = null;
			ouraError = null;
		} catch {
			// ignore
		}
	}

	async function syncOura() {
		ouraSyncing = true;
		ouraResult = null;
		ouraError = null;

		try {
			const end = new Date();
			const start = new Date();
			start.setDate(end.getDate() - ouraDays);

			const params = new URLSearchParams({
				from: start.toISOString().slice(0, 10),
				to: end.toISOString().slice(0, 10)
			});

			const response = await fetch(`/api/import/oura/sync?${params}`, {
				method: 'POST'
			});
			if (!response.ok) {
				const body = await response.json().catch(() => null);
				throw new Error(
					body?.detail || `Sync fehlgeschlagen: ${response.status} ${response.statusText}`
				);
			}
			ouraResult = (await response.json()) as ImportResult;
		} catch (e) {
			ouraError = e instanceof Error ? e.message : 'Sync fehlgeschlagen';
		} finally {
			ouraSyncing = false;
		}
	}
</script>

<div class="page">
	<div class="page-header">
		<h2>Daten importieren</h2>
		<p class="page-desc">Gesundheitsdaten aus verschiedenen Quellen importieren.</p>
	</div>

	{#snippet uploadCard(state: UploadState, title: string, description: string, endpoint: string)}
		<div class="card">
			<h3>{title}</h3>
			<p class="card-desc">{description}</p>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="drop-zone"
				class:dragover={state.dragover}
				class:has-file={!!state.file}
				ondrop={(e: DragEvent) => handleDrop(state, e)}
				ondragover={(e: DragEvent) => { e.preventDefault(); state.dragover = true; }}
				ondragleave={() => (state.dragover = false)}
			>
				{#if state.file}
					<span class="file-icon">📄</span>
					<span class="file-name">{state.file.name}</span>
					<span class="file-size">{(state.file.size / 1024).toFixed(0)} KB</span>
					<button class="file-clear" onclick={() => (state.file = null)}>&times;</button>
				{:else}
					<span class="drop-icon">📥</span>
					<span class="drop-text">CSV-Datei hierher ziehen</span>
					<span class="drop-hint">oder</span>
					<label class="file-select-btn">
						Datei auswählen
						<input type="file" accept=".csv" onchange={(e: Event) => handleFileChange(state, e)} hidden />
					</label>
				{/if}
			</div>

			<button class="upload-btn" onclick={() => upload(state, endpoint)} disabled={!state.file || state.uploading}>
				{#if state.uploading}
					Wird importiert...
				{:else}
					Importieren
				{/if}
			</button>

			{#if state.result}
				<div class="result success">
					<strong>{state.result.imported}</strong> Datenpunkte importiert
					{#if state.result.skipped > 0}
						&middot; <strong>{state.result.skipped}</strong> übersprungen
					{/if}
					{#if state.result.errors.length > 0}
						<div class="result-errors">
							{#each state.result.errors as err}
								<div>{err}</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if state.error}
				<div class="result error-msg">{state.error}</div>
			{/if}
		</div>
	{/snippet}

	{@render uploadCard(bearable, 'Bearable CSV', 'Bearable-Export im CSV-Format hochladen.', '/api/import/bearable')}
	{@render uploadCard(garmin, 'Garmin CSV', 'GarminDB Daily-Summary-Export im CSV-Format hochladen.', '/api/import/garmin')}

	<div class="card">
		<h3>Oura Ring</h3>

		{#if !ouraTokenConfigured}
			<p class="card-desc">
				Oura Personal Access Token eingeben, um Schlaf- und Bereitschaftsdaten zu
				synchronisieren.
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
			<p class="card-desc">
				Schlaf-, Bereitschafts- und Aktivitätsdaten vom Oura Ring synchronisieren.
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
				<button class="sync-btn" onclick={syncOura} disabled={ouraSyncing}>
					{#if ouraSyncing}
						Synchronisiere...
					{:else}
						Synchronisieren
					{/if}
				</button>
			</div>

			{#if ouraResult}
				<div class="result success">
					<strong>{ouraResult.imported}</strong> Datenpunkte importiert
					{#if ouraResult.skipped > 0}
						&middot; <strong>{ouraResult.skipped}</strong> übersprungen
					{/if}
					{#if ouraResult.errors.length > 0}
						<div class="result-errors">
							{#each ouraResult.errors as err}
								<div>{err}</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if ouraError}
				<div class="result error-msg">{ouraError}</div>
			{/if}

			<button class="token-remove-btn" onclick={deleteOuraToken}>
				Token entfernen
			</button>
		{/if}
	</div>
</div>

<style>
	.page {
		padding: 1.5rem 2rem;
		max-width: 640px;
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

	.card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1rem;
	}

	.card h3 {
		margin: 0 0 0.25rem;
		font-size: 1.05rem;
		font-weight: 650;
		color: #111827;
	}

	.card-desc {
		margin: 0 0 1rem;
		color: #6b7280;
		font-size: 0.9rem;
	}


	.card.future {
		opacity: 0.6;
	}

	.card.future p {
		margin: 0;
		color: #6b7280;
		font-size: 0.9rem;
	}

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

	.drop-icon {
		font-size: 2rem;
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

	.file-icon {
		font-size: 1.2rem;
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

	@media (max-width: 768px) {
		.page {
			padding: 1rem 1.25rem;
		}

		.token-form {
			flex-direction: column;
		}
	}
</style>
