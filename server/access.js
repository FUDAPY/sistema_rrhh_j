// server/access.js
// Matriz de permisos por rol (ADMIN total; RRHH con restricciones).

// Lectura publica (solicitud de vales sin login).
const PUBLIC_READ = new Set(['employees', 'vales']);
const PUBLIC_CREATE = new Set(['vales']);

// Colecciones que RRHH puede escribir y con que metodos.
const RRHH_WRITE = {
    employees: new Set(['POST', 'PATCH']),
    vales: new Set(['PATCH']),
    comisiones: new Set(['PATCH']),
    descuentos: new Set(['POST', 'PATCH', 'DELETE']),
    sucursales: new Set(['POST', 'PATCH', 'DELETE']),
    ausencias: new Set(['POST', 'PATCH', 'DELETE']),
    salaries: new Set(['POST']),
};

// En PATCH, RRHH solo puede cambiar estos campos.
const RRHH_PATCH_FIELDS = {
    // Dar de baja al funcionario (no editar sus datos).
    employees: new Set(['status', 'endDate']),
    // Marcar vales/comisiones como cobrados/pagados al liquidar.
    vales: new Set(['status']),
    comisiones: new Set(['status']),
};

// Campos que el servidor agrega y no deben bloquear la validacion.
const SERVER_FIELDS = new Set(['id', 'updatedAt', 'createdAt']);

export function evaluateAccess({ user, collection, method, payload }) {
    // 1) Acceso publico controlado
    if (method === 'GET' && PUBLIC_READ.has(collection)) return { allow: true };
    if (method === 'POST' && PUBLIC_CREATE.has(collection)) return { allow: true };

    // 2) Requiere sesion
    if (!user) return { allow: false, status: 401, reason: 'No autenticado' };

    // 3) La gestion de usuarios es EXCLUSIVA del rol ADMIN
    if (collection === 'users' && user.role !== 'ADMIN') {
        return { allow: false, status: 403, reason: 'Solo el ADMIN puede gestionar usuarios' };
    }
    if (collection === 'users' && method === 'POST') {
        return { allow: false, status: 400, reason: 'Use POST /api/auth/users para crear usuarios' };
    }

    // 4) ADMIN: acceso total
    if (user.role === 'ADMIN') return { allow: true };

    // 5) RRHH
    if (user.role === 'RRHH') {
        if (method === 'GET') return { allow: true };

        const allowedMethods = RRHH_WRITE[collection];
        if (!allowedMethods || !allowedMethods.has(method)) {
            return { allow: false, status: 403, reason: 'El rol RRHH no puede modificar este modulo' };
        }

        const allowedFields = RRHH_PATCH_FIELDS[collection];
        if (method === 'PATCH' && allowedFields) {
            const keys = Object.keys(payload || {}).filter((key) => !SERVER_FIELDS.has(key));
            const invalid = keys.filter((key) => !allowedFields.has(key));
            if (invalid.length) {
                return { allow: false, status: 403, reason: `RRHH solo puede modificar: ${[...allowedFields].join(', ')}` };
            }
        }

        return { allow: true };
    }

    return { allow: false, status: 403, reason: 'Rol no autorizado' };
}
