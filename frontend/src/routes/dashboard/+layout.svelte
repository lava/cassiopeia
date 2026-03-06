<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="app-shell">
	<Sidebar />
	<main class="main-content">
		{@render children()}
	</main>
</div>

<style>
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
