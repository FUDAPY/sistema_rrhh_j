// server/auth.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from './db.js';

const SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto';
const EXPIRES = process.env.JWT_EXPIRES_IN || '12h';

export async function findUserByEmail(email) {
    return getDb()
        .collection('users')
        .findOne({ email: String(email || '').toLowerCase() });
}

export async function findUserById(id) {
    return getDb().collection('users').findOne({ _id: id });
}

export async function verifyCredentials(email, password) {
    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) return null;
    const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
    return ok ? user : null;
}

export function hashPassword(password) {
    return bcrypt.hash(String(password), 10);
}

export function signToken(user) {
    return jwt.sign({ sub: String(user._id), email: user.email, role: user.role }, SECRET, { expiresIn: EXPIRES });
}

export function publicUser(user) {
    return {
        id: String(user._id),
        uid: user.uid || String(user._id),
        email: user.email,
        fullName: user.fullName,
        role: user.role,
    };
}

export function authOptional() {
    return (req, _res, next) => {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : req.query?.token || null;
        if (token) {
            try {
                req.user = jwt.verify(token, SECRET);
            } catch {
                /* token invalido o expirado: se continua como anonimo */
            }
        }
        next();
    };
}

export function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    next();
}

export function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Requiere rol ADMIN' });
    next();
}
