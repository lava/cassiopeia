<script lang="ts">
	import { getSyncState, getLastSync, syncNow } from '$lib/sync.svelte';
	import { getAuth } from '$lib/auth.svelte';

	const auth = getAuth();

	function formatLastSync(iso: string | null): string {
		if (!iso) return '';
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Gerade eben';
		if (mins < 60) return `Vor ${mins} Min.`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `Vor ${hours} Std.`;
		return `Vor ${Math.floor(hours / 24)} Tagen`;
	}

	let syncing = $state(false);

	async function handleSync() {
		syncing = true;
		await syncNow();
		syncing = false;
	}
</script>

{#if auth.authenticated}
	{@const state = getSyncState()}
	{@const lastSync = getLastSync()}
	<div class="sync-status">
		<div class="sync-indicator" class:connected={state === 'idle' || state === 'syncing'} class:offline={state === 'offline'}>
			{#if state === 'syncing' || syncing}
				<span class="sync-dot pulsing"></span>
				<span class="sync-text">Synchronisiere...</span>
			{:else if state === 'offline'}
				<span class="sync-dot offline"></span>
				<span class="sync-text">Offline</span>
			{:else if state === 'idle'}
				<span class="sync-dot connected"></span>
				<span class="sync-text">{formatLastSync(lastSync) || 'Verbunden'}</span>
			{:else}
				<span class="sync-dot"></span>
				<span class="sync-text">Nicht verbunden</span>
			{/if}
		</div>
		{#if state === 'idle' && !syncing}
			<button class="sync-btn" onclick={handleSync} title="Jetzt synchronisieren">
				<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
					<path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 0 1-.908-.418A6 6 0 0 1 14 8a.5.5 0 0 1-1 0 5 5 0 0 0-5-5z"/>
					<path d="M8 13a5 5 0 0 0 4.546-2.914.5.5 0 0 1 .908.418A6 6 0 0 1 2 8a.5.5 0 0 1 1 0 5 5 0 0 0 5 5z"/>
				</svg>
			</button>
		{/if}
	</div>
{/if}

<style>
	.sync-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
	}

	.sync-indicator {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
	}

	.sync-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #6b7280;
		flex-shrink: 0;
	}

	.sync-dot.connected {
		background: #22c55e;
	}

	.sync-dot.offline {
		background: #f59e0b;
	}

	.sync-dot.pulsing {
		background: #3b82f6;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}

	.sync-text {
		font-size: 0.75rem;
		color: #9ca3af;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sync-btn {
		background: none;
		border: none;
		color: #6b7280;
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		transition: color 0.15s;
	}

	.sync-btn:hover {
		color: #d1d5db;
	}
</style>
