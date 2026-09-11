// server/db.js
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'rrhh';

let client = null;
let database = null;

export async function connectDb() {
    if (database) return database;
    if (!uri) throw new Error('Falta MONGODB_URI en el entorno');
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    database = client.db(dbName);
    await database.command({ ping: 1 });
    return database;
}

export function getDb() {
    if (!database) throw new Error('MongoDB no inicializado');
    return database;
}

export async function closeDb() {
    if (client) {
        await client.close();
        client = null;
        database = null;
    }
}
