// server/index.js
// API Express: auth, datos, SSE y estaticos.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectDb } from './db.js';
import { listDocuments, createDocumentWithId, updateDocument, deleteDocument, newId } from './store.js';
import {
    verifyCredentials,
    signToken,
    publicUser,
    findUserById,
    hashPassword,
    authOptional,
    requireAuth,
    requireAdmin,
} from './auth.js';
import { addSubscriber, removeSubscriber, pushSnapshot, broadcast } from './realtime.js';
import { decodeValue } from './values.js';
import { evaluateAccess } from './access.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Detras de Caddy/Traefik (Dokploy) el TLS lo termina el proxy: confiar en
// X-Forwarded-Proto/Host para saber si la peticion original fue HTTPS.
app.set('trust proxy', true);

// FORCE_HTTPS=false desactiva la redireccion (util mientras el dominio todavia
// no sirva un certificado valido, para no enviar a los usuarios a un error TLS).
const FORCE_HTTPS = process.env.FORCE_HTTPS !== 'false';
// HSTS: activar SOLO cuando Let's Encrypt ya emita el certificado del dominio.
// Una vez publicado, el navegador deja de permitir la excepcion de certificado.
const HSTS_ENABLED = process.env.HSTS_ENABLED === 'true';
const HSTS_MAX_AGE = process.env.HSTS_MAX_AGE || '15552000';

app.use((req, res, next) => {
    const forwardedProto = req.get('x-forwarded-proto');
    const isHttps = req.secure || forwardedProto === 'https';

    if (isHttps) {
        if (HSTS_ENABLED) res.set('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}; includeSubDomains`);
    } else if (FORCE_HTTPS && forwardedProto === 'http' && req.path !== '/api/health') {
        return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    }

    next();
});

// Cabeceras de seguridad basicas.
app.use((_req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'X-DNS-Prefetch-Control': 'off',
    });
    next();
});

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(authOptional());

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function parseQuery(req) {
    const where = [];
    const orderBy = [];

    for (const item of [].concat(req.query.where || [])) {
        const parts = String(item).split(':');
        const field = parts.shift();
        const op = parts.shift();
        where.push({ field, op, value: safeJson(parts.join(':')) });
    }
    for (const item of [].concat(req.query.orderBy || [])) {
        const [field, dir] = String(item).split(':');
        orderBy.push({ field, dir: dir === 'desc' ? 'desc' : 'asc' });
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    return { where, orderBy, limit };
}

function guard(req, res, next) {
    const decision = evaluateAccess({
        user: req.user,
        collection: req.params.collection,
        method: req.method,
        payload: req.body?.data ?? req.body ?? {},
    });
    if (!decision.allow) return res.status(decision.status || 403).json({ error: decision.reason });
    next();
}

// ---------------------------- Auth ----------------------------
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    const user = await verifyCredentials(email, password);
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
    res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    const user = await findUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user: publicUser(user) });
});

// Renovacion deslizante: mientras la sesion siga siendo valida se entrega un token
// nuevo, de modo que el panel no se corte en medio de la jornada.
app.post('/api/auth/refresh', requireAuth, async (req, res) => {
    const user = await findUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/users', requireAdmin, async (req, res) => {
    const { email, password, fullName, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contrasena son obligatorios' });
    const normalized = String(email).toLowerCase();

    const existing = await listDocuments('users', { where: [{ field: 'email', op: '==', value: normalized }] });
    if (existing.length) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });

    const id = newId();
    await createDocumentWithId('users', id, {
        uid: id,
        email: normalized,
        fullName: fullName || normalized.split('@')[0],
        role: role || 'RRHH',
        passwordHash: await hashPassword(password),
        createdAt: new Date(),
    });
    await broadcast('users');
    res.status(201).json({ id });
});

app.post('/api/auth/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Falta la contrasena' });
    await updateDocument('users', req.params.id, { passwordHash: await hashPassword(password) });
    res.json({ ok: true });
});

// ---------------------------- Usuarios (solo ADMIN) ----------------------------
app.get('/api/data/users', requireAdmin, async (req, res) => {
    const docs = await listDocuments('users', parseQuery(req));
    res.json({ docs });
});

app.patch('/api/data/users/:id', requireAdmin, async (req, res) => {
    const payload = decodeValue(req.body?.data ?? req.body ?? {});
    await updateDocument('users', req.params.id, payload);
    await broadcast('users');
    res.json({ id: req.params.id });
});

app.delete('/api/data/users/:id', requireAdmin, async (req, res) => {
    await deleteDocument('users', req.params.id);
    await broadcast('users');
    res.json({ id: req.params.id });
});

// ---------------------------- Datos ----------------------------
app.get('/api/data/:collection', guard, async (req, res) => {
    const docs = await listDocuments(req.params.collection, parseQuery(req));
    res.json({ docs });
});

app.get('/api/data/:collection/:id', guard, async (req, res) => {
    const docs = await listDocuments(req.params.collection, {
        where: [{ field: '_id', op: '==', value: req.params.id }],
        limit: 1,
    });
    res.json({ doc: docs[0] || null });
});

app.post('/api/data/:collection', guard, async (req, res) => {
    const payload = decodeValue(req.body?.data ?? req.body ?? {});
    const id = payload.id || newId();
    await createDocumentWithId(req.params.collection, id, payload);
    await broadcast(req.params.collection);
    res.status(201).json({ id });
});

app.patch('/api/data/:collection/:id', guard, async (req, res) => {
    const payload = decodeValue(req.body?.data ?? req.body ?? {});
    await updateDocument(req.params.collection, req.params.id, payload);
    await broadcast(req.params.collection);
    res.json({ id: req.params.id });
});

app.delete('/api/data/:collection/:id', guard, async (req, res) => {
    await deleteDocument(req.params.collection, req.params.id);
    await broadcast(req.params.collection);
    res.json({ id: req.params.id });
});

// ---------------------------- Realtime (SSE) ----------------------------
app.get('/api/realtime/:collection', guard, async (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const subscriber = { res, options: parseQuery(req) };
    addSubscriber(req.params.collection, subscriber);
    await pushSnapshot(req.params.collection, subscriber);

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
        clearInterval(keepAlive);
        removeSubscriber(req.params.collection, subscriber);
    });
});

// ---------------------------- Health ----------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'rrhh-api' }));

// ---------------------------- Estaticos ----------------------------
const distDir = path.resolve(here, '..', 'dist');
app.use(express.static(distDir));
app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
    res.status(404).sendFile(path.join(distDir, '404.html'));
});

// ---------------------------- Errores ----------------------------
app.use((error, _req, res, _next) => {
    console.error('Error API:', error);
    res.status(500).json({ error: error.message || 'Error interno' });
});

// ---------------------------- Arranque ----------------------------
const port = process.env.PORT || 3000;

connectDb()
    .then(() => {
        app.listen(port, () => console.log(`Sistema RRHH API escuchando en http://0.0.0.0:${port}`));
    })
    .catch((error) => {
        console.error('No se pudo iniciar (MongoDB):', error.message);
        process.exit(1);
    });
