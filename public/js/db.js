// public/js/db.js
// Cliente de datos: replica la API modular de Firestore sobre REST + SSE.

const API_BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');

export const db = { __type: 'database' };

let tokenProvider = () => null;
export function setTokenProvider(fn) {
    tokenProvider = fn;
}

function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

// ---------------------------- Referencias ----------------------------
export function collection(_db, name) {
    return { __type: 'collection', name };
}

export function doc(_db, name, id) {
    return { __type: 'doc', name, id };
}

export function where(field, op, value) {
    return { __type: 'where', field, op, value };
}

export function orderBy(field, dir = 'asc') {
    return { __type: 'orderBy', field, dir };
}

export function limit(n) {
    return { __type: 'limit', n };
}

export function query(ref, ...constraints) {
    const base = { name: ref.name, where: [], orderBy: [], limit: undefined };
    for (const constraint of constraints) {
        if (!constraint) continue;
        if (constraint.__type === 'where')
            base.where.push({ field: constraint.field, op: constraint.op, value: constraint.value });
        else if (constraint.__type === 'orderBy') base.orderBy.push({ field: constraint.field, dir: constraint.dir });
        else if (constraint.__type === 'limit') base.limit = constraint.n;
    }
    return { __type: 'query', ...base };
}

// ---------------------------- Valores ----------------------------
export function serverTimestamp() {
    return { __serverTimestamp: true };
}

function encodeValue(value) {
    if (value instanceof Date) return { __ts: value.getTime() };
    if (Array.isArray(value)) return value.map(encodeValue);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) out[key] = encodeValue(val);
        return out;
    }
    return value;
}

function hydrateValue(value) {
    if (Array.isArray(value)) return value.map(hydrateValue);
    if (value && typeof value === 'object') {
        if (typeof value.__ts === 'number') {
            const date = new Date(value.__ts);
            return {
                toDate: () => date,
                toMillis: () => date.getTime(),
                seconds: Math.floor(value.__ts / 1000),
                nanoseconds: (value.__ts % 1000) * 1e6,
                valueOf: () => date.getTime(),
                toString: () => date.toISOString(),
            };
        }
        const out = {};
        for (const [key, val] of Object.entries(value)) out[key] = hydrateValue(val);
        return out;
    }
    return value;
}

function hydrateDoc(payload) {
    const out = {};
    for (const [key, val] of Object.entries(payload)) out[key] = hydrateValue(val);
    return out;
}

function omitId(payload) {
    const clone = { ...payload };
    delete clone.id;
    return clone;
}

// ---------------------------- Consultas ----------------------------
function normalizeRef(ref) {
    if (!ref) return { name: '', where: [], orderBy: [] };
    if (ref.__type === 'collection') return { name: ref.name, where: [], orderBy: [] };
    if (ref.__type === 'query') return { name: ref.name, where: ref.where, orderBy: ref.orderBy, limit: ref.limit };
    return { name: ref.name, where: [], orderBy: [] };
}

function toQueryString(q) {
    const params = new URLSearchParams();
    for (const item of q.where || []) params.append('where', `${item.field}:${item.op}:${JSON.stringify(item.value)}`);
    for (const item of q.orderBy || []) params.append('orderBy', `${item.field}:${item.dir}`);
    if (q.limit) params.set('limit', String(q.limit));
    const text = params.toString();
    return text ? `?${text}` : '';
}

function buildSnapshot(docs) {
    return {
        docs: docs.map((item) => ({ id: item.id, data: () => hydrateDoc(omitId(item)) })),
        size: docs.length,
        empty: docs.length === 0,
        forEach(callback) {
            this.docs.forEach((item) => callback(item));
        },
    };
}

async function parseResponse(response, collectionName) {
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.error || `Error ${response.status} en ${collectionName}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

export async function getDocs(ref) {
    const q = normalizeRef(ref);
    const response = await fetch(`${API_BASE}/api/data/${q.name}${toQueryString(q)}`, { headers: authHeaders() });
    const { docs } = await parseResponse(response, q.name);
    return buildSnapshot(docs);
}

export async function getDoc(ref) {
    const response = await fetch(`${API_BASE}/api/data/${ref.name}/${ref.id}`, { headers: authHeaders() });
    const { doc: found } = await parseResponse(response, ref.name);
    return {
        id: found?.id,
        exists: () => Boolean(found),
        data: () => (found ? hydrateDoc(omitId(found)) : undefined),
    };
}

export async function addDoc(ref, data) {
    const response = await fetch(`${API_BASE}/api/data/${ref.name}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ data: encodeValue(data || {}) }),
    });
    const body = await parseResponse(response, ref.name);
    return { id: body.id };
}

export async function setDoc(ref, data) {
    const response = await fetch(`${API_BASE}/api/data/${ref.name}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ data: { ...encodeValue(data || {}), id: ref.id } }),
    });
    const body = await parseResponse(response, ref.name);
    return { id: body.id };
}

export async function updateDoc(ref, data) {
    const response = await fetch(`${API_BASE}/api/data/${ref.name}/${ref.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ data: encodeValue(data || {}) }),
    });
    await parseResponse(response, ref.name);
    return { id: ref.id };
}

export async function deleteDoc(ref) {
    const response = await fetch(`${API_BASE}/api/data/${ref.name}/${ref.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    await parseResponse(response, ref.name);
    return { id: ref.id };
}

// ---------------------------- Tiempo real (SSE) ----------------------------
export function onSnapshot(ref, onNext, onError) {
    const q = normalizeRef(ref);
    const token = tokenProvider();
    const params = new URLSearchParams();
    for (const item of q.where || []) params.append('where', `${item.field}:${item.op}:${JSON.stringify(item.value)}`);
    for (const item of q.orderBy || []) params.append('orderBy', `${item.field}:${item.dir}`);
    if (q.limit) params.set('limit', String(q.limit));
    if (token) params.set('token', token);

    const queryString = params.toString();
    const source = new EventSource(`${API_BASE}/api/realtime/${q.name}${queryString ? `?${queryString}` : ''}`);

    source.addEventListener('snapshot', (event) => {
        try {
            const { docs } = JSON.parse(event.data);
            onNext(buildSnapshot(docs));
        } catch (error) {
            console.error(`Error procesando snapshot de ${q.name}:`, error);
        }
    });

    source.onerror = (event) => {
        if (onError) onError(event);
    };

    return () => source.close();
}
