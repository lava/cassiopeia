// AES-256-GCM encryption via Web Crypto API
// IV: 12 random bytes, prepended to ciphertext

export async function generateKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt'
	]);
}

export async function exportKey(key: CryptoKey): Promise<string> {
	const raw = await crypto.subtle.exportKey('raw', key);
	return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importKey(base64: string): Promise<CryptoKey> {
	const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt'
	]);
}

export async function encrypt(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	const result = new Uint8Array(iv.byteLength + ciphertext.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(ciphertext), iv.byteLength);
	return result.buffer;
}

export async function decrypt(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
	const bytes = new Uint8Array(data);
	const iv = bytes.slice(0, 12);
	const ciphertext = bytes.slice(12);
	return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}
