import { describe, it, expect } from 'vitest';
import {
    VALE_LIMIT_RATE,
    getValeLimit,
    getValeUsedAmount,
    getValeAvailable,
    isValeLimitExhausted,
    normalizeValeStatus,
    formatGs,
} from '../public/js/vales-cupo.js';

// Referencia fija: septiembre 2026
const REFERENCE = new Date(2026, 8, 10);

describe('vales-cupo · regla del 40%', () => {
    it('calcula el limite como 40% del salario', () => {
        expect(VALE_LIMIT_RATE).toBe(0.4);
        expect(getValeLimit(3000000)).toBe(1200000);
        expect(getValeLimit(0)).toBe(0);
        expect(getValeLimit(undefined)).toBe(0);
        expect(getValeLimit('2500000')).toBe(1000000);
    });

    it('normaliza estados con mayusculas o espacios', () => {
        expect(normalizeValeStatus('  Rechazado ')).toBe('rechazado');
        expect(normalizeValeStatus(null)).toBe('');
    });

    it('suma vales del mes que consumen cupo (incluye Pendiente)', () => {
        const vales = [
            {
                employeeId: 'e1',
                amount: 100000,
                approvedAmount: 120000,
                status: 'Aprobado',
                createdAt: new Date(2026, 8, 2),
            },
            { employeeId: 'e1', amount: 50000, status: 'Pendiente', createdAt: new Date(2026, 8, 5) },
            { employeeId: 'e1', amount: 999999, status: 'Rechazado', createdAt: new Date(2026, 8, 6) },
            { employeeId: 'e1', amount: 999999, status: 'Anulado', createdAt: new Date(2026, 8, 7) },
            { employeeId: 'e1', amount: 777777, status: 'Aprobado', createdAt: new Date(2026, 7, 20) }, // mes anterior
            { employeeId: 'e2', amount: 888888, status: 'Aprobado', createdAt: new Date(2026, 8, 8) }, // otro empleado
        ];
        expect(getValeUsedAmount(vales, 'e1', REFERENCE)).toBe(120000 + 50000);
    });

    it('ignora Rechazado/Anulado, otros periodos y soft-deleted', () => {
        const vales = [
            { employeeId: 'e1', amount: 100000, status: 'Rechazado', createdAt: new Date(2026, 8, 2) },
            { employeeId: 'e1', amount: 100000, status: 'Anulado', createdAt: new Date(2026, 8, 3) },
            { employeeId: 'e1', amount: 100000, status: 'Aprobado', createdAt: new Date(2026, 6, 3) },
            { employeeId: 'e1', amount: 500000, status: 'Aprobado', deleted: true, createdAt: new Date(2026, 8, 4) },
        ];
        expect(getValeUsedAmount(vales, 'e1', REFERENCE)).toBe(0);
    });

    it('calcula el disponible y detecta cupo agotado', () => {
        const vales = [{ employeeId: 'e1', amount: 1199000, status: 'Aprobado', createdAt: new Date(2026, 8, 4) }];
        const available = getValeAvailable(3000000, vales, 'e1', REFERENCE);
        expect(available).toBe(1000);
        expect(isValeLimitExhausted(available)).toBe(true);
    });

    it('sin vales el disponible es el limite completo', () => {
        expect(getValeAvailable(3000000, [], 'e1', REFERENCE)).toBe(1200000);
        expect(isValeLimitExhausted(getValeAvailable(3000000, [], 'e1', REFERENCE))).toBe(false);
    });

    it('nunca devuelve disponible negativo', () => {
        const vales = [{ employeeId: 'e1', amount: 5000000, status: 'Aprobado', createdAt: new Date(2026, 8, 4) }];
        expect(getValeAvailable(3000000, vales, 'e1', REFERENCE)).toBe(0);
    });

    it('formatGs aplica separador de miles', () => {
        expect(formatGs(1200000)).toBe('1.200.000');
        expect(formatGs(0)).toBe('0');
        expect(formatGs(null)).toBe('0');
    });

    it('usa createdAtLocal cuando no hay Timestamp', () => {
        const vales = [
            {
                employeeId: 'e1',
                amount: 100000,
                status: 'Aprobado',
                createdAtLocal: new Date(2026, 8, 3).toISOString(),
            },
        ];
        expect(getValeUsedAmount(vales, 'e1', REFERENCE)).toBe(100000);
    });

    it('acepta createdAt como Date nativo', () => {
        const vales = [{ employeeId: 'e1', amount: 200000, status: 'Aprobado', createdAt: new Date(2026, 8, 2) }];
        expect(getValeUsedAmount(vales, 'e1', REFERENCE)).toBe(200000);
    });

    it('imputa al periodo en curso los vales sin fecha legible', () => {
        const vales = [{ employeeId: 'e1', amount: 50000, status: 'Aprobado' }];
        expect(getValeUsedAmount(vales, 'e1', REFERENCE)).toBe(50000);
    });
});
