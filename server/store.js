// server/store.js
// Acceso generico a colecciones de MongoDB (CRUD + consultas).
import { ObjectId } from 'mongodb';
import { getDb } from './db.js';
import { decodeValue, encodeDoc } from './values.js';

const OPERATORS = {
    '==': (v) => v,
    '!=': (v) => ({ $ne: v }),
    '<': (v) => ({ $lt: v }),
    '<=': (v) => ({ $lte: v }),
    '>': (v) => ({ $gt: v }),
    '>=': (v) => ({ $gte: v }),
    in: (v) => ({ $in: Array.isArray(v) ? v : [v] }),
    'not-in': (v) => ({ $nin: Array.isArray(v) ? v : [v] }),
    'array-contains': (v) => v,
};

export function buildFilter(where = []) {
    const filter = {};
    for (const condition of where) {
        if (!condition || !condition.field) continue;
        const op = OPERATORS[condition.op] || OPERATORS['=='];
        const value = decodeValue(condition.value);
        filter[condition.field] = op(value);
    }
    return filter;
}

export function buildSort(orderBy = []) {
    const sort = {};
    for (const item of orderBy) {
        if (!item || !item.field) continue;
        sort[item.field] = item.dir === 'desc' ? -1 : 1;
    }
    return sort;
}

export async function listDocuments(collectionName, { where = [], orderBy = [], limit } = {}) {
    let cursor = getDb().collection(collectionName).find(buildFilter(where));
    const sort = buildSort(orderBy);
    if (Object.keys(sort).length) cursor = cursor.sort(sort);
    if (Number.isFinite(limit) && limit > 0) cursor = cursor.limit(limit);
    const docs = await cursor.toArray();
    return docs.map(encodeDoc);
}

export async function getDocument(collectionName, id) {
    const doc = await getDb().collection(collectionName).findOne({ _id: id });
    return doc ? encodeDoc(doc) : null;
}

export async function createDocumentWithId(collectionName, id, data) {
    const now = new Date();
    const doc = { ...data, _id: id, updatedAt: now };
    if (doc.createdAt === undefined) doc.createdAt = now;
    await getDb().collection(collectionName).replaceOne({ _id: id }, doc, { upsert: true });
    return { _id: id };
}

export async function updateDocument(collectionName, id, data) {
    const patch = { ...data, updatedAt: new Date() };
    delete patch.id;
    delete patch._id;
    await getDb().collection(collectionName).updateOne({ _id: id }, { $set: patch });
    return { _id: id };
}

export async function deleteDocument(collectionName, id) {
    await getDb().collection(collectionName).deleteOne({ _id: id });
    return { _id: id };
}

export function newId() {
    return new ObjectId().toHexString();
}
