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
}

let state: AuthState = $state({ authenticated: false, user: null, loading: true });

export function getAuth() {
	return state;
}

export async function checkAuth() {
	try {
		const res = await fetch('/api/auth/me');
		const data = await res.json();
		state.authenticated = data.authenticated;
		state.user = data.user;
	} catch {
		state.authenticated = false;
		state.user = null;
	} finally {
		state.loading = false;
	}
}
