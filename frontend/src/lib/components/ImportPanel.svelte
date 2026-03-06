<script lang="ts">
	import type { ImportResult } from '$lib/types';

	interface Props {
		onImported?: () => void;
	}

	let { onImported }: Props = $props();

	let open = $state(false);
	let file: File | null = $state(null);
	let uploading = $state(false);
	let result: ImportResult | null = $state(null);
	let error: string | null = $state(null);

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] ?? null;
		result = null;
		error = null;
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
				throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
			}
			result = (await response.json()) as ImportResult;
			onImported?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload failed';
		} finally {
			uploading = false;
		}
	}
</script>

<div class="import-wrapper">
	<button class="import-btn" onclick={() => (open = !open)}>
		Import {open ? '\u25B4' : '\u25BE'}
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (open = false)} onkeydown={() => {}}></div>
		<div class="import-panel">
			<h3>Bearable CSV importieren</h3>
			<div class="file-row">
				<input type="file" accept=".csv" onchange={handleFileChange} />
			</div>
			<button class="upload-btn" onclick={upload} disabled={!file || uploading}>
				{uploading ? 'Wird hochgeladen...' : 'Hochladen'}
			</button>

			{#if result}
				<div class="result success">
					{result.imported} importiert, {result.skipped} übersprungen
					{#if result.errors.length > 0}
						<div class="result-errors">{result.errors.join(', ')}</div>
					{/if}
				</div>
			{/if}

			{#if error}
				<div class="result error-msg">{error}</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.import-wrapper {
		position: relative;
	}

	.import-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid #d1d5db;
		background: #fff;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		color: #374151;
		transition: all 0.15s ease;
	}

	.import-btn:hover {
		background: #f3f4f6;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 9;
	}

	.import-panel {
		position: absolute;
		right: 0;
		top: calc(100% + 0.5rem);
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem;
		min-width: 320px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		z-index: 10;
	}

	.import-panel h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.file-row {
		margin-bottom: 0.75rem;
	}

	.file-row input {
		font-size: 0.875rem;
	}

	.upload-btn {
		width: 100%;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		background: #1f2937;
		color: #fff;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
		transition: background 0.15s ease;
	}

	.upload-btn:hover:not(:disabled) {
		background: #374151;
	}

	.upload-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.result {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.875rem;
	}

	.result.success {
		background: #f0fdf4;
		color: #166534;
	}

	.result-errors {
		margin-top: 0.25rem;
		color: #dc2626;
	}

	.error-msg {
		background: #fef2f2;
		color: #dc2626;
	}
</style>
