// scripts/biometric-ids.mjs
// Paso 1 del flujo de planilla: exporta el listado "ID del reloj <-> Funcionario"
// de la base, para cargar/estandarizar los IDs en los relojes biometricos.
//
// Uso:  npm run ids:biometric          (solo activos)
//       npm run ids:biometric -- todos (incluye inactivos)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { connectDb } from '../server/db.js';
import { normalizarCedula } from '../public/js/planilla.js';

const incluirInactivos = process.argv[2] === 'todos';

const db = await connectDb();
const documentos = await db.collection('employees').find({}).sort({ fullName: 1 }).toArray();

const filas = documentos
    .filter((empleado) => !empleado.deleted)
    .filter((empleado) => incluirInactivos || empleado.status !== 'INACTIVO')
    .map((empleado) => ({
        id: String(empleado._id),
        nombre: String(empleado.fullName || '').trim(),
        cedula: String(empleado.dni || empleado.ci || '').trim(),
        idSugerido: normalizarCedula(empleado.dni || empleado.ci || ''),
        sucursal: String(empleado.branch || '').trim(),
        cargo: String(empleado.position || '').trim(),
        estado: String(empleado.status || '').trim(),
    }));

// Colisiones: dos funcionarios no pueden compartir el ID del reloj.
const porIdSugerido = new Map();
for (const fila of filas) {
    if (!fila.idSugerido) continue;
    porIdSugerido.set(fila.idSugerido, (porIdSugerido.get(fila.idSugerido) || 0) + 1);
}
const colisiones = new Set([...porIdSugerido.entries()].filter(([, total]) => total > 1).map(([id]) => id));
const sinCedula = filas.filter((fila) => !fila.idSugerido);

const columnas = ['ID_RELOJ', 'NOMBRE', 'C_I', 'SUCURSAL', 'CARGO', 'ESTADO', 'OBSERVACION'];
const lineas = filas.map((fila) => {
    let observacion = '';
    if (!fila.idSugerido) observacion = 'SIN CEDULA VALIDA: asignar ID a mano';
    else if (colisiones.has(fila.idSugerido)) observacion = 'CEDULA DUPLICADA: revisar antes de cargar';
    return [fila.idSugerido || '', fila.nombre, fila.cedula, fila.sucursal, fila.cargo, fila.estado, observacion];
});

const csv = [columnas, ...lineas]
    .map((fila) => fila.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
const destino = path.resolve(process.cwd(), 'ids-reloj.csv');
fs.writeFileSync(destino, `\uFEFF${csv}`, 'utf8');

console.log(`Funcionarios exportados: ${filas.length}${incluirInactivos ? ' (incluye inactivos)' : ' (solo ACTIVOS)'}`);
console.log(`CSV: ${destino}\n`);
console.log('ID_RELOJ   | ESTADO   | FUNCIONARIO');
console.log('-'.repeat(78));
for (const fila of filas) {
    const aviso = !fila.idSugerido
        ? '  <-- SIN CEDULA'
        : colisiones.has(fila.idSugerido)
          ? '  <-- CEDULA DUPLICADA'
          : '';
    console.log(`${(fila.idSugerido || '(manual)').padEnd(10)} | ${fila.estado.padEnd(8)} | ${fila.nombre}${aviso}`);
}

if (sinCedula.length || colisiones.size) {
    console.log(
        `\nATENCION: ${sinCedula.length} funcionario(s) sin cedula valida y ${colisiones.size} cedula(s) duplicada(s).`
    );
}

process.exit(0);
