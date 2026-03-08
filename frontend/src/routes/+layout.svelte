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

	let showSidebar = $derived(page.url.pathname !== '/');

	onMount(async () => {
		await initDB();
		dbReady = true;
		checkAuth().then(() => {
			if (auth.authenticated) {
				initSync();
			}
		});
	});
</script>

{#if !dbReady}
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
