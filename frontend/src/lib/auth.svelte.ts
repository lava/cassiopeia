export interface User {
	sub: string;
	email: string;
	name: string;
	picture: string;
}

interface AuthState {
	authenticated: boolean;
	user: User | null;
	loading: boolean;
	oidc_enabled: boolean;
}

let state: AuthState = $state({ authenticated: false, user: null, loading: true, oidc_enabled: false });

export function getAuth() {
	return state;
}

export async function checkAuth() {
	try {
		const [meRes, configRes] = await Promise.all([
			fetch('/api/auth/me'),
			fetch('/api/auth/config'),
		]);
		const meData = await meRes.json();
		const configData = await configRes.json();
		state.authenticated = meData.authenticated;
		state.user = meData.user;
		state.oidc_enabled = configData.oidc_enabled;
	} catch {
		state.authenticated = false;
		state.user = null;
	} finally {
		state.loading = false;
	}
}
