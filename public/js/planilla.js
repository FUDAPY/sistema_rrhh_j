// public/js/planilla.js
// Reglas de negocio de la planilla de asistencia de relojes biometricos.
// Modulo PURO (sin DOM y sin red) para poder testearse con Vitest.
//
// Reglas vigentes:
//   - 29 minutos de gracia desde la hora de entrada (no generan descuento).
//   - 30 minutos o mas: Gs. 30.000 por cada bloque de 30 min de retraso.
//   - Mas de 2 horas de retraso: 1 dia completo de trabajo (salario / 30).
//   - Ausencia sin marcacion: 1 dia completo de trabajo (salario / 30).

export const REGLAS_PLANILLA = {
    minutosGracia: 29,
    bloqueMinutos: 30,
    montoPorBloque: 30000,
    // 'completos' (def.): cada tramo COMPLETO de 30 min -> 30-59 min = Gs. 30.000,
    //   60-89 = 60.000, 90-119 = 90.000, 120 = 120.000.
    // 'iniciados': cuenta tambien el tramo empezado -> 31 min ya son Gs. 60.000.
    // Es una decision de negocio: cambiar solo con autorizacion de RRHH/Gerencia.
    modoBloques: 'completos',
    minutosJornadaCompleta: 120,
    diasBaseMes: 30,
    horaEntradaDefecto: '08:00',
    diasSemanaDefecto: [0, 1, 2, 3, 4, 5, 6],
    // Con retrasos de mas de 2 h la regla aplica 1 dia completo (salario / 30).
    // Poner en true para descontar el MAYOR entre 1 dia y los bloques de 30 min
    // (evita que una tardanza de 2 h 01 min salga mas barata que una de 2 h).
    usarMayorEnDiaCompleto: false,
};

export const MODO_TARDANZA = {
    EN_GRACIA: 'EN GRACIA',
    BLOQUES: 'BLOQUES',
    DIA_COMPLETO: 'DIA COMPLETO',
};

const pad2 = (valor) => String(valor).padStart(2, '0');

// ---------------------------- Normalizacion ----------------------------

export function normalizarTexto(valor) {
    return String(valor ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

export function soloDigitos(valor) {
    return String(valor ?? '').replace(/\D/g, '');
}

// Cedula comparable: solo digitos y sin ceros a la izquierda (los relojes suelen
// recortar el 0 inicial, ej. la CI 0984108734 se carga como 984108734).
export function normalizarCedula(valor) {
    return soloDigitos(valor).replace(/^0+/, '');
}

export function minutosATexto(minutos) {
    const total = Math.max(0, Math.round(Number(minutos) || 0));
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

// ---------------------------- Fechas y horas ----------------------------

function fechaAISO(fecha, usarUTC = false) {
    const anio = usarUTC ? fecha.getUTCFullYear() : fecha.getFullYear();
    const mes = (usarUTC ? fecha.getUTCMonth() : fecha.getMonth()) + 1;
    const dia = usarUTC ? fecha.getUTCDate() : fecha.getDate();
    return `${anio}-${pad2(mes)}-${pad2(dia)}`;
}

// Acepta "07:35", "7:35:12", "07:35 p.m.", un Date real o el serial de Excel
// (fraccion del dia). Devuelve minutos desde las 00:00, o null si no es una hora.
export function parseHora(valor) {
    if (valor === null || valor === undefined || valor === '') return null;

    if (valor instanceof Date) {
        if (Number.isNaN(valor.getTime())) return null;
        return valor.getHours() * 60 + valor.getMinutes();
    }

    if (typeof valor === 'number' && Number.isFinite(valor)) {
        const fraccion = valor % 1;
        const minutos = Math.round(fraccion * 1440);
        return minutos > 0 && minutos < 1440 ? minutos : null;
    }

    const texto = String(valor).trim();
    const coincidencia = texto.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i);
    if (!coincidencia) return null;

    let horas = Number(coincidencia[1]);
    const minutos = Number(coincidencia[2]);
    const sufijo = (coincidencia[4] || '').toLowerCase().replace(/[^apm]/g, '');

    if (horas > 23 || minutos > 59) return null;
    if (sufijo.startsWith('p') && horas < 12) horas += 12;
    if (sufijo.startsWith('a') && horas === 12) horas = 0;

    return horas * 60 + minutos;
}

// Acepta "2026-08-31", "31/08/2026", "31-08-26", un Date real o el serial de
// Excel. Devuelve "YYYY-MM-DD" o null. Las fechas DD/MM/YYYY se asumen dia/mes.
export function parseFecha(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : fechaAISO(valor);

    if (typeof valor === 'number' && Number.isFinite(valor)) {
        if (valor < 1) return null;
        const dias = Math.floor(valor);
        const base = Date.UTC(1899, 11, 30); // base del serial de Excel (1900)
        return fechaAISO(new Date(base + dias * 86400000), true);
    }

    const texto = String(valor).trim();
    let coincidencia = texto.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (coincidencia) return `${coincidencia[1]}-${pad2(coincidencia[2])}-${pad2(coincidencia[3])}`;

    coincidencia = texto.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (coincidencia) {
        const anio = coincidencia[3].length === 2 ? `20${coincidencia[3]}` : coincidencia[3];
        return `${anio}-${pad2(coincidencia[2])}-${pad2(coincidencia[1])}`;
    }

    return null;
}

// Parser CSV minimo (RFC 4180) para exports de relojes en .csv/.txt. Detecta el
// separador (, ; o tabulador) y respeta comillas dobles escapadas.
export function parseCsv(texto) {
    const contenido = String(texto ?? '').replace(/^\uFEFF/, '');
    const primeraLinea = contenido.split(/\r?\n/).find((linea) => linea.trim() !== '');
    if (!primeraLinea) return [];

    const separador = [',', ';', '\t']
        .map((candidato) => ({ candidato, total: primeraLinea.split(candidato).length }))
        .sort((a, b) => b.total - a.total)[0].candidato;

    const filas = [];
    let campos = [];
    let valor = '';
    let entreComillas = false;

    for (let i = 0; i < contenido.length; i += 1) {
        const caracter = contenido[i];

        if (entreComillas) {
            if (caracter === '"') {
                if (contenido[i + 1] === '"') {
                    valor += '"';
                    i += 1;
                } else {
                    entreComillas = false;
                }
            } else {
                valor += caracter;
            }
            continue;
        }

        if (caracter === '"') {
            entreComillas = true;
        } else if (caracter === separador) {
            campos.push(valor);
            valor = '';
        } else if (caracter === '\n') {
            campos.push(valor);
            filas.push(campos);
            campos = [];
            valor = '';
        } else if (caracter !== '\r') {
            valor += caracter;
        }
    }

    campos.push(valor);
    filas.push(campos);

    return filas.filter((fila) => fila.some((campo) => String(campo).trim() !== ''));
}

// Dias del mes que deben trabajarse segun los dias de la semana elegidos.
export function diasEsperados(anio, mes, opciones = {}) {
    const { diasSemana = REGLAS_PLANILLA.diasSemanaDefecto, desde, hasta } = opciones;
    const totalDias = new Date(anio, mes, 0).getDate();
    const dias = [];

    for (let dia = 1; dia <= totalDias; dia += 1) {
        const fecha = new Date(anio, mes - 1, dia);
        if (!diasSemana.includes(fecha.getDay())) continue;
        const iso = `${anio}-${pad2(mes)}-${pad2(dia)}`;
        if (desde && iso < desde) continue;
        if (hasta && iso > hasta) continue;
        dias.push(iso);
    }

    return dias;
}

// ---------------------------- Reglas de descuento ----------------------------

// Descuento por llegada tarde. `minutosRetraso` es la diferencia entre la hora
// real de marcacion y la hora de entrada esperada (solo si es positiva).
export function calcularTardanza(minutosRetraso, salarioMensual, reglas = REGLAS_PLANILLA) {
    const minutos = Math.max(0, Math.round(Number(minutosRetraso) || 0));
    const salario = Math.max(0, Number(salarioMensual) || 0);
    const valorDia = salario / reglas.diasBaseMes;

    if (minutos <= reglas.minutosGracia) {
        return { minutos, modo: MODO_TARDANZA.EN_GRACIA, bloques: 0, dias: 0, monto: 0 };
    }

    if (minutos > reglas.minutosJornadaCompleta) {
        const montoDia = Math.round(valorDia);
        const bloques =
            reglas.modoBloques === 'iniciados'
                ? Math.ceil(minutos / reglas.bloqueMinutos)
                : Math.floor(minutos / reglas.bloqueMinutos);
        const montoBloques = Math.max(1, bloques) * reglas.montoPorBloque;
        return {
            minutos,
            modo: MODO_TARDANZA.DIA_COMPLETO,
            bloques: 0,
            dias: 1,
            monto: reglas.usarMayorEnDiaCompleto ? Math.max(montoDia, montoBloques) : montoDia,
        };
    }

    const bloques =
        reglas.modoBloques === 'iniciados'
            ? Math.ceil(minutos / reglas.bloqueMinutos)
            : Math.max(1, Math.floor(minutos / reglas.bloqueMinutos));
    return {
        minutos,
        modo: MODO_TARDANZA.BLOQUES,
        bloques,
        dias: 0,
        monto: bloques * reglas.montoPorBloque,
    };
}

// Descuento por ausencia: un dia completo de trabajo.
export function calcularAusencia(salarioMensual, reglas = REGLAS_PLANILLA) {
    const salario = Math.max(0, Number(salarioMensual) || 0);
    return { dias: 1, monto: Math.round(salario / reglas.diasBaseMes) };
}

// ---------------------------- Mapeo de columnas del Excel ----------------------------

// Pistas de encabezados con peso: se elige la coincidencia mas especifica. Asi
// "No. Empleado" se lee como ID y no como nombre.
const PISTAS_COLUMNA = [
    {
        clave: 'biometricId',
        peso: 10,
        patron: /^(no\.?|n[o°º]\.?|nro\.?|numero|num|id|codigo|cod|legajo|pin|enroll|user|usuario)$/i,
    },
    {
        clave: 'biometricId',
        peso: 9,
        patron: /(^|\s)(id|no\.?|nro\.?|numero|codigo|legajo|pin|enroll|usuario)\s*(de\s*)?(empleado|funcionario|persona|usuario|trabajador)/i,
    },
    { clave: 'fecha', peso: 6, patron: /(fecha|date)/i },
    { clave: 'entrada', peso: 6, patron: /(entrada|ingreso|check\s?-?\s?in|hora\s?1)/i },
    { clave: 'salida', peso: 6, patron: /(salida|egreso|check\s?-?\s?out|hora\s?2)/i },
    { clave: 'nombre', peso: 5, patron: /(nombre|apellido|funcionari|emplead|persona|trabajador|name)/i },
    { clave: 'fecha', peso: 3, patron: /^dia$/i },
    { clave: 'entrada', peso: 2, patron: /^in$/i },
    { clave: 'salida', peso: 2, patron: /^out$/i },
];

// Devuelve la posicion elegida para cada campo (o null) a partir de los titulos.
// Solo fecha y al menos una hora son obligatorias para poder procesar.
export function detectarColumnas(encabezados = []) {
    const columnas = { fecha: null, entrada: null, salida: null, nombre: null, biometricId: null };

    encabezados.forEach((titulo, posicion) => {
        const texto = normalizarTexto(titulo);
        if (!texto) return;

        let mejor = null;
        for (const pista of PISTAS_COLUMNA) {
            if (columnas[pista.clave] !== null) continue;
            if (!pista.patron.test(texto)) continue;
            if (!mejor || pista.peso > mejor.peso) mejor = pista;
        }

        if (mejor) columnas[mejor.clave] = posicion;
    });

    return { ...columnas, encabezados };
}

// ---------------------------- Indice de funcionarios ----------------------------

function claveNombre(valor) {
    return normalizarTexto(valor)
        .replace(/[^A-Z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function acumular(mapa, clave, empleado) {
    if (!clave) return;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(empleado);
}

// Elige, entre varios candidatos con la misma clave, al activo.
function preferirActivo(candidatos) {
    if (!candidatos || candidatos.length === 0) return null;
    return candidatos.find((emp) => emp.status !== 'INACTIVO') || candidatos[0];
}

export function construirIndiceEmpleados(empleados = []) {
    const porId = new Map();
    const porCedula = new Map();
    const porNombre = new Map();
    const lista = [];

    for (const empleado of empleados) {
        if (!empleado || !empleado.id) continue;
        porId.set(String(empleado.id), empleado);
        acumular(porCedula, normalizarCedula(empleado.dni ?? empleado.ci ?? empleado.documento), empleado);
        const clave = claveNombre(empleado.fullName ?? empleado.employeeName);
        acumular(porNombre, clave, empleado);
        if (clave) lista.push({ empleado, clave });
    }

    return { porId, porCedula, porNombre, lista };
}

// Resolucion por prioridad: id interno -> cedula (ID del reloj = CI) -> nombre
// exacto -> todos los tokens del nombre del reloj dentro del nombre real.
export function resolverFuncionario({ biometricId, nombre } = {}, indice) {
    const idTexto = String(biometricId ?? '').trim();
    if (idTexto && indice.porId.has(idTexto)) return indice.porId.get(idTexto);

    const cedula = normalizarCedula(biometricId);
    if (cedula && indice.porCedula.has(cedula)) return preferirActivo(indice.porCedula.get(cedula));

    const nombreClave = claveNombre(nombre);
    if (nombreClave && indice.porNombre.has(nombreClave)) return preferirActivo(indice.porNombre.get(nombreClave));

    // Los relojes suelen traer el nombre truncado ("GABRIEL" o "GABRIEL PEREZ"):
    // se acepta solo si TODOS los tokens coinciden con un unico funcionario.
    const tokens = nombreClave ? nombreClave.split(' ').filter((token) => token.length > 2) : [];
    if (tokens.length && indice.lista) {
        const candidatos = indice.lista.filter((item) => tokens.every((token) => item.clave.includes(token)));
        if (candidatos.length === 1) return candidatos[0].empleado;
    }

    return null;
}

// ---------------------------- Evaluacion de la planilla ----------------------------

function crearFila(empleado) {
    return {
        employeeId: empleado.id,
        employeeName: empleado.fullName || empleado.employeeName || 'SIN NOMBRE',
        cedula: empleado.dni || empleado.ci || '',
        branch: empleado.branch || '',
        salarioMensual: Number(empleado.salary) || 0,
        biometricId: '',
        diasEsperados: 0,
        diasMarcados: 0,
        tardanzas: 0,
        tardanzasGraves: 0,
        minutosRetraso: 0,
        ausencias: 0,
        diasDescontados: 0,
        montoTardanzas: 0,
        montoAusencias: 0,
        montoTotal: 0,
        detalle: [],
        fechasAusentes: [],
        advertencias: [],
        incluido: true,
    };
}

function resolverHora(empleado, horas, defecto) {
    if (horas instanceof Map && horas.has(empleado.id)) return horas.get(empleado.id);
    if (horas && typeof horas === 'object' && horas[empleado.id] !== undefined) return horas[empleado.id];
    return parseHora(defecto) ?? parseHora(REGLAS_PLANILLA.horaEntradaDefecto);
}

// Evalua las marcaciones contra las reglas y devuelve el detalle por funcionario.
// `asistencias`: [{ biometricId, employeeId?, nombre?, fecha, entrada? (min) }]
// `dias`: fechas ISO "YYYY-MM-DD" que debian trabajarse en el periodo.
export function evaluarAsistencia({
    asistencias = [],
    empleados = [],
    dias = [],
    horaEntradaPorFuncionario = null,
    horaEntradaDefecto = REGLAS_PLANILLA.horaEntradaDefecto,
    reglas = {},
} = {}) {
    const cfg = { ...REGLAS_PLANILLA, ...reglas };
    const indice = construirIndiceEmpleados(empleados);
    const diasSet = new Set(dias);
    const filas = new Map();
    const entradasPorDia = new Map();
    const sinMapear = [];
    const fueraDePeriodo = [];

    // 1) Resolver cada marcacion y quedarse con la entrada mas temprana del dia.
    for (const marca of asistencias) {
        const empleado = marca.employeeId
            ? indice.porId.get(String(marca.employeeId))
            : resolverFuncionario(marca, indice);
        if (!empleado) {
            sinMapear.push(marca);
            continue;
        }
        if (!marca.fecha || !diasSet.has(marca.fecha)) {
            fueraDePeriodo.push(marca);
            continue;
        }

        if (!filas.has(empleado.id)) filas.set(empleado.id, crearFila(empleado));
        const fila = filas.get(empleado.id);
        if (marca.biometricId && !fila.biometricId) fila.biometricId = String(marca.biometricId);

        const clave = `${empleado.id}|${marca.fecha}`;
        const entrada = Number.isFinite(marca.entrada) ? marca.entrada : null;
        if (!entradasPorDia.has(clave) || (entrada !== null && entrada < entradasPorDia.get(clave))) {
            entradasPorDia.set(clave, entrada);
        }
    }

    // 2) Candidatos: activos del periodo mas quienes tengan marcaciones.
    const candidatos = new Map();
    for (const empleado of empleados) {
        if (!empleado || !empleado.id || empleado.deleted) continue;
        if (empleado.status === 'INACTIVO' && !filas.has(empleado.id)) continue;
        candidatos.set(empleado.id, empleado);
    }
    for (const id of filas.keys()) {
        if (!candidatos.has(id)) {
            const empleado = indice.porId.get(id);
            if (empleado) candidatos.set(id, empleado);
        }
    }

    // 3) Comparar dias esperados contra las marcaciones reales.
    for (const empleado of candidatos.values()) {
        const fila = filas.get(empleado.id) || crearFila(empleado);
        const desde = parseFecha(empleado.startDate);
        const hasta = parseFecha(empleado.endDate);
        const esperados = dias.filter((fecha) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta));
        const horaEntrada = resolverHora(empleado, horaEntradaPorFuncionario, horaEntradaDefecto);

        fila.diasEsperados = esperados.length;
        let diasMarcados = 0;

        for (const fecha of esperados) {
            const clave = `${empleado.id}|${fecha}`;
            if (!entradasPorDia.has(clave)) continue;
            diasMarcados += 1;

            const entrada = entradasPorDia.get(clave);
            if (entrada === null) continue; // marcacion sin hora legible

            const calculo = calcularTardanza(entrada - horaEntrada, fila.salarioMensual, cfg);
            if (calculo.modo === MODO_TARDANZA.EN_GRACIA) continue;

            fila.tardanzas += 1;
            fila.minutosRetraso += calculo.minutos;
            fila.montoTardanzas += calculo.monto;
            if (calculo.modo === MODO_TARDANZA.DIA_COMPLETO) {
                fila.tardanzasGraves += 1;
                fila.diasDescontados += 1;
            }
            fila.detalle.push({
                fecha,
                modo: calculo.modo,
                entrada,
                esperada: horaEntrada,
                minutos: calculo.minutos,
                bloques: calculo.bloques,
                monto: calculo.monto,
            });
        }

        fila.diasMarcados = diasMarcados;
        fila.ausencias = Math.max(0, esperados.length - diasMarcados);

        if (fila.ausencias > 0) {
            const ausencia = calcularAusencia(fila.salarioMensual, cfg);
            fila.montoAusencias = fila.ausencias * ausencia.monto;
            fila.diasDescontados += fila.ausencias;
            fila.fechasAusentes = esperados.filter((fecha) => !entradasPorDia.has(`${empleado.id}|${fecha}`));
        }

        fila.montoTotal = fila.montoTardanzas + fila.montoAusencias;
        if (diasMarcados === 0 && esperados.length > 0) {
            fila.advertencias.push('SIN MARCACIONES: verificar que este cargado en el reloj biometrico');
        }

        filas.set(empleado.id, fila);
    }

    const resultado = Array.from(filas.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'es'));

    const totales = {
        funcionarios: resultado.length,
        conDescuento: 0,
        tardanzas: 0,
        tardanzasGraves: 0,
        ausencias: 0,
        diasDescontados: 0,
        minutosRetraso: 0,
        montoTardanzas: 0,
        montoAusencias: 0,
        montoTotal: 0,
    };
    for (const fila of resultado) {
        if (fila.montoTotal > 0) totales.conDescuento += 1;
        totales.tardanzas += fila.tardanzas;
        totales.tardanzasGraves += fila.tardanzasGraves;
        totales.ausencias += fila.ausencias;
        totales.diasDescontados += fila.diasDescontados;
        totales.minutosRetraso += fila.minutosRetraso;
        totales.montoTardanzas += fila.montoTardanzas;
        totales.montoAusencias += fila.montoAusencias;
        totales.montoTotal += fila.montoTotal;
    }

    return { filas: resultado, totales, sinMapear, fueraDePeriodo };
}

// ---------------------------- Presentacion ----------------------------

export function formatearGs(valor) {
    return `Gs. ${Math.round(Number(valor) || 0).toLocaleString('es-PY')}`;
}

// Texto corto para el motivo del descuento en el modulo de Descuentos.
export function resumenDescuento(fila) {
    const partes = [];
    if (fila.tardanzas > 0) partes.push(`${fila.tardanzas} tardanza(s) / ${minutosATexto(fila.minutosRetraso)}`);
    if (fila.ausencias > 0) partes.push(`${fila.ausencias} ausencia(s)`);
    return `PLANILLA ASISTENCIA: ${partes.join(' - ') || 'sin novedades'}`;
}

// "04/08" a partir de una fecha ISO "2026-08-04".
export function fechaCorta(fecha) {
    const partes = String(fecha || '').split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}` : String(fecha || '');
}

// Razon detallada del descuento, con las fechas exactas (la que va al reporte A4):
//   RAZON: (FECHAS AUSENTES 04/08, 11/08; HORARIOS TARDIOS EN FECHAS 02/08 08:35 (35 min, Gs. 30.000))
export function razonDescuento(fila) {
    const bloques = [];

    if (fila.fechasAusentes?.length) {
        bloques.push(`FECHAS AUSENTES ${fila.fechasAusentes.map(fechaCorta).join(', ')}`);
    }

    if (fila.detalle?.length) {
        const tardanzas = fila.detalle
            .map(
                (item) =>
                    `${fechaCorta(item.fecha)} ${minutosATexto(item.entrada)} (${item.minutos} min, ${formatearGs(item.monto)})`
            )
            .join(', ');
        bloques.push(`HORARIOS TARDIOS EN FECHAS ${tardanzas}`);
    }

    return `RAZON: (${bloques.join('; ') || 'sin novedades'})`;
}

// ---------------------------- Reporte del reloj (matriz por bloques) ----------------------------
//
// Estructura del .xlsx que exporta el reloj:
//   fila 0 ........ "Reporte de Eventos de Asistencia"
//   fila 2 ........ "Periodo:" y en la columna C "2026-08-01 ~ 2026-08-31"
//   fila 3 ........ cabecera de dias del mes (1..31, una columna por dia)
//   fila 4, 6, 8... "ID:" (col 0) + ID (col 2) + "Nombre:" (col 8) + nombre (col 10)
//                   + "Departamento:" (col 18) + valor (col 20)
//   fila 5, 7, 9... marcaciones alineadas a los dias de la fila 3 (celda vacia = ausencia)
//
// El ID del reloj es la CEDULA del funcionario, asi que el cruce con la base se
// hace por cedula normalizada (resolverFuncionario).

export const MIN_DIAS_ENCABEZADO = 5;
const LIMITE_FILAS_CABECERA = 20;
const CAMPOS_DEPARTAMENTO = ['DEPARTAMENTO', 'DEPTO', 'AREA', 'SECCION', 'CARGO', 'PUESTO'];
const PATRON_TITULO_REPORTE = /reporte\s+de\s+eventos|eventos\s+de\s+asistencia/i;
const PATRON_PERIODO_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:~|-|a|to|hasta)\s*(\d{4})-(\d{1,2})-(\d{1,2})/i;
const PATRON_PERIODO_DMA =
    /(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\s*(?:~|-|a|to|hasta)\s*(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/i;

export function celdaVacia(valor) {
    if (valor === null || valor === undefined) return true;
    if (typeof valor === 'string') return valor.trim() === '';
    return false;
}

function textoCelda(valor) {
    if (valor instanceof Date) return valor;
    if (valor && typeof valor === 'object') {
        if (Array.isArray(valor.richText)) return valor.richText.map((parte) => parte.text).join('');
        if (valor.text !== undefined) return valor.text;
        if (valor.result !== undefined) return valor.result;
        return String(valor);
    }
    return valor;
}

// Dia del mes (1-31) que representa una celda de la cabecera, o null.
export function diaDeCelda(valor) {
    if (celdaVacia(valor)) return null;
    if (valor instanceof Date) return valor.getDate();

    const contenido = String(valor).trim();
    if (contenido.includes(':')) return null; // una hora no es un dia

    let coincidencia = contenido.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (coincidencia) return Number(coincidencia[3]);

    coincidencia = contenido.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?\s*$/);
    if (coincidencia) {
        const dia = Number(coincidencia[1]);
        return dia >= 1 && dia <= 31 ? dia : null;
    }

    coincidencia = contenido.match(/^\D*(\d{1,2})\D*$/);
    if (coincidencia) {
        const dia = Number(coincidencia[1]);
        if (dia >= 1 && dia <= 31) return dia;
    }
    return null;
}

export function mapaDiasDeFila(fila) {
    const mapa = new Map();
    (fila || []).forEach((valor, columna) => {
        const dia = diaDeCelda(valor);
        if (dia !== null && !mapa.has(dia)) mapa.set(dia, columna);
    });
    return mapa;
}

export function esFilaCabeceraDias(fila) {
    return mapaDiasDeFila(fila).size >= MIN_DIAS_ENCABEZADO;
}

// Busca la fila de la cabecera de dias: la que tenga mas dias 1..31 reconocidos.
export function detectarCabeceraDias(grilla, limite = LIMITE_FILAS_CABECERA) {
    let mejor = null;

    for (let fila = 0; fila < Math.min(limite, grilla.length); fila += 1) {
        const mapa = mapaDiasDeFila(grilla[fila]);
        if (mapa.size >= MIN_DIAS_ENCABEZADO && (!mejor || mapa.size > mejor.mapa.size)) {
            mejor = { fila, mapa };
        }
    }

    return mejor;
}

function esFilaVacia(fila) {
    return !(fila || []).some((valor) => !celdaVacia(valor));
}

// Detecta etiquetas tipo 'ID:', 'Nombre:' o 'Departamento:'. Exige ':' cuando la
// celda trae valor, para no confundir "Nombre del empleado" con la etiqueta.
function etiquetaYValor(valor, campos) {
    if (celdaVacia(valor)) return { esEtiqueta: false, valor: '' };

    const contenido = String(valor).trim();
    const patron = new RegExp(
        `^(${campos.join('|')})(?:\\s+(?:Y\\s+APELLIDO|COMPLETO|DEL?\\s+\\w+))?\\s*:?\\s*(.*)$`,
        'i'
    );
    const coincidencia = contenido.match(patron);
    if (!coincidencia) return { esEtiqueta: false, valor: '' };

    const resto = coincidencia[2].trim();
    if (!contenido.includes(':') && resto) return { esEtiqueta: false, valor: '' };
    return { esEtiqueta: true, valor: resto };
}

// Valor de una etiqueta: prioriza la celda 2 columnas a la derecha (col 0 -> 2,
// col 8 -> 10, col 18 -> 20) y si esta vacia toma el primer valor no vacio.
function buscarCampo(fila, campos, offset = 2) {
    const largo = (fila || []).length;

    for (let columna = 0; columna < largo; columna += 1) {
        const { esEtiqueta, valor } = etiquetaYValor(fila[columna], campos);
        if (!esEtiqueta) continue;
        if (valor) return { valor, columna };

        const candidato = columna + offset;
        if (candidato < largo && !celdaVacia(fila[candidato])) {
            return { valor: String(textoCelda(fila[candidato])).trim(), columna };
        }

        for (let siguiente = columna + 1; siguiente < largo; siguiente += 1) {
            if (!celdaVacia(fila[siguiente])) {
                return { valor: String(textoCelda(fila[siguiente])).trim(), columna };
            }
        }
        return { valor: '', columna };
    }

    return { valor: '', columna: -1 };
}

// Todas las marcas horarias de una celda, en HH:MM. Soporta celdas con una marca,
// con varias ("08:00 12:00 13:00 18:00"), Date de Excel y seriales numericos.
export function extraerHoras(valor) {
    if (celdaVacia(valor)) return [];
    if (valor instanceof Date) return [`${pad2(valor.getHours())}:${pad2(valor.getMinutes())}`];

    if (typeof valor === 'number' && Number.isFinite(valor)) {
        const total = Math.round((valor % 1) * 1440);
        return total > 0 && total < 1440 ? [`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`] : [];
    }

    const horas = [];
    const patron = /(\d{1,2})\s*:\s*(\d{2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/gi;
    let coincidencia = patron.exec(String(valor));

    while (coincidencia !== null) {
        let hora = Number(coincidencia[1]);
        const minuto = Number(coincidencia[2]);
        const sufijo = (coincidencia[4] || '').toLowerCase().replace(/[^apm]/g, '');

        if (hora <= 23 && minuto <= 59) {
            if (sufijo.startsWith('p') && hora < 12) hora += 12;
            if (sufijo.startsWith('a') && hora === 12) hora = 0;
            const marca = `${pad2(hora)}:${pad2(minuto)}`;
            if (!horas.includes(marca)) horas.push(marca);
        }

        coincidencia = patron.exec(String(valor));
    }

    return horas;
}

// Periodo del encabezado ('2026-08-01 ~ 2026-08-31') -> { anio, mes, desde, hasta }.
export function detectarPeriodoBloques(grilla, filaLimite) {
    for (let fila = 0; fila <= Math.min(filaLimite, grilla.length - 1); fila += 1) {
        for (const valor of grilla[fila] || []) {
            if (celdaVacia(valor)) continue;
            const contenido = String(valor);

            let coincidencia = contenido.match(PATRON_PERIODO_ISO);
            if (coincidencia) {
                return {
                    anio: Number(coincidencia[1]),
                    mes: Number(coincidencia[2]),
                    desde: `${coincidencia[1]}-${pad2(coincidencia[2])}-${pad2(coincidencia[3])}`,
                    hasta: `${coincidencia[4]}-${pad2(coincidencia[5])}-${pad2(coincidencia[6])}`,
                };
            }

            coincidencia = contenido.match(PATRON_PERIODO_DMA);
            if (coincidencia) {
                let anio = Number(coincidencia[3]);
                if (anio < 100) anio += 2000;
                const mes = Number(coincidencia[2]);
                return { anio, mes, desde: `${anio}-${pad2(mes)}-${pad2(coincidencia[1])}`, hasta: null };
            }
        }
    }

    return null;
}

/**
 * Lee el reporte matricial del reloj (formato por bloques).
 *
 * Devuelve { formato, periodo, dias, funcionarios, registros, avisos } o null si
 * el archivo no tiene esa estructura (entonces se trata como tabla normal).
 * `registros` ya viene listo para `evaluarAsistencia`: una fila por funcionario y
 * dia con marca, con `biometricId` = la cedula cargada en el reloj.
 */
export function parsearBloquesAsistencia(grilla, anioMes = null) {
    const cabecera = detectarCabeceraDias(grilla);
    if (!cabecera) return null;

    const periodoDetectado = detectarPeriodoBloques(grilla, cabecera.fila);
    if (!periodoDetectado && !anioMes) return null;

    const anio = anioMes?.anio || periodoDetectado.anio;
    const mes = anioMes?.mes || periodoDetectado.mes;
    const avisos = [];

    if (!periodoDetectado) {
        avisos.push(`No se detecto el periodo en el archivo: se usa ${anio}-${pad2(mes)}.`);
    }

    const dias = [...cabecera.mapa.keys()].sort((a, b) => a - b);
    const funcionarios = [];
    const porId = new Map();

    let fila = cabecera.fila + 1;
    while (fila < grilla.length) {
        const actual = grilla[fila] || [];

        if (esFilaVacia(actual)) {
            fila += 1;
            continue;
        }
        if (esFilaCabeceraDias(actual)) {
            avisos.push(`Fila ${fila + 1}: encabezado de dias repetido (paginacion), se omite.`);
            fila += 1;
            continue;
        }
        if (actual.some((valor) => !celdaVacia(valor) && PATRON_TITULO_REPORTE.test(String(valor)))) {
            avisos.push(`Fila ${fila + 1}: titulo del reporte repetido (paginacion), se omite.`);
            fila += 1;
            continue;
        }

        const { valor: id } = buscarCampo(actual, ['ID']);
        if (!id) {
            fila += 1;
            continue;
        }

        const { valor: nombre } = buscarCampo(actual, ['NOMBRE']);
        const { valor: departamento } = buscarCampo(actual, CAMPOS_DEPARTAMENTO);

        // La fila de marcaciones es la inmediatamente posterior; puede estar
        // vacia (funcionario sin marcaciones) o no existir (bloque incompleto).
        const siguiente = fila + 1;
        const filaSiguiente = siguiente < grilla.length ? grilla[siguiente] || [] : null;
        const siguienteEsOtroBloque =
            filaSiguiente !== null &&
            (esFilaCabeceraDias(filaSiguiente) || Boolean(buscarCampo(filaSiguiente, ['ID']).valor));
        const tieneFilaDeMarcas = filaSiguiente !== null && !siguienteEsOtroBloque;

        const marcas = new Map();
        if (tieneFilaDeMarcas) {
            for (const [dia, columna] of cabecera.mapa) {
                if (columna >= filaSiguiente.length) continue;
                const horas = extraerHoras(filaSiguiente[columna]);
                if (horas.length) marcas.set(dia, horas);
            }
        } else {
            avisos.push(`Fila ${fila + 1}: el funcionario con ID ${id} no tiene fila de marcaciones.`);
        }

        if (porId.has(id)) {
            const existente = porId.get(id);
            avisos.push(`ID ${id} repetido ('${existente.nombre}' / '${nombre}'): se fusionan los dias.`);
            for (const [dia, horas] of marcas) existente.marcas.set(dia, horas);
            if (!existente.nombre && nombre) existente.nombre = nombre;
        } else {
            const registro = { id, nombre, departamento, marcas };
            porId.set(id, registro);
            funcionarios.push(registro);
        }

        fila = tieneFilaDeMarcas ? siguiente + 1 : fila + 1;
    }

    if (funcionarios.length === 0) {
        avisos.push("No se encontro ninguna fila de funcionario (etiqueta 'ID:').");
    }

    const registros = [];
    for (const funcionario of funcionarios) {
        for (const dia of [...funcionario.marcas.keys()].sort((a, b) => a - b)) {
            const horas = funcionario.marcas.get(dia);
            registros.push({
                biometricId: funcionario.id,
                nombre: funcionario.nombre,
                departamento: funcionario.departamento,
                fecha: `${anio}-${pad2(mes)}-${pad2(dia)}`,
                entrada: parseHora(horas[0]),
                salida: horas.length > 1 ? parseHora(horas[horas.length - 1]) : null,
                marcas: horas,
            });
        }
    }

    return {
        formato: 'bloques',
        periodo: {
            anio,
            mes,
            desde: periodoDetectado?.desde || null,
            hasta: periodoDetectado?.hasta || null,
        },
        dias,
        funcionarios,
        registros,
        avisos,
    };
}
