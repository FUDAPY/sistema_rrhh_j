// scripts/create-user.mjs
// Crea/actualiza un usuario en MongoDB (bcrypt). Uso: <email> <password> [ADMIN|RRHH] [Nombre]

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { MongoClient, ObjectId } from 'mongodb';

const [emailArg, password, roleArg = 'ADMIN', ...nameParts] = process.argv.slice(2);

if (!emailArg || !password) {
    console.error('Uso: node scripts/create-user.mjs <email> <password> [ADMIN|RRHH] [Nombre]');
    process.exit(1);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'rrhh';
if (!uri) {
    console.error('Falta MONGODB_URI');
    process.exit(1);
}

const email = emailArg.toLowerCase();
const role = roleArg.toUpperCase() === 'RRHH' ? 'RRHH' : 'ADMIN';
const fullName = nameParts.join(' ') || email.split('@')[0];

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const users = client.db(dbName).collection('users');

const passwordHash = await bcrypt.hash(password, 10);
const existing = await users.findOne({ email });

if (existing) {
    await users.updateOne({ _id: existing._id }, { $set: { passwordHash, role, fullName, updatedAt: new Date() } });
    console.log(`Usuario actualizado: ${email} (rol ${role})`);
} else {
    const id = new ObjectId().toHexString();
    await users.insertOne({
        _id: id,
        uid: id,
        email,
        fullName,
        role,
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    console.log(`Usuario creado: ${email} (rol ${role})`);
}

await client.close();
