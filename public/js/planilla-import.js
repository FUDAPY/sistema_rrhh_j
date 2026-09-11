// public/js/planilla-import.js
// Importador de la planilla de asistencia de los relojes biometricos.
//   Paso 1: leer el Excel y mostrar el listado ID del reloj <-> Funcionario.
//   Paso 2: aplicar las reglas de tardanzas/ausencias y emitir un reporte A4
//           imprimible o exportable a PDF, con opcion de guardar los descuentos.
import { addDoc, collection, serverTimestamp } from './db.js';
import { db } from './firebase-config.js';
import * as Export from './export.js';
import logoUrl from '../logo.png';
import {
    REGLAS_PLANILLA,
    construirIndiceEmpleados,
    detectarColumnas,
    diasEsperados,
    evaluarAsistencia,
    formatearGs,
    minutosATexto,
    parseCsv,
    parseFecha,
    parseHora,
    parsearBloquesAsistencia,
    razonDescuento,
    resolverFuncionario,
    resumenDescuento,
} from './planilla.js';

const COMPANY = {
    name: 'LIN GROUP',
    address: 'Av. Camilo Recalde c/ Av. Capitan Miranda',
    city: 'Microcentro de Ciudad del Este',
};

const DIAS_SEMANA = [
    { valor: 1, etiqueta: 'Lun' },
    { valor: 2, etiqueta: 'Mar' },
    { valor: 3, etiqueta: 'Mie' },
    { valor: 4, etiqueta: 'Jue' },
    { valor: 5, etiqueta: 'Vie' },
    { valor: 6, etiqueta: 'Sab' },
    { valor: 0, etiqueta: 'Dom' },
];

const CAMPOS = [
    { clave: 'biometricId', etiqueta: 'ID del reloj' },
    { clave: 'nombre', etiqueta: 'Nombre' },
    { clave: 'fecha', etiqueta: 'Fecha' },
    { clave: 'entrada', etiqueta: 'Entrada' },
    { clave: 'salida', etiqueta: 'Salida' },
];

const estado = {
    empleados: [],
    descuentos: [],
    sucursales: [],
    toastCb: null,
    usuario: null,
    obtenerDescuentos: null,
    nombreArchivo: '',
    filas: [],
    encabezados: [],
    columnas: { fecha: null, entrada: null, salida: null, nombre: null, biometricId: null },
    excluidos: new Set(),
    importados: new Set(),
    guardando: false,
    bloque: null,
    resultado: null,
};

// Los descuentos se leen por funcion para no quedarse con una copia vieja del
// arreglo que el panel reasigna en cada evento de tiempo real.
function descuentosActuales() {
    if (typeof estado.obtenerDescuentos === 'function') return estado.obtenerDescuentos() || [];
    return estado.descuentos || [];
}

const escapar = (valor) =>
    String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const pad2 = (valor) => String(valor).padStart(2, '0');
const avisar = (titulo, mensaje) => estado.toastCb?.(titulo, mensaje);

function valorCelda(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return valor;
    if (typeof valor === 'object') {
        if (Array.isArray(valor.richText)) return valor.richText.map((parte) => parte.text).join('');
        if (valor.text !== undefined) return valor.text;
        if (valor.result !== undefined) return valor.result;
        return String(valor);
    }
    return valor;
}

// Normaliza el nombre de sucursal para cruzarlo con el horario cargado.
const claveSucursal = (valor) =>
    String(valor ?? '')
        .trim()
        .toUpperCase();

// Hora de entrada esperada por funcionario segun el horario de su sucursal.
function horasDeSucursales() {
    const horarios = new Map();
    for (const sucursal of estado.sucursales) {
        const minutos = parseHora(sucursal.entrada);
        if (minutos !== null) horarios.set(claveSucursal(sucursal.name), minutos);
    }

    const porFuncionario = new Map();
    for (const empleado of estado.empleados) {
        const minutos = horarios.get(claveSucursal(empleado.branch));
        if (minutos !== undefined) porFuncionario.set(empleado.id, minutos);
    }
    return porFuncionario;
}

function crearModal() {
    const contenedor = document.createElement('div');
    contenedor.id = 'planillaModal';
    contenedor.className = 'hidden fixed inset-0 z-[120] bg-slate-900/70 backdrop-blur-sm overflow-y-auto';
    contenedor.innerHTML = `
        <div class="min-h-full flex items-start justify-center p-4">
            <div class="w-full max-w-6xl bg-white rounded-[32px] shadow-2xl my-6 overflow-hidden">
                <div class="flex items-center justify-between gap-4 p-6 bg-gradient-to-r from-indigo-600 to-blue-600">
                    <div class="flex items-center gap-3 text-white">
                        <i class="ph-bold ph-file-xls text-2xl"></i>
                        <div>
                            <h3 class="font-black text-lg leading-none">Importar Planilla de Asistencia</h3>
                            <p class="text-[11px] font-bold uppercase tracking-widest opacity-80">Relojes biometricos · tardanzas y ausencias</p>
                        </div>
                    </div>
                    <button type="button" onclick="cerrarImportadorPlanilla()" class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center" title="Cerrar">
                        <i class="ph-bold ph-x"></i>
                    </button>
                </div>
                <div id="planillaBody" class="p-6 space-y-6"></div>
            </div>
        </div>`;
    document.body.appendChild(contenedor);
    return contenedor;
}

export function abrirImportadorPlanilla({
    empleados = [],
    descuentos = [],
    sucursales = [],
    toastCb,
    usuario,
    obtenerDescuentos,
} = {}) {
    estado.empleados = empleados;
    estado.descuentos = descuentos;
    estado.sucursales = sucursales;
    estado.toastCb = toastCb;
    estado.usuario = usuario || null;
    estado.obtenerDescuentos = obtenerDescuentos || null;
    estado.nombreArchivo = '';
    estado.filas = [];
    estado.encabezados = [];
    estado.excluidos = new Set();
    estado.importados = new Set();
    estado.guardando = false;
    estado.bloque = null;
    estado.resultado = null;
    estado.columnas = { fecha: null, entrada: null, salida: null, nombre: null, biometricId: null };

    const modal = document.getElementById('planillaModal') || crearModal();
    modal.classList.remove('hidden');
    window.cerrarImportadorPlanilla = () => modal.classList.add('hidden');
    renderPaso1();
}

function renderPaso1() {
    const cuerpo = document.getElementById('planillaBody');
    const hoy = new Date();
    const periodo = `${hoy.getFullYear()}-${pad2(hoy.getMonth() + 1)}`;

    cuerpo.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-2 p-6 rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/40">
                <h4 class="font-black text-slate-700 flex items-center gap-2"><i class="ph-bold ph-upload-simple text-indigo-500"></i> 1. Archivo de asistencia</h4>
                <p class="text-[11px] font-bold text-slate-500 mt-1">Excel del reloj (.xlsx) o texto (.csv/.txt). Se espera una fila por marcacion con columnas de ID, nombre, fecha y hora.</p>
                <input type="file" id="planillaArchivo" accept=".xlsx,.xlsm,.csv,.txt" class="mt-4 block w-full text-sm font-bold text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-indigo-600 file:px-5 file:py-3 file:font-black file:text-white hover:file:bg-indigo-700">
                <p id="planillaArchivoInfo" class="text-[11px] font-black text-indigo-600 mt-3"></p>
            </div>

            <div class="p-6 rounded-3xl border border-slate-200 bg-slate-50/60 space-y-4">
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Periodo evaluado</label>
                    <input type="month" id="planillaPeriodo" value="${periodo}" class="w-full border-2 border-slate-100 p-3 rounded-2xl bg-white font-bold text-slate-700 mt-1">
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Hora de entrada (general)</label>
                    <input type="time" id="planillaHoraEntrada" value="${REGLAS_PLANILLA.horaEntradaDefecto}" class="w-full border-2 border-slate-100 p-3 rounded-2xl bg-white font-bold text-slate-700 mt-1">
                    <p class="text-[10px] font-bold text-slate-400 mt-1 px-1">Si la sucursal tiene horario cargado, se usa ese.</p>
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Dias laborables</label>
                    <div class="flex flex-wrap gap-1 mt-2">
                        ${DIAS_SEMANA.map(
                            (dia) =>
                                `<label class="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-black text-slate-600 cursor-pointer"><input type="checkbox" class="planillaDia mr-1" value="${dia.valor}" checked>${dia.etiqueta}</label>`
                        ).join('')}
                    </div>
                </div>
            </div>
        </div>

        <div class="p-5 rounded-3xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-800 leading-relaxed">
            <p class="font-black uppercase tracking-wider mb-1">Reglas aplicadas</p>
            <p>· 29 minutos de gracia · desde 30 min: ${formatearGs(REGLAS_PLANILLA.montoPorBloque)} por cada ${REGLAS_PLANILLA.bloqueMinutos} min de retraso · mas de 2 h: 1 dia completo (salario / ${REGLAS_PLANILLA.diasBaseMes}) · sin marcacion: 1 dia completo.</p>
        </div>

        <div id="planillaMapeo"></div>`;

    document.getElementById('planillaArchivo').addEventListener('change', alElegirArchivo);
}

async function alElegirArchivo(evento) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;

    const info = document.getElementById('planillaArchivoInfo');
    const mapeo = document.getElementById('planillaMapeo');
    info.textContent = `Leyendo ${archivo.name}...`;
    mapeo.innerHTML = '';

    try {
        const filas = await leerArchivo(archivo);
        if (filas.length === 0) throw new Error('El archivo no tiene filas con datos.');

        estado.filas = filas;
        estado.nombreArchivo = archivo.name;
        estado.bloque = parsearBloquesAsistencia(filas);

        // El reporte del reloj (matriz por bloques) trae ID y marcaciones alineadas
        // a los dias: no hace falta mapear columnas.
        if (estado.bloque) {
            aplicarPeriodoDetectado(estado.bloque.periodo);
            info.innerHTML = `<i class="ph-bold ph-check-circle"></i> ${escapar(archivo.name)}: reporte del reloj con ${estado.bloque.funcionarios.length} funcionarios y ${estado.bloque.registros.length} marcas`;
            renderBloques();
            return;
        }

        estado.encabezados = filas[0].map((valor) => String(valor));
        estado.columnas = detectarColumnas(estado.encabezados);
        info.innerHTML = `<i class="ph-bold ph-check-circle"></i> ${escapar(archivo.name)}: ${filas.length - 1} filas leidas`;
        renderMapeo();
    } catch (error) {
        console.error(error);
        info.textContent = '';
        mapeo.innerHTML = `<div class="p-5 rounded-3xl bg-rose-50 border border-rose-200 text-rose-700 font-bold text-sm">${escapar(error.message)}</div>`;
    }
}

async function leerArchivo(archivo) {
    if (/\.(csv|txt)$/i.test(archivo.name)) {
        return parseCsv(await archivo.text()).map((fila) => fila.map((valor) => String(valor).trim()));
    }

    // El .xls antiguo (BIFF) no lo lee el parser: se avisa antes de fallar.
    const cabecera = new Uint8Array(await archivo.slice(0, 8).arrayBuffer());
    if (cabecera[0] === 0xd0 && cabecera[1] === 0xcf && cabecera[2] === 0x11 && cabecera[3] === 0xe0) {
        throw new Error('Es un Excel antiguo (.xls). Abrilo y guardalo como .xlsx para poder importarlo.');
    }

    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await archivo.arrayBuffer());
    const hoja = libro.worksheets[0];
    if (!hoja) throw new Error('El archivo no tiene hojas.');

    const filas = [];
    // includeEmpty: los bloques del reloj ocupan 2 filas (datos + marcaciones) y la
    // de marcaciones puede estar vacia; sin las filas vacias se pierde la alineacion.
    hoja.eachRow({ includeEmpty: true }, (fila) => {
        filas.push((fila.values || []).slice(1).map(valorCelda));
    });
    return filas;
}

// ---------------------------- Reporte del reloj (matriz por bloques) ----------------------------

function aplicarPeriodoDetectado(periodo) {
    const entrada = document.getElementById('planillaPeriodo');
    if (entrada && periodo?.anio && periodo?.mes) {
        entrada.value = `${periodo.anio}-${pad2(periodo.mes)}`;
    }
}

// Fuente del listado "ID del reloj <-> funcionario" cuando el archivo es el reporte.
function fuenteBloques() {
    return (estado.bloque?.funcionarios || []).map((funcionario) => ({
        idReloj: String(funcionario.id),
        nombre: funcionario.nombre,
        marcas: funcionario.marcas.size,
    }));
}

function panelSinCoincidencia(sinCoincidencia) {
    if (sinCoincidencia.length === 0) return '';

    const detalle = sinCoincidencia
        .slice(0, 40)
        .map((item) => `${item.idReloj}${item.nombre ? ` (${item.nombre})` : ''}`);
    return `<div class="p-5 rounded-3xl bg-rose-50 border border-rose-200">
        <p class="font-black uppercase tracking-wider text-[11px] text-rose-700">${sinCoincidencia.length} ID(s) del reloj sin funcionario en el sistema</p>
        <p class="text-[11px] font-bold text-rose-700 mt-1">No generan descuentos hasta que su cedula coincida con un funcionario cargado en el reloj:</p>
        <p class="text-[11px] font-black text-rose-800 mt-2 break-words">${escapar(detalle.join(' · '))}</p>
    </div>`;
}

function panelSinMarcas(sinMarcas) {
    if (sinMarcas.length === 0) return '';

    const detalle = sinMarcas
        .slice(0, 40)
        .map((funcionario) => `${funcionario.nombre || 'SIN NOMBRE'} (ID ${funcionario.id})`);
    return `<div class="p-5 rounded-3xl bg-amber-50 border border-amber-200">
        <p class="font-black uppercase tracking-wider text-[11px] text-amber-800">${sinMarcas.length} funcionario(s) sin ninguna marcacion en el periodo</p>
        <p class="text-[11px] font-bold text-amber-800 mt-1">Si trabajaron, revisa si estan cargados en el reloj con su cedula; si no, se contaria todo el mes como ausencia:</p>
        <p class="text-[11px] font-black text-amber-900 mt-2 break-words">${escapar(detalle.join(' · '))}</p>
    </div>`;
}

function panelAvisos(avisos) {
    if (!avisos?.length) return '';

    return `<div class="p-5 rounded-3xl bg-slate-50 border border-slate-200">
        <p class="font-black uppercase tracking-wider text-[11px] text-slate-600">Avisos de lectura (${avisos.length})</p>
        <ul class="text-[11px] font-bold text-slate-500 mt-2 space-y-1 list-disc pl-5">
            ${avisos
                .slice(0, 15)
                .map((aviso) => `<li>${escapar(aviso)}</li>`)
                .join('')}
        </ul>
    </div>`;
}

function renderBloques() {
    const contenedor = document.getElementById('planillaMapeo');
    const bloque = estado.bloque;
    const listado = listadoDesdeFuente(fuenteBloques());
    const sinCoincidencia = listado.filter((item) => !item.empleado);
    const sinMarcas = bloque.funcionarios.filter((funcionario) => funcionario.marcas.size === 0);
    const periodo = bloque.periodo.desde
        ? `${bloque.periodo.desde} ~ ${bloque.periodo.hasta}`
        : `${pad2(bloque.periodo.mes)}/${bloque.periodo.anio}`;

    contenedor.innerHTML = `
        <div class="space-y-6">
            <div class="p-6 rounded-3xl border border-emerald-200 bg-emerald-50/50">
                <h4 class="font-black text-emerald-800 flex items-center gap-2"><i class="ph-bold ph-check-circle"></i> Reporte del reloj detectado</h4>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-[11px] font-bold text-slate-600">
                    <p>Periodo: <span class="font-black text-slate-800">${escapar(periodo)}</span></p>
                    <p>Dias del mes: <span class="font-black text-slate-800">${bloque.dias.length}</span></p>
                    <p>Funcionarios: <span class="font-black text-slate-800">${bloque.funcionarios.length}</span></p>
                    <p>Marcas leidas: <span class="font-black text-slate-800">${bloque.registros.length}</span></p>
                </div>
                <p class="text-[11px] font-bold text-slate-500 mt-3">El ID del reloj se cruza con la <b>cedula</b> del funcionario. Confirma el periodo de arriba antes de procesar.</p>
            </div>

            ${panelSinCoincidencia(sinCoincidencia)}
            ${panelSinMarcas(sinMarcas)}
            ${panelAvisos(bloque.avisos)}

            <div class="p-6 rounded-3xl border border-slate-200">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 class="font-black text-slate-700 flex items-center gap-2"><i class="ph-bold ph-identification-card text-indigo-500"></i> IDs del reloj y funcionario</h4>
                        <p class="text-[11px] font-bold text-slate-500 mt-1">Asi quedan cargados en el reloj: el ID es la cedula del funcionario.</p>
                    </div>
                    ${Export.exportButton('exportarIdsPlanilla()', 'EXPORTAR IDs')}
                </div>
                ${tablaListado(listado)}
            </div>

            <div class="flex flex-wrap items-center justify-between gap-4">
                <p class="text-[11px] font-bold text-slate-500">${escapar(estado.nombreArchivo)}</p>
                <button type="button" onclick="procesarPlanilla()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-8 py-4 rounded-2xl shadow-lg shadow-indigo-200 flex items-center gap-2">
                    <i class="ph-bold ph-calculator"></i> PROCESAR PLANILLA
                </button>
            </div>
        </div>`;
}

// ---------------------------- Mapeo de columnas y listado de IDs ----------------------------

function filasDeDatos() {
    return estado.filas.slice(1).filter((fila) => fila.some((valor) => String(valor ?? '').trim() !== ''));
}

function valorDe(fila, clave) {
    const indice = estado.columnas[clave];
    if (indice === null || indice === undefined) return '';
    return String(fila[indice] ?? '').trim();
}

function listadoDesdeFuente(fuente) {
    const indice = construirIndiceEmpleados(estado.empleados);

    return fuente
        .map((item) => ({
            ...item,
            empleado: resolverFuncionario({ biometricId: item.idReloj, nombre: item.nombre }, indice),
        }))
        .sort((a, b) => String(a.idReloj).localeCompare(String(b.idReloj), 'es', { numeric: true }));
}

function listadoIds() {
    const agrupado = new Map();

    for (const fila of filasDeDatos()) {
        const idReloj = valorDe(fila, 'biometricId');
        const nombre = valorDe(fila, 'nombre');
        if (!idReloj && !nombre) continue;

        const clave = idReloj || `NOMBRE:${nombre}`;
        if (!agrupado.has(clave)) agrupado.set(clave, { idReloj, nombre, marcas: 0 });
        const item = agrupado.get(clave);
        item.marcas += 1;
        if (!item.nombre && nombre) item.nombre = nombre;
    }

    return listadoDesdeFuente([...agrupado.values()]);
}

// Listado segun el formato del archivo cargado (reporte del reloj o tabla).
function listadoActual() {
    return estado.bloque ? listadoDesdeFuente(fuenteBloques()) : listadoIds();
}

window.exportarIdsPlanilla = () => {
    Export.downloadCsv(
        `ids-reloj-${Export.dateStamp()}`,
        [
            { label: 'ID en el reloj', value: (fila) => fila.idReloj },
            { label: 'Nombre en el archivo', value: (fila) => fila.nombre },
            { label: 'Funcionario del sistema', value: (fila) => fila.empleado?.fullName || '' },
            { label: 'CI', value: (fila) => fila.empleado?.dni || '' },
            { label: 'Sucursal', value: (fila) => fila.empleado?.branch || '' },
            { label: 'Marcas leidas', value: (fila) => fila.marcas },
        ],
        listadoActual()
    );
    avisar('Exportado', 'Listado de IDs del reloj generado.');
};

function tablaListado(listado) {
    if (listado.length === 0) {
        return '<p class="mt-4 text-[11px] font-bold text-slate-400">No se detectaron columnas de ID ni de nombre.</p>';
    }

    const filas = listado
        .slice(0, 200)
        .map((item) => {
            const coincidencia = item.empleado
                ? '<span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-black text-[10px]">OK</span>'
                : '<span class="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 font-black text-[10px]">SIN COINCIDENCIA</span>';
            return `<tr class="border-b border-slate-50">
                <td class="py-2 px-3 font-black text-slate-700">${escapar(item.idReloj || '-')}</td>
                <td class="py-2 px-3 text-slate-600">${escapar(item.nombre || '-')}</td>
                <td class="py-2 px-3 font-bold text-slate-700">${escapar(item.empleado?.fullName || '-')}</td>
                <td class="py-2 px-3 text-slate-500">${escapar(item.empleado?.dni || '-')}</td>
                <td class="py-2 px-3 text-right text-slate-500">${item.marcas}</td>
                <td class="py-2 px-3 text-right">${coincidencia}</td>
            </tr>`;
        })
        .join('');

    return `<div class="mt-4 max-h-72 overflow-y-auto border border-slate-100 rounded-2xl">
        <table class="w-full text-[11px]">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] font-black sticky top-0">
                <tr><th class="text-left py-2 px-3">ID reloj</th><th class="text-left py-2 px-3">Nombre en archivo</th><th class="text-left py-2 px-3">Funcionario</th><th class="text-left py-2 px-3">CI</th><th class="text-right py-2 px-3">Marcas</th><th class="text-right py-2 px-3">Estado</th></tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    </div>`;
}

function tablaVistaPrevia() {
    const filas = filasDeDatos().slice(0, 8);
    const columnas = estado.encabezados.slice(0, 8);
    const encabezado = columnas
        .map((titulo, indice) => `<th class="text-left py-2 px-3">${escapar(titulo || `Col ${indice + 1}`)}</th>`)
        .join('');
    const cuerpo = filas
        .map(
            (fila) =>
                `<tr class="border-b border-slate-50">${columnas
                    .map((_titulo, indice) => {
                        const valor = fila[indice];
                        return `<td class="py-2 px-3 text-slate-600">${escapar(valor instanceof Date ? valor.toLocaleString('es-PY') : valor)}</td>`;
                    })
                    .join('')}</tr>`
        )
        .join('');

    return `<div class="mt-4 overflow-x-auto border border-slate-100 rounded-2xl">
        <table class="w-full text-[11px]">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] font-black"><tr>${encabezado}</tr></thead>
            <tbody>${cuerpo}</tbody>
        </table>
    </div>`;
}

function opcionesColumnas(clave) {
    return estado.encabezados
        .map((titulo, indice) => {
            const seleccionado = estado.columnas[clave] === indice ? ' selected' : '';
            return `<option value="${indice}"${seleccionado}>${escapar(titulo || `Columna ${indice + 1}`)}</option>`;
        })
        .join('');
}

function renderMapeo() {
    const contenedor = document.getElementById('planillaMapeo');
    const listado = listadoIds();
    const faltan =
        estado.columnas.fecha === null || (estado.columnas.entrada === null && estado.columnas.salida === null);

    contenedor.innerHTML = `
        <div class="space-y-6">
            <div class="p-6 rounded-3xl border border-slate-200">
                <h4 class="font-black text-slate-700 flex items-center gap-2"><i class="ph-bold ph-columns text-indigo-500"></i> 2. Columnas detectadas</h4>
                <p class="text-[11px] font-bold text-slate-500 mt-1">Se detectan automaticamente; corrigilas si el reloj exporta otros titulos.</p>
                <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                    ${CAMPOS.map(
                        (campo) => `<div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">${campo.etiqueta}</label>
                            <select data-campo="${campo.clave}" class="planillaCampo w-full border-2 border-slate-100 p-3 rounded-2xl bg-slate-50 font-bold text-slate-700 mt-1">
                                <option value="">(sin usar)</option>
                                ${opcionesColumnas(campo.clave)}
                            </select>
                        </div>`
                    ).join('')}
                </div>
                ${
                    faltan
                        ? `<p class="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px]">Asigna al menos <b>Fecha</b> y <b>Entrada</b> para poder procesar la planilla.</p>`
                        : ''
                }
            </div>

            <div class="p-6 rounded-3xl border border-slate-200">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 class="font-black text-slate-700 flex items-center gap-2"><i class="ph-bold ph-identification-card text-indigo-500"></i> 3. IDs del reloj y funcionario</h4>
                        <p class="text-[11px] font-bold text-slate-500 mt-1">Usa esta lista para estandarizar el ID que se carga en el reloj (recomendado: la cedula sin puntos).</p>
                    </div>
                    ${Export.exportButton('exportarIdsPlanilla()', 'EXPORTAR IDs')}
                </div>
                ${tablaListado(listado)}
            </div>

            <div class="p-6 rounded-3xl border border-slate-200">
                <h4 class="font-black text-slate-700 flex items-center gap-2"><i class="ph-bold ph-table text-indigo-500"></i> 4. Vista previa del archivo</h4>
                ${tablaVistaPrevia()}
            </div>

            <div class="flex flex-wrap items-center justify-between gap-4">
                <p class="text-[11px] font-bold text-slate-500">${filasDeDatos().length} marcaciones leidas de ${escapar(estado.nombreArchivo)}</p>
                <button type="button" onclick="procesarPlanilla()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-8 py-4 rounded-2xl shadow-lg shadow-indigo-200 flex items-center gap-2">
                    <i class="ph-bold ph-calculator"></i> PROCESAR PLANILLA
                </button>
            </div>
        </div>`;

    contenedor.querySelectorAll('.planillaCampo').forEach((select) => {
        select.addEventListener('change', (evento) => {
            const campo = evento.target.getAttribute('data-campo');
            const valor = evento.target.value;
            estado.columnas[campo] = valor === '' ? null : Number(valor);
            renderMapeo();
        });
    });
}

// ---------------------------- Procesamiento ----------------------------

function parametrosPeriodo() {
    const [anio, mes] = (document.getElementById('planillaPeriodo')?.value || '').split('-').map(Number);
    const diasSemana = Array.from(document.querySelectorAll('.planillaDia:checked')).map((check) =>
        Number(check.value)
    );

    return {
        anio: anio || new Date().getFullYear(),
        mes: mes || new Date().getMonth() + 1,
        diasSemana: diasSemana.length ? diasSemana : REGLAS_PLANILLA.diasSemanaDefecto,
        horaGeneral: document.getElementById('planillaHoraEntrada')?.value || REGLAS_PLANILLA.horaEntradaDefecto,
    };
}

function construirAsistencias() {
    // El reporte del reloj ya trae fecha y hora por funcionario y dia.
    if (estado.bloque) return estado.bloque.registros;

    const columnaFecha = estado.columnas.fecha;
    const columnaEntrada = estado.columnas.entrada;

    return filasDeDatos()
        .map((fila) => ({
            biometricId: valorDe(fila, 'biometricId'),
            nombre: valorDe(fila, 'nombre'),
            fecha: columnaFecha === null ? null : parseFecha(fila[columnaFecha]),
            entrada: columnaEntrada === null ? null : parseHora(fila[columnaEntrada]),
        }))
        .filter((marca) => marca.fecha);
}

const clavePeriodo = (anio, mes) => `${anio}-${pad2(mes)}`;

// Evita descontar dos veces el mismo periodo al mismo funcionario.
function yaImportado(employeeId, periodo) {
    if (estado.importados.has(employeeId)) return true;
    return descuentosActuales().some(
        (item) =>
            item.employeeId === employeeId &&
            item.origen === 'PLANILLA_BIOMETRICA' &&
            (item.periodKey || '') === periodo &&
            !item.deleted
    );
}

window.procesarPlanilla = () => {
    if (estado.columnas.fecha === null || (estado.columnas.entrada === null && estado.columnas.salida === null)) {
        avisar('Error', 'Asigna al menos las columnas de Fecha y Entrada.');
        return;
    }

    const { anio, mes, diasSemana, horaGeneral } = parametrosPeriodo();
    const dias = diasEsperados(anio, mes, { diasSemana });

    if (dias.length === 0) {
        avisar('Error', 'El periodo no tiene dias laborables con la configuracion elegida.');
        return;
    }

    const evaluacion = evaluarAsistencia({
        asistencias: construirAsistencias(),
        empleados: estado.empleados,
        dias,
        horaEntradaPorFuncionario: horasDeSucursales(),
        horaEntradaDefecto: horaGeneral,
    });

    estado.resultado = { ...evaluacion, anio, mes, dias, diasSemana, horaGeneral };
    estado.excluidos = new Set(
        evaluacion.filas
            .filter((fila) => yaImportado(fila.employeeId, clavePeriodo(anio, mes)))
            .map((fila) => fila.employeeId)
    );

    renderResultado();
};

window.alternarFilaPlanilla = (employeeId) => {
    if (estado.excluidos.has(employeeId)) estado.excluidos.delete(employeeId);
    else estado.excluidos.add(employeeId);
    renderResultado();
};

// Exclusion rapida de quien no tiene ninguna marcacion: suele significar que el
// funcionario no esta cargado en el reloj, no que falto todo el mes.
window.excluirSinMarcas = () => {
    if (!estado.resultado) return;

    const sinMarcas = estado.resultado.filas.filter((fila) => fila.diasMarcados === 0);
    estado.excluidos = new Set([...estado.excluidos, ...sinMarcas.map((fila) => fila.employeeId)]);
    avisar('Aplicado', `${sinMarcas.length} funcionario(s) sin marcaciones quedaron excluidos.`);
    renderResultado();
};

window.volverAlMapeoPlanilla = () => {
    renderPaso1();
    if (estado.filas.length > 0) renderMapeo();
};

function filasConDescuento() {
    if (!estado.resultado) return [];
    return estado.resultado.filas.filter((fila) => fila.montoTotal > 0);
}

function totalesSeleccionados() {
    const totales = {
        funcionarios: 0,
        tardanzas: 0,
        ausencias: 0,
        diasDescontados: 0,
        montoTardanzas: 0,
        montoAusencias: 0,
        montoTotal: 0,
    };

    for (const fila of filasConDescuento()) {
        if (estado.excluidos.has(fila.employeeId)) continue;
        totales.funcionarios += 1;
        totales.tardanzas += fila.tardanzas;
        totales.ausencias += fila.ausencias;
        totales.diasDescontados += fila.diasDescontados;
        totales.montoTardanzas += fila.montoTardanzas;
        totales.montoAusencias += fila.montoAusencias;
        totales.montoTotal += fila.montoTotal;
    }

    return totales;
}

function panelSinMapear() {
    const sinMapear = estado.resultado?.sinMapear || [];
    if (sinMapear.length === 0) return '';

    const ids = [...new Set(sinMapear.map((marca) => marca.biometricId || marca.nombre || '?'))].slice(0, 40);
    return `<div class="p-5 rounded-3xl bg-amber-50 border border-amber-200">
        <p class="font-black uppercase tracking-wider text-[11px] text-amber-800">${sinMapear.length} marcaciones sin funcionario asignado</p>
        <p class="text-[11px] font-bold text-amber-800 mt-1">Estos IDs del reloj no coinciden con ninguna cedula ni nombre del sistema y no generaron descuento:</p>
        <p class="text-[11px] font-black text-amber-900 mt-2 break-words">${escapar(ids.join(' · '))}</p>
    </div>`;
}

function tablaResultado(filas, totales) {
    if (filas.length === 0) {
        return '<p class="mt-6 text-center py-10 text-slate-300 font-bold">No hay tardanzas ni ausencias en el periodo evaluado.</p>';
    }

    const cuerpo = filas
        .map((fila) => {
            const excluido = estado.excluidos.has(fila.employeeId);
            const reimportado = yaImportado(fila.employeeId, clavePeriodo(estado.resultado.anio, estado.resultado.mes));
            const advertencias = fila.advertencias.length
                ? `<p class="text-[10px] font-black text-amber-600">${escapar(fila.advertencias.join(' / '))}</p>`
                : '';

            return `<tr class="${excluido ? 'opacity-40' : ''}">
                <td class="pt-3 px-3">
                    <input type="checkbox" ${excluido ? '' : 'checked'} onchange="alternarFilaPlanilla('${fila.employeeId}')" class="w-4 h-4">
                </td>
                <td class="pt-3 px-3">
                    <p class="font-black text-slate-700">${escapar(fila.employeeName)}</p>
                    <p class="text-[10px] font-bold text-slate-400">${escapar(fila.branch || '-')}${fila.biometricId ? ` · ID ${escapar(fila.biometricId)}` : ''}</p>
                    ${advertencias}
                    ${reimportado ? '<p class="text-[10px] font-black text-rose-600">YA IMPORTADO EN ESTE PERIODO</p>' : ''}
                </td>
                <td class="pt-3 px-3 text-slate-600">${escapar(fila.cedula || '-')}</td>
                <td class="pt-3 px-3 text-right">
                    ${
                        fila.tardanzas
                            ? `<p class="font-black text-slate-700">${fila.tardanzas}</p><p class="text-[10px] font-bold text-slate-400">${minutosATexto(fila.minutosRetraso)}</p>`
                            : '<span class="text-slate-300">-</span>'
                    }
                </td>
                <td class="pt-3 px-3 text-right font-black text-slate-700">${fila.ausencias || '-'}</td>
                <td class="pt-3 px-3 text-right font-black text-slate-700">${fila.diasDescontados || '-'}</td>
                <td class="pt-3 px-3 text-right font-black text-rose-600">${formatearGs(fila.montoTotal)}</td>
            </tr>
            <tr class="border-b border-slate-100 ${excluido ? 'opacity-40' : ''}">
                <td class="px-3 pb-3"></td>
                <td colspan="6" class="px-3 pb-3">
                    <p class="text-[10px] font-bold text-slate-500">${escapar(razonDescuento(fila))}</p>
                </td>
            </tr>`;
        })
        .join('');

    return `<div class="mt-4 overflow-x-auto border border-slate-100 rounded-2xl">
        <table class="w-full text-[11px]">
            <thead class="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
                <tr>
                    <th class="py-2 px-3">Inc.</th>
                    <th class="text-left py-2 px-3">Funcionario</th>
                    <th class="text-left py-2 px-3">C.I.</th>
                    <th class="text-right py-2 px-3">Tardanzas</th>
                    <th class="text-right py-2 px-3">Ausencias</th>
                    <th class="text-right py-2 px-3">Dias desc.</th>
                    <th class="text-right py-2 px-3">Monto</th>
                </tr>
            </thead>
            <tbody>${cuerpo}</tbody>
            <tfoot class="bg-slate-50 font-black text-slate-700">
                <tr>
                    <td></td>
                    <td class="py-3 px-3">TOTALES (${totales.funcionarios} funcionario/s)</td>
                    <td></td>
                    <td class="text-right py-3 px-3">${totales.tardanzas}</td>
                    <td class="text-right py-3 px-3">${totales.ausencias}</td>
                    <td class="text-right py-3 px-3">${totales.diasDescontados}</td>
                    <td class="text-right py-3 px-3 text-rose-700">${formatearGs(totales.montoTotal)}</td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

function tarjeta(titulo, valor, detalle, destacado = false) {
    return `<div class="p-5 rounded-3xl border ${destacado ? 'border-rose-100 bg-rose-50/60' : 'border-slate-200 bg-white'}">
        <p class="text-[10px] font-black uppercase tracking-widest ${destacado ? 'text-rose-500' : 'text-slate-400'}">${titulo}</p>
        <p class="text-2xl font-black ${destacado ? 'text-rose-700' : 'text-slate-800'} mt-1">${valor}</p>
        <p class="text-[10px] font-bold text-slate-400 mt-1">${detalle}</p>
    </div>`;
}

function renderResultado() {
    const contenedor = document.getElementById('planillaBody');
    const resultado = estado.resultado;
    if (!resultado) return;

    const filas = filasConDescuento();
    const totales = totalesSeleccionados();
    const sinNovedad = resultado.filas.length - filas.length;
    const filasSinMarcas = resultado.filas.filter((fila) => fila.diasMarcados === 0).length;
    const minutosTotales = filas
        .filter((fila) => !estado.excluidos.has(fila.employeeId))
        .reduce((suma, fila) => suma + fila.minutosRetraso, 0);

    contenedor.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            ${tarjeta('Periodo evaluado', `${pad2(resultado.mes)}/${resultado.anio}`, `${resultado.dias.length} dias laborables · entrada ${resultado.horaGeneral}`)}
            ${tarjeta('Funcionarios con descuento', String(totales.funcionarios), `${sinNovedad} sin novedades`)}
            ${tarjeta('Tardanzas / Ausencias', `${totales.tardanzas} / ${totales.ausencias}`, `${minutosATexto(minutosTotales)} de retraso acumulado`)}
            ${tarjeta('Total a descontar', formatearGs(totales.montoTotal), 'Tardanzas + ausencias', true)}
        </div>

        <div class="p-6 rounded-3xl border border-slate-200">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h4 class="font-black text-slate-700 flex items-center gap-2"><i class="ph-bold ph-warning-circle text-rose-500"></i> Funcionarios con tardanzas o ausencias</h4>
                    <p class="text-[11px] font-bold text-slate-500 mt-1">Destilda a quien corresponda una justificacion antes de guardar o imprimir.</p>
                </div>
                ${sinNovedad > 0 ? `<span class="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 font-black text-[10px]">${sinNovedad} SIN NOVEDADES</span>` : ''}
            </div>
            ${
                filasSinMarcas > 0
                    ? `<div class="mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
                    <p class="text-[11px] font-bold text-amber-800">${filasSinMarcas} funcionario(s) no tienen <b>ninguna</b> marcacion: puede ser que falten en el reloj, no que ausentaron todo el mes.</p>
                    <button type="button" onclick="excluirSinMarcas()" class="bg-white hover:bg-amber-100 text-amber-800 border border-amber-300 font-black text-[10px] uppercase tracking-wider px-4 py-3 rounded-xl">
                        <i class="ph-bold ph-user-minus"></i> Excluir esos ${filasSinMarcas}
                    </button>
                </div>`
                    : ''
            }
            ${tablaResultado(filas, totales)}
        </div>

        ${panelSinMapear()}
        ${panelAvisos(estado.bloque?.avisos || [])}

        <div class="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onclick="volverAlMapeoPlanilla()" class="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-black text-[11px] uppercase tracking-wider px-5 py-4 rounded-2xl">
                <i class="ph-bold ph-arrow-left"></i> Volver al mapeo
            </button>
            <div class="flex flex-wrap gap-3">
                <button type="button" onclick="imprimirPlanillaA4()" class="bg-slate-900 hover:bg-slate-800 text-white font-black text-[11px] uppercase tracking-wider px-6 py-4 rounded-2xl flex items-center gap-2">
                    <i class="ph-bold ph-printer"></i> Imprimir / Guardar PDF
                </button>
                <button type="button" onclick="guardarDescuentosPlanilla()" class="bg-rose-600 hover:bg-rose-700 text-white font-black text-[11px] uppercase tracking-wider px-6 py-4 rounded-2xl shadow-lg shadow-rose-200 flex items-center gap-2">
                    <i class="ph-bold ph-floppy-disk"></i> Guardar descuentos (${totales.funcionarios})
                </button>
            </div>
        </div>`;
}

// ---------------------------- Reporte A4 ----------------------------

function estiloA4() {
    return `
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; margin: 0; }
    .acciones { text-align: right; margin-bottom: 10px; }
    .acciones button { font-weight: bold; padding: 8px 14px; cursor: pointer; }
    .cabecera { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .logo { width: 64px; height: auto; }
    .empresa { flex: 1; }
    .empresa h1 { margin: 0; font-size: 16px; letter-spacing: 1px; }
    .empresa p { margin: 2px 0 0; font-size: 9px; color: #444; }
    h2 { text-align: center; font-size: 13px; margin: 14px 0 4px; text-transform: uppercase; }
    .meta { text-align: center; font-size: 8px; color: #444; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 3px 4px; }
    thead th { background: #eee; text-transform: uppercase; font-size: 8px; }
    td.c { text-align: center; }
    td.r { text-align: right; font-weight: bold; }
    tfoot td { background: #f4f4f4; font-weight: bold; }
    tr.razon td { background: #fafafa; font-size: 8px; text-align: left; border-top: none; color: #333; }
    .nombre { font-weight: bold; text-transform: uppercase; }
    .nombre .ci { display: block; font-weight: normal; text-transform: none; font-size: 7.5px; color: #555; }
    .razon-cell { font-size: 8px; color: #333; text-align: left; }
    th.col-nombre { width: 26%; }
    th.col-razon { width: 52%; }
    th.col-monto { width: 22%; }
    .resumen { display: flex; gap: 8px; margin: 10px 0; }
    .caja { flex: 1; border: 1px solid #999; padding: 6px; }
    .caja span { display: block; font-size: 8px; text-transform: uppercase; color: #555; }
    .caja strong { font-size: 12px; }
    .firmas { display: flex; gap: 40px; margin-top: 48px; }
    .firma { flex: 1; text-align: center; font-size: 8px; }
    .linea { border-top: 1px solid #111; margin-bottom: 3px; }
    .nota { font-size: 8px; color: #555; margin-top: 12px; border-top: 1px solid #ccc; padding-top: 6px; }
    @media print { .acciones { display: none; } }`;
}

function cabeceraA4(periodo, emitido, operador) {
    return `
    <div class="acciones"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>
    <div class="cabecera">
        <img src="${logoUrl}" class="logo" alt="Logo" onerror="this.style.display='none'">
        <div class="empresa">
            <h1>${escapar(COMPANY.name)}</h1>
            <p>${escapar(COMPANY.address)}</p>
            <p>${escapar(COMPANY.city)}</p>
        </div>
        <div style="text-align:right;">
            <p style="margin:0;"><strong>Emitido:</strong> ${emitido.toLocaleDateString('es-PY')} ${emitido.toLocaleTimeString('es-PY')}</p>
            <p style="margin:2px 0 0;"><strong>Responsable:</strong> ${escapar(operador)}</p>
            <p style="margin:2px 0 0;"><strong>Periodo:</strong> ${periodo}</p>
        </div>
    </div>`;
}

function construirReporteA4() {
    const resultado = estado.resultado;
    const filas = filasConDescuento().filter((fila) => !estado.excluidos.has(fila.employeeId));
    const totales = totalesSeleccionados();
    const periodo = `${pad2(resultado.mes)}/${resultado.anio}`;
    const operador = estado.usuario?.fullName || estado.usuario?.email || 'RRHH';
    const minutosTotales = filas.reduce((suma, fila) => suma + fila.minutosRetraso, 0);

    const cuerpo =
        filas
            .map(
                (fila) => `<tr>
                <td class="nombre">${escapar(fila.employeeName)}<span class="ci">C.I. ${escapar(fila.cedula || '-')}</span></td>
                <td class="razon-cell">${escapar(razonDescuento(fila))}</td>
                <td class="r">${formatearGs(fila.montoTotal)}</td>
            </tr>`
            )
            .join('') || '<tr><td colspan="3" class="c">Sin tardanzas ni ausencias en el periodo evaluado.</td></tr>';

    const metadatos = `Periodo evaluado: <strong>${periodo}</strong> · Dias laborables: ${resultado.dias.length} · Hora de entrada: ${resultado.horaGeneral} · Reglas: 29 min de gracia · ${formatearGs(REGLAS_PLANILLA.montoPorBloque)} por cada ${REGLAS_PLANILLA.bloqueMinutos} min · mas de 2 h y ausencias: 1 dia (salario / ${REGLAS_PLANILLA.diasBaseMes})`;

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Planilla de asistencia ${periodo}</title>
<style>${estiloA4()}</style></head>
<body>
    ${cabeceraA4(periodo, new Date(), operador)}

    <h2>Descuentos por tardanzas y ausencias</h2>
    <p class="meta">${metadatos}</p>

    <table>
        <thead>
            <tr>
                <th class="col-nombre">Nombre del funcionario</th>
                <th class="col-razon">Razon (fechas y horarios)</th>
                <th class="col-monto">Monto a descontar</th>
            </tr>
        </thead>
        <tbody>${cuerpo}</tbody>
        <tfoot>
            <tr>
                <td>TOTAL: ${totales.funcionarios} funcionario/s</td>
                <td class="razon-cell">${totales.tardanzas} tardanza(s) · ${minutosATexto(minutosTotales)} · ${totales.ausencias} ausencia(s)</td>
                <td class="r">${formatearGs(totales.montoTotal)}</td>
            </tr>
        </tfoot>
    </table>

    <div class="resumen">
        <div class="caja"><span>Funcionarios</span><strong>${totales.funcionarios}</strong></div>
        <div class="caja"><span>Tardanzas</span><strong>${totales.tardanzas}</strong></div>
        <div class="caja"><span>Ausencias</span><strong>${totales.ausencias}</strong></div>
        <div class="caja"><span>Desc. tardanzas</span><strong>${formatearGs(totales.montoTardanzas)}</strong></div>
        <div class="caja"><span>Desc. ausencias</span><strong>${formatearGs(totales.montoAusencias)}</strong></div>
        <div class="caja"><span>Total general</span><strong>${formatearGs(totales.montoTotal)}</strong></div>
    </div>

    <div class="firmas">
        <div class="firma"><div class="linea"></div>Elaborado por · RRHH</div>
        <div class="firma"><div class="linea"></div>Aprobado por · Gerencia / Administracion</div>
    </div>

    <p class="nota">
        Documento generado por el Sistema RRHH - LinGroup desde la planilla del reloj biometrico (${escapar(estado.nombreArchivo || 'archivo')}).
        Cada ausencia y cada tardanza superior a 2 h equivalen a un dia de trabajo (salario mensual / ${REGLAS_PLANILLA.diasBaseMes}) y se imputan a la liquidacion del periodo.
    </p>
</body></html>`;
}

window.imprimirPlanillaA4 = () => {
    if (!estado.resultado) return;

    const ventana = window.open('', '_blank', 'width=1024,height=768');
    if (!ventana) {
        avisar('Aviso', 'Habilita las ventanas emergentes para imprimir el reporte.');
        return;
    }

    ventana.document.open();
    ventana.document.write(construirReporteA4());
    ventana.document.close();
    setTimeout(() => {
        try {
            ventana.focus();
            ventana.print();
        } catch (error) {
            console.error('Error al imprimir la planilla:', error);
        }
    }, 400);
};

// ---------------------------- Guardar en el modulo de Descuentos ----------------------------

window.guardarDescuentosPlanilla = async () => {
    const resultado = estado.resultado;
    if (!resultado || estado.guardando) return;

    const periodo = clavePeriodo(resultado.anio, resultado.mes);
    const pendientes = filasConDescuento().filter((fila) => !estado.excluidos.has(fila.employeeId));

    if (pendientes.length === 0) {
        avisar('Aviso', 'No hay funcionarios seleccionados con descuento para guardar.');
        return;
    }

    estado.guardando = true;
    let guardados = 0;

    try {
        for (const fila of pendientes) {
            await addDoc(collection(db, 'descuentos'), {
                employeeId: fila.employeeId,
                amount: fila.montoTotal,
                reason: resumenDescuento(fila),
                date: `${periodo}-01`,
                month: resultado.mes,
                year: resultado.anio,
                mes: resultado.mes,
                anio: resultado.anio,
                periodKey: periodo,
                tipoMovimiento: 'DESCUENTO',
                origen: 'PLANILLA_BIOMETRICA',
                periodoInferido: false,
                versionModeloPago: 2,
                usuarioCreador: estado.usuario?.email || '',
                minutosRetraso: fila.minutosRetraso,
                tardanzas: fila.tardanzas,
                tardanzasGraves: fila.tardanzasGraves,
                ausencias: fila.ausencias,
                diasDescontados: fila.diasDescontados,
                detalle: razonDescuento(fila),
                status: 'Aplicado',
                createdAt: serverTimestamp(),
            });
            estado.importados.add(fila.employeeId);
            guardados += 1;
        }

        estado.excluidos = new Set([...estado.excluidos, ...pendientes.map((fila) => fila.employeeId)]);
        avisar('Guardado', `${guardados} descuento(s) aplicados al periodo ${periodo}.`);
        renderResultado();
    } catch (error) {
        console.error(error);
        avisar('Error', 'No se pudieron guardar todos los descuentos. Revisa la conexion.');
    } finally {
        estado.guardando = false;
    }
};
