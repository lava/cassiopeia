<script lang="ts">
	import { getAuth } from '$lib/auth.svelte';

	const auth = getAuth();
</script>

<div class="landing">
	<div class="hero">
		<span class="star">✦</span>
		<h1>Cassiopeia</h1>
		<p class="subtitle">
			Gesundheitsdaten an einem Ort. Schlaf, Stimmung, Schritte, Energie &mdash;
			alles auf einer Zeitachse, damit Pacing einfacher wird.
		</p>
		{#if auth.authenticated}
			<a href="/dashboard" class="cta">Zum Dashboard &rarr;</a>
		{:else}
			<a href="/api/auth/login" class="cta">Anmelden &rarr;</a>
		{/if}
	</div>
</div>

<style>
	.landing {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.hero {
		text-align: center;
		padding: 6rem 2rem 3rem;
		max-width: 520px;
	}

	.star {
		display: block;
		font-size: 2rem;
		margin-bottom: 1rem;
		opacity: 0.4;
	}

	.hero h1 {
		margin: 0 0 0.75rem;
		font-size: clamp(2.2rem, 5vw, 3rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		color: #111827;
	}

	.subtitle {
		font-size: 1.05rem;
		color: #4b5563;
		line-height: 1.65;
		margin: 0 0 2rem;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.7rem 1.5rem;
		border-radius: 10px;
		background: #1f2937;
		color: #fff;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.95rem;
		transition: all 0.2s ease;
	}

	.cta:hover {
		background: #374151;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
	}

	@media (max-width: 600px) {
		.hero {
			padding: 4rem 1.5rem 2rem;
		}
	}
</style>
