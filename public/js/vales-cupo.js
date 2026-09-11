// public/js/vales-cupo.js
// Regla de cupo de vales (40% del salario). Fuente unica para el panel y el portal publico.

export const VALE_LIMIT_RATE = 0.4; // 40% del salario vigente
export const VALE_MIN_AVAILABLE = 1000; // por debajo de esto, cupo agotado

export function getValeLimit(salary) {
    return (Number(salary) || 0) * VALE_LIMIT_RATE;
}

// Normaliza el estado (evita falsos negativos por mayusculas/espacios)
export function normalizeValeStatus(status) {
    return String(status || '')
        .trim()
        .toLowerCase();
}

export function resolveValeDate(vale) {
    if (!vale) return null;
    if (vale.createdAt && typeof vale.createdAt.toDate === 'function') return vale.createdAt.toDate();
    if (vale.createdAt instanceof Date) return vale.createdAt;
    if (vale.createdAtLocal) {
        const parsed = new Date(vale.createdAtLocal);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

// Vales del periodo en curso que consumen cupo (todo menos Rechazado/Anulado).
export function getValesConsumidos(vales = [], employeeId, referenceDate = new Date()) {
    const refMonth = referenceDate.getMonth();
    const refYear = referenceDate.getFullYear();

    return (vales || []).filter((vale) => {
        if (!vale || vale.employeeId !== employeeId) return false;
        if (vale.deleted) return false;

        const status = normalizeValeStatus(vale.status);
        if (status === 'rechazado' || status === 'anulado') return false;

        const date = resolveValeDate(vale);
        if (!date) return true; // sin fecha legible: se imputa al periodo en curso
        return date.getMonth() === refMonth && date.getFullYear() === refYear;
    });
}

export function getValeUsedAmount(vales = [], employeeId, referenceDate = new Date()) {
    return getValesConsumidos(vales, employeeId, referenceDate).reduce(
        (sum, vale) => sum + (Number(vale.approvedAmount) || Number(vale.amount) || 0),
        0
    );
}

export function getValeAvailable(salary, vales = [], employeeId, referenceDate = new Date()) {
    const limit = getValeLimit(salary);
    const used = getValeUsedAmount(vales, employeeId, referenceDate);
    return Math.max(0, limit - used);
}

export function isValeLimitExhausted(available) {
    return Number(available) <= VALE_MIN_AVAILABLE;
}

export function formatGs(value) {
    return new Intl.NumberFormat('es-PY').format(Number(value) || 0);
}
