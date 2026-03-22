<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { getAuth, checkAuth } from '$lib/auth.svelte';
	import { initDB } from '$lib/db';
	import { initSync } from '$lib/sync.svelte';

	let { children }: { children: Snippet } = $props();
	const auth = getAuth();
	let dbReady = $state(false);
	let dbError = $state<string | null>(null);

	let showSidebar = $derived(page.url.pathname !== '/');

	onMount(async () => {
		try {
			await initDB();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('Access Handle') || msg.includes('createSyncAccessHandle')) {
				dbError = 'Die Datenbank ist bereits in einem anderen Tab geöffnet. Bitte schließe den anderen Tab und lade diese Seite neu.';
			} else {
				dbError = `Datenbank-Fehler: ${msg}`;
			}
			return;
		}
		dbReady = true;
		checkAuth().then(() => {
			if (auth.authenticated) {
				initSync();
			}
		});
	});
</script>

{#if dbError}
	<div class="loading-screen">
		<div class="error-message">{dbError}</div>
	</div>
{:else if !dbReady}
	<div class="loading-screen">
		<span class="loading-star">✦</span>
	</div>
{:else if showSidebar}
	<div class="app-shell">
		<Sidebar user={auth.user} />
		<main class="main-content">
			{@render children()}
		</main>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		color: #9ca3af;
	}

	.loading-star {
		font-size: 2rem;
		opacity: 0.3;
		animation: pulse 1.5s ease-in-out infinite;
	}

	.error-message {
		max-width: 400px;
		padding: 1.5rem;
		text-align: center;
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		font-size: 0.95rem;
		line-height: 1.5;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 0.5;
		}
	}

	.app-shell {
		min-height: 100dvh;
	}

	.main-content {
		margin-left: 220px;
		min-height: 100dvh;
		background: #f8f9fb;
	}

	@media (max-width: 768px) {
		.main-content {
			margin-left: 0;
		}
	}
</style>
