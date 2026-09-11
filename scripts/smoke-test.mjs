// scripts/smoke-test.mjs
// Verifica health, login, datos y SSE contra el servidor local.

import 'dotenv/config';

const base = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const email = process.env.SMOKE_EMAIL || 'admin@lingroup.com.py';
const password = process.env.SMOKE_PASSWORD || process.env.MIGRATION_DEFAULT_PASSWORD || 'Cambiar1234';

const health = await fetch(`${base}/api/health`).then((r) => r.json());
console.log('health        :', health.ok ? 'OK' : 'FAIL');

const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
});
if (!loginRes.ok) {
    console.error('login         : FAIL', loginRes.status);
    process.exit(1);
}
const { token, user } = await loginRes.json();
console.log(`login         : OK (rol ${user.role})`);

const headers = { Authorization: `Bearer ${token}` };
const collections = ['employees', 'vales', 'salaries', 'users'];
for (const name of collections) {
    const res = await fetch(`${base}/api/data/${name}`, { headers });
    const { docs } = await res.json();
    const leaks = docs.some((doc) => 'passwordHash' in doc);
    console.log(`data ${name.padEnd(10)}: ${docs.length} docs${leaks ? '  <-- passwordHash EXPUESTO' : ''}`);
}

const controller = new AbortController();
const sse = await fetch(`${base}/api/realtime/employees?token=${token}`, { signal: controller.signal });
const reader = sse.body.getReader();
const { value } = await reader.read();
console.log('SSE realtime  :', new TextDecoder().decode(value).includes('event: snapshot') ? 'OK' : 'FAIL');
controller.abort();

// ---------------------------- RBAC ----------------------------
async function loginAs(mail, pass) {
    const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail, password: pass }),
    });
    return res.ok ? res.json() : null;
}

const anon = await fetch(`${base}/api/data/employees`);
console.log('RBAC anon GET employees       :', anon.status, anon.status === 200 ? 'OK' : 'FAIL');
const anonPatch = await fetch(`${base}/api/data/employees/x`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { fullName: 'x' } }),
});
console.log('RBAC anon PATCH employees     :', anonPatch.status, anonPatch.status === 401 ? 'OK' : 'FAIL');

const rrhh = await loginAs(
    process.env.SMOKE_RRHH_EMAIL || 'liz@lingroup.com',
    process.env.SMOKE_RRHH_PASSWORD || process.env.MIGRATION_DEFAULT_PASSWORD || 'Cambiar1234'
);
if (rrhh) {
    const h = { Authorization: `Bearer ${rrhh.token}`, 'Content-Type': 'application/json' };
    const read = await fetch(`${base}/api/data/employees`, { headers: h });
    console.log('RBAC RRHH GET employees       :', read.status, read.status === 200 ? 'OK' : 'FAIL');

    const editDenied = await fetch(`${base}/api/data/employees/x`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ data: { fullName: 'x' } }),
    });
    console.log(
        'RBAC RRHH editar ficha        :',
        editDenied.status,
        editDenied.status === 403 ? 'OK (bloqueado)' : 'FAIL'
    );

    const salaryPatch = await fetch(`${base}/api/data/salaries/x`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ data: { status: 'Pagado' } }),
    });
    console.log(
        'RBAC RRHH aprobar salario     :',
        salaryPatch.status,
        salaryPatch.status === 403 ? 'OK (bloqueado)' : 'FAIL'
    );

    // Dar de baja SI esta permitido (id inexistente => no modifica nada real)
    const deactivate = await fetch(`${base}/api/data/employees/__noexiste__`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ data: { status: 'INACTIVO', endDate: '2026-01-01' } }),
    });
    console.log(
        'RBAC RRHH dar de baja         :',
        deactivate.status,
        deactivate.status === 200 ? 'OK (permitido)' : 'FAIL'
    );

    const users = await fetch(`${base}/api/data/users`, { headers: h });
    console.log('RBAC RRHH ver usuarios        :', users.status, users.status === 403 ? 'OK (bloqueado)' : 'FAIL');
} else {
    console.log('RBAC RRHH                     : SKIP (sin credencial RRHH)');
}

console.log('Smoke test finalizado.');
