// server/realtime.js
// Tiempo real por SSE (un canal por coleccion).
import { listDocuments } from './store.js';

const subscribers = new Map(); // collection -> Set<subscriber>

export function addSubscriber(collection, subscriber) {
    if (!subscribers.has(collection)) subscribers.set(collection, new Set());
    subscribers.get(collection).add(subscriber);
}

export function removeSubscriber(collection, subscriber) {
    const set = subscribers.get(collection);
    if (!set) return;
    set.delete(subscriber);
    if (set.size === 0) subscribers.delete(collection);
}

export async function pushSnapshot(collection, subscriber) {
    const raw = await listDocuments(collection, subscriber.options);
    const docs = subscriber.transform ? subscriber.transform(raw) : raw;
    subscriber.res.write(`event: snapshot\ndata: ${JSON.stringify({ docs })}\n\n`);
}

export async function broadcast(collection) {
    const set = subscribers.get(collection);
    if (!set) return;
    for (const subscriber of set) {
        try {
            await pushSnapshot(collection, subscriber);
        } catch {
            removeSubscriber(collection, subscriber);
        }
    }
}
