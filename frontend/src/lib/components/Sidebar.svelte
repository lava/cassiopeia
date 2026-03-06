<script lang="ts">
	import { page } from '$app/state';

	interface NavItem {
		href: string;
		label: string;
		icon: string;
	}

	const nav: NavItem[] = [
		{ href: '/dashboard', label: 'Dashboard', icon: 'chart' },
		{ href: '/dashboard/import', label: 'Import', icon: 'import' },
		{ href: '/dashboard/metrics', label: 'Metriken', icon: 'list' }
	];

	let mobileOpen = $state(false);

	function closeMobile() {
		mobileOpen = false;
	}
</script>

<!-- Mobile top bar -->
<div class="mobile-bar">
	<button class="hamburger" onclick={() => (mobileOpen = !mobileOpen)} aria-label="Menu">
		<span class="hamburger-line" class:open={mobileOpen}></span>
		<span class="hamburger-line" class:open={mobileOpen}></span>
		<span class="hamburger-line" class:open={mobileOpen}></span>
	</button>
	<a href="/" class="mobile-brand">Cassiopeia</a>
</div>

<!-- Sidebar -->
{#if mobileOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="mobile-backdrop" onclick={closeMobile} onkeydown={() => {}}></div>
{/if}

<aside class="sidebar" class:open={mobileOpen}>
	<a href="/" class="brand">
		<span class="brand-icon">✦</span>
		<span class="brand-text">Cassiopeia</span>
	</a>

	<nav>
		{#each nav as item}
			{@const active = page.url.pathname === item.href}
			<a
				href={item.href}
				class="nav-link"
				class:active
				onclick={closeMobile}
			>
				<svg class="nav-icon" viewBox="0 0 20 20" fill="currentColor">
					{#if item.icon === 'chart'}
						<path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm5 1V7h2v4H7zm4 0V5h2v6h-2z" />
					{:else if item.icon === 'import'}
						<path
							d="M10 2a1 1 0 011 1v6.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 9.586V3a1 1 0 011-1zM4 14a1 1 0 011 1v1h10v-1a1 1 0 112 0v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1z"
						/>
					{:else if item.icon === 'list'}
						<path
							d="M3 5h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2z"
						/>
					{/if}
				</svg>
				<span>{item.label}</span>
			</a>
		{/each}
	</nav>

	<div class="sidebar-footer">
		<a href="/" class="back-link">&larr; Startseite</a>
	</div>
</aside>

<style>
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 220px;
		background: #111827;
		display: flex;
		flex-direction: column;
		z-index: 50;
		transition: transform 0.25s ease;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 1.25rem 1.25rem 1.5rem;
		text-decoration: none;
		color: #fff;
	}

	.brand-icon {
		font-size: 1.2rem;
		opacity: 0.7;
	}

	.brand-text {
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0 0.75rem;
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		text-decoration: none;
		color: #9ca3af;
		font-size: 0.9rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.nav-link:hover {
		color: #e5e7eb;
		background: rgba(255, 255, 255, 0.06);
	}

	.nav-link.active {
		color: #fff;
		background: rgba(255, 255, 255, 0.1);
	}

	.nav-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.sidebar-footer {
		margin-top: auto;
		padding: 1.25rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.back-link {
		color: #6b7280;
		text-decoration: none;
		font-size: 0.825rem;
		transition: color 0.15s ease;
	}

	.back-link:hover {
		color: #9ca3af;
	}

	/* Mobile top bar */
	.mobile-bar {
		display: none;
	}

	.mobile-backdrop {
		display: none;
	}

	@media (max-width: 768px) {
		.sidebar {
			transform: translateX(-100%);
		}

		.sidebar.open {
			transform: translateX(0);
			box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
		}

		.mobile-bar {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			position: sticky;
			top: 0;
			z-index: 40;
			background: #fff;
			border-bottom: 1px solid #e5e7eb;
			padding: 0.75rem 1rem;
		}

		.mobile-brand {
			font-weight: 700;
			font-size: 1.05rem;
			color: #111827;
			text-decoration: none;
		}

		.hamburger {
			display: flex;
			flex-direction: column;
			gap: 4px;
			padding: 4px;
			background: none;
			border: none;
			cursor: pointer;
		}

		.hamburger-line {
			display: block;
			width: 20px;
			height: 2px;
			background: #374151;
			border-radius: 1px;
			transition: all 0.2s ease;
		}

		.hamburger-line.open:nth-child(1) {
			transform: rotate(45deg) translate(4px, 4px);
		}

		.hamburger-line.open:nth-child(2) {
			opacity: 0;
		}

		.hamburger-line.open:nth-child(3) {
			transform: rotate(-45deg) translate(4px, -4px);
		}

		.mobile-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.4);
			z-index: 45;
		}
	}
</style>
