<script lang="ts">
</script>

<div class="landing">
	<div class="hero">
		<span class="star">✦</span>
		<h1>Cassiopeia</h1>
		<p class="subtitle">
			Gesundheitsdaten an einem Ort. Schlaf, Stimmung, Schritte, Energie &mdash;
			alles auf einer Zeitachse, damit Pacing einfacher wird.
		</p>
		<a href="/dashboard" class="cta">Öffnen &rarr;</a>
	</div>

	<div class="info-cards">
		<div class="info-card">
			<h3>📊 Trendansicht</h3>
			<p>Alle Metriken normalisiert auf 0–100%, übereinander auf einem Chart. Muster erkennen statt raten.</p>
		</div>
		<div class="info-card">
			<h3>📥 Daten rein</h3>
			<p>Bearable-CSV hochladen. Oura und Garmin kommen noch dazu.</p>
		</div>
		<div class="info-card">
			<h3>⚡ Für Pacing</h3>
			<p>Gebaut um zu sehen wie Aktivität, Schlaf und Symptome zusammenhängen.</p>
		</div>
	</div>

	<footer>
		<p>Cassiopeia &mdash; ein kleines Projekt für Freunde &amp; Familie</p>
	</footer>
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

	.info-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem;
		padding: 0 2rem 3rem;
		max-width: 720px;
		width: 100%;
	}

	.info-card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem;
	}

	.info-card h3 {
		margin: 0 0 0.35rem;
		font-size: 0.95rem;
		font-weight: 650;
		color: #111827;
	}

	.info-card p {
		margin: 0;
		font-size: 0.875rem;
		color: #6b7280;
		line-height: 1.5;
	}

	footer {
		margin-top: auto;
		padding: 2rem;
		text-align: center;
		color: #9ca3af;
		font-size: 0.825rem;
		border-top: 1px solid #f3f4f6;
		width: 100%;
	}

	footer p {
		margin: 0;
	}

	@media (max-width: 600px) {
		.hero {
			padding: 4rem 1.5rem 2rem;
		}

		.info-cards {
			padding: 0 1.5rem 2rem;
		}
	}
</style>
