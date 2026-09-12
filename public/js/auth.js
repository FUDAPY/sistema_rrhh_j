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
    programarRenovacion();
    return { user: currentUser };
}

export async function signOut() {
    currentUser = null;
    persist(null, null);
    detenerRenovacion();
    emit();
}

// Comprueba contra el servidor si la sesion guardada sigue siendo valida.
// Devuelve false solo cuando el servidor responde 401 (token vencido/invalido);
// ante un problema de red devuelve true para no cerrar la sesion por error.
export async function verificarSesion() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;

    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
        return response.ok;
    } catch {
        return true;
    }
}

// ---------------------------- Renovacion deslizante ----------------------------
// Mientras la sesion siga vigente se pide un token nuevo ANTES de que venza: asi el
// panel no se corta y los datos en vivo siguen actualizandose sin volver a loguear.

const MARGEN_RENOVACION_SEGUNDOS = 60 * 60; // renovar cuando falte 1 hora
const CHEQUEO_RENOVACION_MS = 10 * 60 * 1000; // chequeo periodico (pestañas en 2do plano)

let temporizadorRenovacion = null;
let intervaloRenovacion = null;
let alRenovarToken = null;

// El panel registra aca la funcion que vuelve a abrir sus streams en vivo.
export function onTokenRenovado(fn) {
    alRenovarToken = fn;
}

// Lee el 'exp' del JWT (en segundos). 0 = token sin vencimiento.
export function leerExpiracion(token) {
    try {
        const parte = String(token || '').split('.')[1];
        if (!parte) return 0;
        const base64 = parte
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(parte.length / 4) * 4, '=');
        const payload = JSON.parse(atob(base64));
        return Number(payload?.exp) || 0;
    } catch {
        return 0;
    }
}

function faltanSegundosDeSesion() {
    const expiracion = leerExpiracion(localStorage.getItem(TOKEN_KEY));
    if (!expiracion) return null; // sin vencimiento: no hay nada que renovar
    return expiracion - Math.floor(Date.now() / 1000);
}

// Pide un token nuevo. Devuelve false solo si el servidor rechazo la sesion.
export async function renovarSesion() {
    if (!currentUser) return false;

    try {
        const respuesta = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', headers: authHeaders() });
        if (!respuesta.ok) return false;

        const { token, user } = await respuesta.json();
        currentUser = mapUser(user);
        // No se emite a los listeners de auth: el usuario y su rol no cambiaron y no
        // queremos reinicializar el panel; solo se guarda el token nuevo.
        persist(token, currentUser);

        if (typeof alRenovarToken === 'function') alRenovarToken(token);
        programarRenovacion();
        return true;
    } catch {
        return true; // problema de red: se reintenta en el proximo ciclo
    }
}

export function renovarSiHaceFalta() {
    const faltan = faltanSegundosDeSesion();
    if (faltan === null || faltan <= 0 || faltan > MARGEN_RENOVACION_SEGUNDOS) return;
    renovarSesion();
}

// Programa la renovacion por temporizador, por intervalo y al volver a la pestaña
// (los temporizadores se congelan en pestañas en segundo plano).
export function programarRenovacion() {
    if (temporizadorRenovacion) clearTimeout(temporizadorRenovacion);
    temporizadorRenovacion = null;

    const faltan = faltanSegundosDeSesion();
    if (faltan === null) return;

    if (faltan > 0) {
        const margen = Math.min(MARGEN_RENOVACION_SEGUNDOS, Math.max(30, Math.floor(faltan / 2)));
        temporizadorRenovacion = setTimeout(renovarSiHaceFalta, Math.max(5, faltan - margen) * 1000);
    }

    if (!intervaloRenovacion) {
        intervaloRenovacion = setInterval(renovarSiHaceFalta, CHEQUEO_RENOVACION_MS);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) renovarSiHaceFalta();
        });
        window.addEventListener('focus', renovarSiHaceFalta);
    }
}

function detenerRenovacion() {
    if (temporizadorRenovacion) clearTimeout(temporizadorRenovacion);
    temporizadorRenovacion = null;
}

// Al abrir el panel con una sesion guardada, se programa la renovacion.
if (currentUser) programarRenovacion();

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
