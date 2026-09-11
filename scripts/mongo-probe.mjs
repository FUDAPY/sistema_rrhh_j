// scripts/mongo-probe.mjs
// Verifica conexion y lista bases/colecciones de MongoDB.

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('Falta la variable MONGODB_URI');
    process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

try {
    await client.connect();
    const admin = client.db().admin();
    const { databases } = await admin.listDatabases();

    console.log('Conexion OK');
    console.log('Databases: ' + databases.map((d) => d.name).join(', '));

    for (const dbInfo of databases) {
        if (['admin', 'local', 'config'].includes(dbInfo.name)) continue;
        const cols = await client.db(dbInfo.name).listCollections().toArray();
        console.log(`- ${dbInfo.name}: ${cols.length} colecciones -> ${cols.map((c) => c.name).join(', ') || '(vacia)'}`);
    }
} catch (error) {
    console.error('ERROR de conexion:', error.message);
    process.exitCode = 1;
} finally {
    await client.close();
}
