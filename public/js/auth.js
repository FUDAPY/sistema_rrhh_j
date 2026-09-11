// public/js/auth.js
// Autenticacion (JWT propio) con la API de Firebase Auth sobre /api/auth.
import { setTokenProvider } from './db.js';

const API_BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'rrhh_token';
const USER_KEY = 'rrhh_user';

function readStoredUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

let currentUser = readStoredUser();
const listeners = new Set();

export const auth = {
    get currentUser() {
        return currentUser;
    },
};

setTokenProvider(() => localStorage.getItem(TOKEN_KEY));

function mapUser(user) {
    if (!user) return null;
    return {
        uid: user.uid || user.id,
        id: user.id,
        email: user.email,
        displayName: user.fullName || (user.email || '').split('@')[0],
        role: user.role,
        emailVerified: true,
    };
}

function persist(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
}

function emit() {
    for (const callback of listeners) {
        try {
            callback(currentUser);
        } catch (error) {
            console.error('Error en listener de auth:', error);
        }
    }
}

function authHeaders() {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

export function onAuthStateChanged(_auth, callback) {
    listeners.add(callback);
    setTimeout(() => callback(currentUser), 0);
    return () => listeners.delete(callback);
}

export async function signInWithEmailAndPassword(_auth, email, password) {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.error || 'No se pudo iniciar sesion');
        error.code = response.status === 401 ? 'auth/invalid-credential' : 'auth/error';
        throw error;
    }
    const { token, user } = await response.json();
    currentUser = mapUser(user);
    persist(token, currentUser);
    emit();
    return { user: currentUser };
}

export async function signOut() {
    currentUser = null;
    persist(null, null);
    emit();
}

// Alta de usuarios (requiere sesion ADMIN).
export async function createUser({ email, password, fullName, role }) {
    const response = await fetch(`${API_BASE}/api/auth/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email, password, fullName, role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo crear el usuario');
    return body;
}
