import { describe, it, expect } from 'vitest';
import { encodeValue, decodeValue, encodeDoc, encodeDocs } from '../server/values.js';

describe('values · serializacion BSON <-> cliente', () => {
    it('codifica Date como { __ts }', () => {
        expect(encodeValue(new Date(1700000000000))).toEqual({ __ts: 1700000000000 });
    });

    it('decodifica { __ts } como Date', () => {
        expect(decodeValue({ __ts: 1700000000000 })).toEqual(new Date(1700000000000));
    });

    it('decodifica { __serverTimestamp } como Date actual', () => {
        const before = Date.now();
        const result = decodeValue({ __serverTimestamp: true });
        expect(result instanceof Date).toBe(true);
        expect(result.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('anida objetos y arrays', () => {
        expect(encodeValue({ a: [new Date(1000)], b: { c: new Date(2000) } })).toEqual({
            a: [{ __ts: 1000 }],
            b: { c: { __ts: 2000 } },
        });
        expect(decodeValue({ a: [{ __ts: 1000 }] })).toEqual({ a: [new Date(1000)] });
    });

    it('deja pasar escalares y nulos', () => {
        expect(encodeValue('x')).toBe('x');
        expect(decodeValue(null)).toBe(null);
        expect(encodeValue(5)).toBe(5);
    });

    it('encodeDoc expone id y oculta _id, campos privados y passwordHash', () => {
        const doc = {
            _id: 'abc',
            fullName: 'Ana',
            passwordHash: 'hash',
            _migratedFrom: 'x',
            createdAt: new Date(1000),
        };
        const out = encodeDoc(doc);
        expect(out.id).toBe('abc');
        expect(out.fullName).toBe('Ana');
        expect('passwordHash' in out).toBe(false);
        expect('_migratedFrom' in out).toBe(false);
        expect(out.createdAt).toEqual({ __ts: 1000 });
    });

    it('encodeDoc devuelve null si no hay documento', () => {
        expect(encodeDoc(null)).toBe(null);
    });

    it('encodeDocs mapea un array de documentos', () => {
        expect(encodeDocs([{ _id: '1', a: 1 }])).toEqual([{ id: '1', a: 1 }]);
    });
});
