<script lang="ts">
	import type { ImportResult } from '$lib/types';

	let file: File | null = $state(null);
	let uploading = $state(false);
	let result: ImportResult | null = $state(null);
	let error: string | null = $state(null);
	let dragover = $state(false);

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] ?? null;
		result = null;
		error = null;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragover = false;
		const f = e.dataTransfer?.files?.[0];
		if (f && f.name.endsWith('.csv')) {
			file = f;
			result = null;
			error = null;
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragover = true;
	}

	async function upload() {
		if (!file) return;
		uploading = true;
		result = null;
		error = null;

		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/import/bearable', {
				method: 'POST',
				body: formData
			});
			if (!response.ok) {
				throw new Error(`Upload fehlgeschlagen: ${response.status} ${response.statusText}`);
			}
			result = (await response.json()) as ImportResult;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload fehlgeschlagen';
		} finally {
			uploading = false;
		}
	}
</script>

<div class="page">
	<div class="page-header">
		<h2>Daten importieren</h2>
		<p class="page-desc">Bearable-CSV hochladen, um Gesundheitsdaten zu importieren.</p>
	</div>

	<div class="card">
		<h3>Bearable CSV</h3>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="drop-zone"
			class:dragover
			class:has-file={!!file}
			ondrop={handleDrop}
			ondragover={handleDragOver}
			ondragleave={() => (dragover = false)}
		>
			{#if file}
				<span class="file-icon">📄</span>
				<span class="file-name">{file.name}</span>
				<span class="file-size">{(file.size / 1024).toFixed(0)} KB</span>
				<button class="file-clear" onclick={() => (file = null)}>&times;</button>
			{:else}
				<span class="drop-icon">📥</span>
				<span class="drop-text">CSV-Datei hierher ziehen</span>
				<span class="drop-hint">oder</span>
				<label class="file-select-btn">
					Datei auswählen
					<input type="file" accept=".csv" onchange={handleFileChange} hidden />
				</label>
			{/if}
		</div>

		<button class="upload-btn" onclick={upload} disabled={!file || uploading}>
			{#if uploading}
				Wird importiert...
			{:else}
				Importieren
			{/if}
		</button>

		{#if result}
			<div class="result success">
				<strong>{result.imported}</strong> Datenpunkte importiert
				{#if result.skipped > 0}
					&middot; <strong>{result.skipped}</strong> übersprungen
				{/if}
				{#if result.errors.length > 0}
					<div class="result-errors">
						{#each result.errors as err}
							<div>{err}</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if error}
			<div class="result error-msg">{error}</div>
		{/if}
	</div>

	<div class="card future">
		<h3>Oura</h3>
		<p>Automatische Synchronisation mit Oura Ring — demnächst verfügbar.</p>
	</div>

	<div class="card future">
		<h3>Garmin</h3>
		<p>Garmin Connect Integration — demnächst verfügbar.</p>
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
		margin: 0 0 1rem;
		font-size: 1.05rem;
		font-weight: 650;
		color: #111827;
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
	}
</style>
