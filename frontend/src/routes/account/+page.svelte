<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuth } from '$lib/auth.svelte';

	const auth = getAuth();

	let ouraConnected = $state(false);

	onMount(async () => {
		try {
			const resp = await fetch('/api/import/oura/token');
			if (resp.ok) {
				const data = await resp.json();
				ouraConnected = data.configured;
			}
		} catch {
			// ignore
		}
	});
</script>

<div class="page">
	<div class="page-header">
		<h2>Konto</h2>
	</div>

	{#if auth.user}
		{#if auth.user.is_anonymous}
			<div class="card anon-card">
				<p class="anon-text">
					Du verwendest ein anonymes Konto. Erstelle ein permanentes Konto,
					um deine Daten zu sichern.
				</p>
				<a href="/api/auth/login" class="link-btn">Konto erstellen &rarr;</a>
			</div>
		{/if}

		<div class="card profile-card">
			<div class="profile-row">
				{#if auth.user.picture}
					<img src={auth.user.picture} alt="" class="profile-avatar" />
				{:else}
					<span class="profile-avatar-placeholder">
						{auth.user.name?.charAt(0)?.toUpperCase() || '?'}
					</span>
				{/if}
				<div class="profile-info">
					<span class="profile-name">{auth.user.name || 'Anonym'}</span>
					{#if auth.user.email}
						<span class="profile-email">{auth.user.email}</span>
					{:else}
						<span class="profile-email anon-label">Anonymes Konto</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="card">
			<h3>Verbundene Dienste</h3>
			<div class="service-row">
				<span class="service-name">Bearable</span>
				<span class="service-status connected">CSV-Import</span>
			</div>
			<div class="service-row">
				<span class="service-name">Oura</span>
				{#if ouraConnected}
					<span class="service-status connected">Verbunden</span>
				{:else}
					<a href="/dashboard/import" class="service-status pending">Nicht verbunden</a>
				{/if}
			</div>
			<div class="service-row">
				<span class="service-name">Garmin</span>
				<span class="service-status connected">CSV-Import</span>
			</div>
		</div>

		<a href="/api/auth/logout" class="logout-btn">Abmelden</a>
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem 2rem;
		max-width: 520px;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h2 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 700;
		color: #111827;
	}

	.card {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.card h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		font-weight: 650;
		color: #111827;
	}

	.profile-card {
		padding: 1.5rem;
	}

	.profile-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.profile-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
	}

	.profile-avatar-placeholder {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: #e5e7eb;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.2rem;
		font-weight: 700;
		color: #6b7280;
		flex-shrink: 0;
	}

	.profile-info {
		display: flex;
		flex-direction: column;
	}

	.profile-name {
		font-weight: 600;
		font-size: 1.05rem;
		color: #111827;
	}

	.profile-email {
		font-size: 0.875rem;
		color: #6b7280;
	}

	.service-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.6rem 0;
	}

	.service-row:not(:last-child) {
		border-bottom: 1px solid #f3f4f6;
	}

	.service-name {
		font-weight: 500;
		font-size: 0.9rem;
		color: #374151;
	}

	.service-status {
		font-size: 0.8rem;
		padding: 0.15rem 0.6rem;
		border-radius: 99px;
		font-weight: 500;
	}

	.service-status.connected {
		background: #f0fdf4;
		color: #166534;
	}

	.service-status.pending {
		background: #f3f4f6;
		color: #9ca3af;
	}

	.anon-card {
		background: #fffbeb;
		border-color: #fde68a;
	}

	.anon-text {
		margin: 0 0 1rem;
		font-size: 0.9rem;
		color: #92400e;
		line-height: 1.5;
	}

	.anon-label {
		color: #d97706;
	}

	.link-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.55rem 1.1rem;
		border-radius: 8px;
		background: #1f2937;
		color: #fff;
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 600;
		transition: all 0.15s ease;
	}

	.link-btn:hover {
		background: #374151;
	}

	.logout-btn {
		display: inline-block;
		padding: 0.6rem 1.25rem;
		border-radius: 8px;
		background: #fff;
		border: 1px solid #e5e7eb;
		color: #dc2626;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.logout-btn:hover {
		background: #fef2f2;
		border-color: #fecaca;
	}

	@media (max-width: 768px) {
		.page {
			padding: 1rem 1.25rem;
		}
	}
</style>
