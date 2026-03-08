<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuth } from '$lib/auth.svelte';
	import { getToken } from '$lib/db';
	import {
		provisionSync,
		getSyncState,
		getSyncMode,
		backupNow,
		restoreBackup,
		getBackupInfo,
		type BackupInfo
	} from '$lib/sync.svelte';
	import { generateKey, exportKey, importKey } from '$lib/crypto';

	const auth = getAuth();

	let ouraConnected = $state(false);
	let provisioning = $state(false);
	let selectedMode = $state<'content' | 'encrypted-backup'>('encrypted-backup');

	// Encrypted backup state
	type BackupPhase = 'idle' | 'key-reveal' | 'ready' | 'key-entry';
	let backupPhase = $state<BackupPhase>('idle');
	let generatedKeyBase64 = $state('');
	let rememberKey = $state(false);
	let keyInput = $state('');
	let backupKey: CryptoKey | null = $state(null);
	let backupInfo = $state<BackupInfo | null>(null);
	let backupBusy = $state(false);
	let backupError = $state('');
	let keyCopied = $state(false);

	const STORAGE_KEY = 'cassiopeia-backup-key';

	onMount(async () => {
		const token = await getToken('oura');
		ouraConnected = !!token;

		// If encrypted-backup mode, check for stored key and load backup info
		if (getSyncMode() === 'encrypted-backup') {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				try {
					backupKey = await importKey(stored);
					backupPhase = 'ready';
				} catch {
					localStorage.removeItem(STORAGE_KEY);
					backupPhase = 'key-entry';
				}
			} else {
				backupPhase = 'key-entry';
			}
			backupInfo = await getBackupInfo();
		}
	});

	async function handleProvision() {
		provisioning = true;
		if (selectedMode === 'encrypted-backup') {
			const key = await generateKey();
			const ok = await provisionSync('encrypted-backup');
			if (ok) {
				generatedKeyBase64 = await exportKey(key);
				backupKey = key;
				backupPhase = 'key-reveal';
			}
		} else {
			await provisionSync('content');
		}
		provisioning = false;
	}

	async function confirmKeySaved() {
		if (rememberKey && backupKey) {
			localStorage.setItem(STORAGE_KEY, generatedKeyBase64);
		}
		backupPhase = 'ready';
		generatedKeyBase64 = '';
	}

	async function unlockWithKey() {
		backupError = '';
		try {
			backupKey = await importKey(keyInput.trim());
			if (rememberKey) {
				localStorage.setItem(STORAGE_KEY, keyInput.trim());
			}
			backupPhase = 'ready';
			keyInput = '';
		} catch {
			backupError = 'Ungültiger Schlüssel.';
		}
	}

	function forgetKey() {
		localStorage.removeItem(STORAGE_KEY);
		backupKey = null;
		backupPhase = 'key-entry';
	}

	async function handleBackup() {
		if (!backupKey) return;
		backupBusy = true;
		backupError = '';
		try {
			await backupNow(backupKey);
			backupInfo = await getBackupInfo();
		} catch (e) {
			backupError = e instanceof Error ? e.message : 'Backup fehlgeschlagen.';
		} finally {
			backupBusy = false;
		}
	}

	async function handleRestore() {
		if (!backupKey) return;
		backupBusy = true;
		backupError = '';
		try {
			await restoreBackup(backupKey);
			window.location.reload();
		} catch (e) {
			backupError = e instanceof Error ? e.message : 'Wiederherstellung fehlgeschlagen.';
			backupBusy = false;
		}
	}

	async function copyKey() {
		await navigator.clipboard.writeText(generatedKeyBase64);
		keyCopied = true;
		setTimeout(() => (keyCopied = false), 2000);
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div class="page">
	<div class="page-header">
		<h2>Konto</h2>
	</div>

	{#if auth.authenticated && auth.user}
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
					<span class="profile-name">{auth.user.name || 'User'}</span>
					{#if auth.user.email}
						<span class="profile-email">{auth.user.email}</span>
					{/if}
				</div>
			</div>
		</div>

		{@const syncMode = getSyncMode()}
		{@const syncState = getSyncState()}

		{#if syncMode === 'none' && syncState === 'disconnected'}
			<!-- Mode selector: not yet provisioned -->
			<div class="card">
				<h3>Cloud-Sync einrichten</h3>

				<label class="mode-option">
					<input type="radio" bind:group={selectedMode} value="content" />
					<div class="mode-label">
						<strong>Inhalte synchronisieren</strong>
						<span class="mode-desc">
							Daten werden mit dem Server synchronisiert. Mehrere Geräte möglich.
						</span>
						<span class="mode-warning">
							Der Betreiber kann deine Daten einsehen.
						</span>
					</div>
				</label>

				<label class="mode-option">
					<input type="radio" bind:group={selectedMode} value="encrypted-backup" />
					<div class="mode-label">
						<strong>Verschlüsseltes Backup</strong>
						<span class="mode-desc">
							Eine verschlüsselte Kopie wird auf dem Server gespeichert. Nur du kannst sie
							entschlüsseln.
						</span>
					</div>
				</label>

				<button class="action-btn" onclick={handleProvision} disabled={provisioning}>
					{provisioning ? 'Wird eingerichtet...' : 'Einrichten'}
				</button>
			</div>

		{:else if syncMode === 'encrypted-backup' && backupPhase === 'key-reveal'}
			<!-- Key reveal after setup -->
			<div class="card">
				<h3>Dein Entschlüsselungsschlüssel</h3>

				<div class="key-display">
					<code class="key-value">{generatedKeyBase64}</code>
					<button class="icon-btn" onclick={copyKey} title="Kopieren">
						{keyCopied ? 'Kopiert' : 'Kopieren'}
					</button>
				</div>

				<p class="card-warning">
					Speichere diesen Schlüssel in deinem Passwort-Manager. Er kann nicht
					wiederhergestellt werden!
				</p>

				<label class="checkbox-row">
					<input type="checkbox" bind:checked={rememberKey} />
					Schlüssel in diesem Browser merken
				</label>

				<button class="action-btn" onclick={confirmKeySaved}>
					Ich habe den Schlüssel gespeichert
				</button>
			</div>

		{:else if syncMode === 'encrypted-backup' && backupPhase === 'ready'}
			<!-- Ongoing: encrypted backup with key available -->
			<div class="card">
				<h3>Verschlüsseltes Backup</h3>
				{#if backupInfo && backupInfo.size > 0}
					<p class="card-desc">
						Letztes Backup: {backupInfo.updated_at} ({formatSize(backupInfo.size)})
					</p>
				{:else}
					<p class="card-desc">Noch kein Backup erstellt.</p>
				{/if}

				{#if backupError}
					<p class="card-error">{backupError}</p>
				{/if}

				<div class="btn-row">
					<button class="action-btn" onclick={handleBackup} disabled={backupBusy}>
						{backupBusy ? 'Läuft...' : 'Backup erstellen'}
					</button>
					{#if backupInfo && backupInfo.size > 0}
						<button class="action-btn secondary" onclick={handleRestore} disabled={backupBusy}>
							Wiederherstellen
						</button>
					{/if}
				</div>

				<p class="key-hint">
					Schlüssel wird in diesem Browser gespeichert ·
					<button class="link-btn" onclick={forgetKey}>Vergessen</button>
				</p>
			</div>

		{:else if syncMode === 'encrypted-backup' && backupPhase === 'key-entry'}
			<!-- Ongoing: encrypted backup, key NOT remembered -->
			<div class="card">
				<h3>Verschlüsseltes Backup</h3>
				{#if backupInfo && backupInfo.size > 0}
					<p class="card-desc">
						Letztes Backup: {backupInfo.updated_at} ({formatSize(backupInfo.size)})
					</p>
				{/if}

				<p class="card-desc">
					Schlüssel eingeben um Backup zu erstellen oder wiederherzustellen
				</p>

				{#if backupError}
					<p class="card-error">{backupError}</p>
				{/if}

				<input
					type="text"
					class="key-input"
					bind:value={keyInput}
					placeholder="Base64-Schlüssel einfügen"
				/>

				<label class="checkbox-row">
					<input type="checkbox" bind:checked={rememberKey} />
					Schlüssel in diesem Browser merken
				</label>

				<button class="action-btn" onclick={unlockWithKey} disabled={!keyInput.trim()}>
					Entsperren
				</button>
			</div>

		{:else if syncMode === 'content'}
			<!-- Ongoing: content sync -->
			<div class="card">
				<h3>Cloud-Sync</h3>
				<p class="card-desc">Daten werden automatisch synchronisiert.</p>
			</div>
		{/if}

		<a href="/api/auth/logout" class="logout-btn">Abmelden</a>
	{:else}
		<div class="card">
			<h3>Lokaler Modus</h3>
			<p class="card-desc">
				Deine Daten werden lokal in diesem Browser gespeichert. Melde dich an, um
				geraetuebergreifend zu synchronisieren.
			</p>
			{#if auth.oidc_enabled}
				<a href="/api/auth/login" class="action-btn">Anmelden fuer Sync &rarr;</a>
			{/if}
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
		margin: 0 0 0.5rem;
		font-size: 1rem;
		font-weight: 650;
		color: #111827;
	}

	.card-desc {
		margin: 0 0 1rem;
		font-size: 0.9rem;
		color: #6b7280;
		line-height: 1.5;
	}

	.card-warning {
		margin: 0 0 1rem;
		font-size: 0.825rem;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 0.65rem 0.85rem;
		line-height: 1.5;
	}

	.card-error {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		color: #dc2626;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
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

	.mode-option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		margin-bottom: 0.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.mode-option:has(input:checked) {
		border-color: #1f2937;
		background: #f9fafb;
	}

	.mode-option input[type='radio'] {
		margin-top: 0.2rem;
		flex-shrink: 0;
	}

	.mode-label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.mode-label strong {
		font-size: 0.9rem;
		color: #111827;
	}

	.mode-desc {
		font-size: 0.825rem;
		color: #6b7280;
		line-height: 1.4;
	}

	.mode-warning {
		font-size: 0.8rem;
		color: #92400e;
	}

	.key-display {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
	}

	.key-value {
		flex: 1;
		font-size: 0.85rem;
		word-break: break-all;
		color: #111827;
	}

	.icon-btn {
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		background: #e5e7eb;
		border: none;
		font-size: 0.8rem;
		cursor: pointer;
		flex-shrink: 0;
		color: #374151;
	}

	.icon-btn:hover {
		background: #d1d5db;
	}

	.key-input {
		width: 100%;
		padding: 0.55rem 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.875rem;
		margin-bottom: 0.75rem;
		font-family: monospace;
		box-sizing: border-box;
	}

	.key-input:focus {
		outline: none;
		border-color: #1f2937;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #6b7280;
		margin-bottom: 1rem;
		cursor: pointer;
	}

	.btn-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}

	.key-hint {
		font-size: 0.8rem;
		color: #9ca3af;
		margin: 0;
	}

	.link-btn {
		background: none;
		border: none;
		color: #6b7280;
		text-decoration: underline;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0;
	}

	.link-btn:hover {
		color: #374151;
	}

	.action-btn {
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
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.action-btn:hover:not(:disabled) {
		background: #374151;
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.action-btn.secondary {
		background: #fff;
		color: #1f2937;
		border: 1px solid #e5e7eb;
	}

	.action-btn.secondary:hover:not(:disabled) {
		background: #f9fafb;
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
		text-decoration: none;
	}

	.service-status.connected {
		background: #f0fdf4;
		color: #166534;
	}

	.service-status.pending {
		background: #f3f4f6;
		color: #9ca3af;
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
