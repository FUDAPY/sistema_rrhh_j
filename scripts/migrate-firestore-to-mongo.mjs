// scripts/migrate-firestore-to-mongo.mjs
// Migra Firestore -> MongoDB preservando IDs. Idempotente.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// -------------------- Config --------------------
const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT || 'sys-rrhh-lingroup-firebase-adminsdk-fbsvc-bb9b9b9823.json';
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'rrhh';
const defaultPassword = process.env.MIGRATION_DEFAULT_PASSWORD || 'Cambiar1234';

if (!uri) {
    console.error('Falta MONGODB_URI');
    process.exit(1);
}

// Colecciones de datos a migrar (las de negocio; "users" se trata aparte).
const DATA_COLLECTIONS = [
    'ausencias',
    'comisiones',
    'descuentos',
    'employees',
    'health',
    'salaries',
    'salaryCarryovers',
    'salaryHistory',
    'sucursales',
    'vales',
];

// -------------------- Firebase --------------------
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const firestore = getFirestore();

// -------------------- Conversion de valores --------------------
function toMongoValue(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(toMongoValue);
    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') return value.toDate(); // Timestamp-like
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            out[key] = toMongoValue(val);
        }
        return out;
    }
    return value;
}

function docToMongo(doc) {
    const data = toMongoValue(doc.data());
    return { _id: doc.id, ...data, _migratedFrom: 'firestore' };
}

// -------------------- Migracion --------------------
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const mongo = client.db(dbName);
console.log(`MongoDB -> ${dbName}`);

const summary = [];

for (const name of DATA_COLLECTIONS) {
    const snapshot = await firestore.collection(name).get();
    const collection = mongo.collection(name);
    let upserts = 0;

    for (const doc of snapshot.docs) {
        await collection.replaceOne({ _id: doc.id }, docToMongo(doc), { upsert: true });
        upserts += 1;
    }
    await collection.createIndex({ _migratedFrom: 1 });
    summary.push({ collection: name, documents: upserts });
    console.log(`  ${name}: ${upserts} documentos`);
}

// -------------------- Usuarios (Auth + roles) --------------------
const roleByEmail = new Map();
const usersSnap = await firestore.collection('users').get();
usersSnap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.email) {
        roleByEmail.set(String(data.email).toLowerCase(), { role: data.role || null, fullName: data.fullName || null });
    }
});

const listResult = await getAuth().listUsers(1000);
const usersCollection = mongo.collection('users');
let usersUpserted = 0;
const credentials = [];

for (const authUser of listResult.users) {
    const email = (authUser.email || '').toLowerCase();
    if (!email) continue;
    const local = roleByEmail.get(email);
    const role = local?.role || 'ADMIN';
    const fullName = local?.fullName || authUser.displayName || email.split('@')[0];
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    await usersCollection.replaceOne(
        { _id: authUser.uid },
        {
            _id: authUser.uid,
            uid: authUser.uid,
            email,
            fullName,
            role,
            passwordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
            _migratedFrom: 'firebase-auth',
        },
        { upsert: true }
    );
    credentials.push({ email, role, password: defaultPassword });
    usersUpserted += 1;
}

await usersCollection.createIndex({ email: 1 }, { unique: true });
summary.push({ collection: 'users', documents: usersUpserted });
console.log(`  users: ${usersUpserted} usuarios migrados`);

// -------------------- Resultado --------------------
console.log('\n=== Resumen de migracion ===');
for (const row of summary) {
    console.log(`  ${row.collection.padEnd(18)} ${row.documents}`);
}
if (credentials.length) {
    console.log('\nCredenciales creadas (cambiar tras el primer login):');
    for (const c of credentials) {
        console.log(`  ${c.email}  |  rol: ${c.role}  |  password temporal: ${c.password}`);
    }
}

await client.close();
console.log('\nMigracion finalizada.');
