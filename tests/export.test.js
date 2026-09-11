import { describe, it, expect } from 'vitest';
import { toCsv, downloadCsv, dateStamp, toDateString, exportButton } from '../public/js/export.js';

describe('export · CSV', () => {
    it('genera encabezado y filas con separador ";"', () => {
        const csv = toCsv(
            [
                { label: 'Nombre', value: (r) => r.name },
                { label: 'Monto', value: (r) => r.amount },
            ],
            [{ name: 'Ana', amount: 1000 }]
        );
        expect(csv).toBe('Nombre;Monto\r\nAna;1000');
    });

    it('escapa comillas, punto y coma y saltos de linea', () => {
        const csv = toCsv([{ label: 'Texto', value: 'x' }], [{ x: 'a;b' }, { x: 'con "comillas"' }]);
        expect(csv).toBe('Texto\r\n"a;b"\r\n"con ""comillas"""');
    });

    it('maneja valores nulos y listas vacias', () => {
        expect(
            toCsv(
                [
                    { label: 'A', value: 'a' },
                    { label: 'B', value: 'b' },
                ],
                [{ a: null }]
            )
        ).toBe('A;B\r\n;');
        expect(toCsv([{ label: 'X', value: 'x' }], [])).toBe('X\r\n');
    });

    it('downloadCsv arma el archivo y dispara la descarga', () => {
        const calls = [];
        const link = { click: () => calls.push('click'), remove: () => calls.push('remove') };
        globalThis.Blob = class {
            constructor(parts, options) {
                this.parts = parts;
                this.options = options;
            }
        };
        globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => calls.push('revoke') };
        globalThis.document = { body: { appendChild: () => calls.push('append') }, createElement: () => link };

        downloadCsv('reporte', [{ label: 'A', value: 'a' }], [{ a: 1 }]);

        expect(link.href).toBe('blob:test');
        expect(link.download).toBe('reporte.csv');
        expect(calls).toContain('append');
        expect(calls).toContain('click');
        expect(calls).toContain('remove');
    });

    it('dateStamp devuelve YYYY-MM-DD', () => {
        expect(dateStamp(new Date(2026, 8, 10))).toBe('2026-09-10');
    });

    it('toDateString normaliza Timestamp, Date, string y vacio', () => {
        expect(toDateString({ toDate: () => new Date(Date.UTC(2026, 0, 5)) })).toBe('2026-01-05');
        expect(toDateString(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
        expect(toDateString('2026-01-05T10:00:00Z')).toBe('2026-01-05');
        expect(toDateString(null)).toBe('');
    });

    it('exportButton genera el boton con el handler', () => {
        const html = exportButton('exportEmployeesCsv()');
        expect(html).toContain('exportEmployeesCsv()');
        expect(html).toContain('EXPORTAR CSV');
    });
});
