// scripts/firestore-inventory.mjs
// Lista colecciones y cantidades en Firestore.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath =
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    resolve(here, '..', 'sys-rrhh-lingroup-firebase-adminsdk-fbsvc-bb9b9b9823.json');

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const collections = await db.listCollections();
console.log(`Proyecto: ${serviceAccount.project_id}`);
console.log(`Colecciones encontradas: ${collections.length}`);

const report = [];
for (const col of collections) {
    let count = 0;
    try {
        const snap = await col.count().get();
        count = snap.data().count;
    } catch {
        const snap = await col.get();
        count = snap.size;
    }
    report.push({ collection: col.id, count });
    console.log(`- ${col.id}: ${count} documentos`);
}

writeFileSync(resolve(here, 'firestore-inventory.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('\nInventario guardado en scripts/firestore-inventory.json');
