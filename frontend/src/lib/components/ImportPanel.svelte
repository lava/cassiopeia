<script lang="ts">
	import type { ImportResult } from '$lib/types';

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
		<div class="import-panel">
			<h3>Bearable CSV Import</h3>
			<div class="file-row">
				<input type="file" accept=".csv" onchange={handleFileChange} />
				<button onclick={upload} disabled={!file || uploading}>
					{uploading ? 'Uploading...' : 'Upload'}
				</button>
			</div>

			{#if result}
				<div class="result">
					<p>Imported: {result.imported}, Skipped: {result.skipped}</p>
					{#if result.errors.length > 0}
						<p class="errors">Errors: {result.errors.join(', ')}</p>
					{/if}
				</div>
			{/if}

			{#if error}
				<p class="errors">{error}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.import-wrapper {
		position: relative;
	}

	.import-btn {
		padding: 6px 16px;
		border-radius: 6px;
		border: 1px solid #ccc;
		background: #fff;
		cursor: pointer;
		font-size: 0.9rem;
	}

	.import-panel {
		position: absolute;
		right: 0;
		top: 100%;
		margin-top: 4px;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 16px;
		min-width: 320px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 10;
	}

	.import-panel h3 {
		margin: 0 0 12px;
		font-size: 1rem;
	}

	.file-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.file-row button {
		padding: 4px 12px;
		border-radius: 4px;
		border: 1px solid #ccc;
		background: #f5f5f5;
		cursor: pointer;
	}

	.file-row button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.result {
		margin-top: 12px;
		font-size: 0.9rem;
	}

	.errors {
		color: #c00;
	}
</style>
