// server/values.js
// Conversion entre BSON (Date) y el JSON del cliente ({ __ts }).

export function encodeValue(value) {
    if (value instanceof Date) return { __ts: value.getTime() };
    if (Array.isArray(value)) return value.map(encodeValue);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) out[key] = encodeValue(val);
        return out;
    }
    return value;
}

export function decodeValue(value) {
    if (Array.isArray(value)) return value.map(decodeValue);
    if (value && typeof value === 'object') {
        if (value.__serverTimestamp) return new Date();
        if (typeof value.__ts === 'number') return new Date(value.__ts);
        const out = {};
        for (const [key, val] of Object.entries(value)) out[key] = decodeValue(val);
        return out;
    }
    return value;
}

// Convierte un documento de Mongo al formato que espera el cliente.
const SECRET_FIELDS = new Set(['passwordHash']);

export function encodeDoc(doc) {
    if (!doc) return doc;
    const out = { id: String(doc._id) };
    for (const [key, val] of Object.entries(doc)) {
        if (key === '_id' || key.startsWith('_') || SECRET_FIELDS.has(key)) continue;
        out[key] = encodeValue(val);
    }
    return out;
}

export function encodeDocs(docs) {
    return docs.map(encodeDoc);
}
