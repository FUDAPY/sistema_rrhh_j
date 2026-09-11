import { describe, it, expect } from 'vitest';
import { evaluateAccess } from '../server/access.js';

const ADMIN = { role: 'ADMIN' };
const RRHH = { role: 'RRHH' };

describe('access · matriz de permisos por rol', () => {
    it('permite lectura publica de employees y vales', () => {
        expect(evaluateAccess({ user: null, collection: 'employees', method: 'GET', payload: {} }).allow).toBe(true);
        expect(evaluateAccess({ user: null, collection: 'vales', method: 'GET', payload: {} }).allow).toBe(true);
    });

    it('permite crear vales sin sesion', () => {
        expect(evaluateAccess({ user: null, collection: 'vales', method: 'POST', payload: {} }).allow).toBe(true);
    });

    it('rechaza escrituras sin sesion (401)', () => {
        const result = evaluateAccess({ user: null, collection: 'employees', method: 'PATCH', payload: {} });
        expect(result.allow).toBe(false);
        expect(result.status).toBe(401);
    });

    it('ADMIN tiene acceso total', () => {
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
            expect(evaluateAccess({ user: ADMIN, collection: 'salaries', method, payload: {} }).allow).toBe(true);
        }
    });

    it('ADMIN no crea usuarios por la API generica (400)', () => {
        const result = evaluateAccess({ user: ADMIN, collection: 'users', method: 'POST', payload: {} });
        expect(result.allow).toBe(false);
        expect(result.status).toBe(400);
    });

    it('RRHH no accede a usuarios (403)', () => {
        expect(evaluateAccess({ user: RRHH, collection: 'users', method: 'GET', payload: {} }).status).toBe(403);
    });

    it('RRHH solo puede dar de baja en employees', () => {
        const ok = evaluateAccess({
            user: RRHH,
            collection: 'employees',
            method: 'PATCH',
            payload: { status: 'INACTIVO', endDate: '2026-01-01' },
        });
        expect(ok.allow).toBe(true);

        const denied = evaluateAccess({
            user: RRHH,
            collection: 'employees',
            method: 'PATCH',
            payload: { fullName: 'X' },
        });
        expect(denied.allow).toBe(false);
        expect(denied.status).toBe(403);
    });

    it('RRHH puede crear funcionarios pero no eliminarlos', () => {
        expect(evaluateAccess({ user: RRHH, collection: 'employees', method: 'POST', payload: {} }).allow).toBe(true);
        expect(evaluateAccess({ user: RRHH, collection: 'employees', method: 'DELETE', payload: {} }).allow).toBe(
            false
        );
    });

    it('RRHH solo cambia status en vales y comisiones', () => {
        expect(
            evaluateAccess({ user: RRHH, collection: 'vales', method: 'PATCH', payload: { status: 'Cobrado' } }).allow
        ).toBe(true);
        expect(evaluateAccess({ user: RRHH, collection: 'vales', method: 'PATCH', payload: { amount: 1 } }).allow).toBe(
            false
        );
        expect(
            evaluateAccess({ user: RRHH, collection: 'comisiones', method: 'PATCH', payload: { status: 'Pagado' } })
                .allow
        ).toBe(true);
    });

    it('RRHH crea pagos pero no los modifica', () => {
        expect(
            evaluateAccess({ user: RRHH, collection: 'salaries', method: 'POST', payload: { netPay: 1 } }).allow
        ).toBe(true);
        expect(evaluateAccess({ user: RRHH, collection: 'salaries', method: 'PATCH', payload: {} }).allow).toBe(false);
    });

    it('RRHH no toca salaryHistory, proveedores ni evaluaciones', () => {
        for (const collection of ['salaryHistory', 'proveedores', 'evaluaciones']) {
            expect(evaluateAccess({ user: RRHH, collection, method: 'POST', payload: {} }).allow).toBe(false);
        }
    });

    it('ignora campos del servidor al validar PATCH de RRHH', () => {
        const result = evaluateAccess({
            user: RRHH,
            collection: 'employees',
            method: 'PATCH',
            payload: { status: 'INACTIVO', updatedAt: 'x', id: 'y', createdAt: 'z' },
        });
        expect(result.allow).toBe(true);
    });

    it('un rol desconocido queda denegado', () => {
        expect(
            evaluateAccess({ user: { role: 'OTRO' }, collection: 'employees', method: 'POST', payload: {} }).allow
        ).toBe(false);
    });
});
