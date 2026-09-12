import { describe, it, expect } from 'vitest';
import {
    REGLAS_PLANILLA,
    MODO_TARDANZA,
    normalizarCedula,
    normalizarTexto,
    minutosATexto,
    parseHora,
    parseFecha,
    diasEsperados,
    calcularTardanza,
    calcularAusencia,
    detectarColumnas,
    detectarCabeceraDias,
    detectarPeriodoBloques,
    diaSemanaDe,
    esDiaLibre,
    etiquetaDiaLibre,
    parsearBloquesAsistencia,
    razonDescuento,
    construirIndiceEmpleados,
    resolverFuncionario,
    evaluarAsistencia,
    resumenDescuento,
} from '../public/js/planilla.js';

const SALARIO = 2400000; // valor dia = 80.000
const VALOR_DIA = 80000;

const EMPLEADOS = [
    { id: 'e1', fullName: 'ANA GOMEZ', dni: '1.234.567', branch: 'MR LIN', salary: SALARIO, status: 'ACTIVO' },
    { id: 'e2', fullName: 'LUIS BENITEZ', dni: '7654321', branch: 'MR LIN', salary: SALARIO, status: 'ACTIVO' },
];

describe('planilla · normalizacion', () => {
    it('quita acentos, espacios dobles y mayusculas', () => {
        expect(normalizarTexto('  José   PÉREZ ')).toBe('JOSE PEREZ');
        expect(normalizarTexto(null)).toBe('');
    });

    it('compara cedulas sin puntos, guiones ni ceros iniciales', () => {
        expect(normalizarCedula('889.605.872-49')).toBe('88960587249');
        expect(normalizarCedula('0984108734')).toBe('984108734');
        expect(normalizarCedula('')).toBe('');
    });

    it('formatea minutos como HH:MM', () => {
        expect(minutosATexto(0)).toBe('00:00');
        expect(minutosATexto(95)).toBe('01:35');
    });
});

describe('planilla · parseHora', () => {
    it('lee horas en los formatos habituales de los relojes', () => {
        expect(parseHora('07:35')).toBe(455);
        expect(parseHora('7:35:12')).toBe(455);
        expect(parseHora('08:00:00')).toBe(480);
        expect(parseHora('07:35 p.m.')).toBe(1175);
        expect(parseHora('12:05 a.m.')).toBe(5);
    });

    it('lee la hora embebida en una fecha y el serial de Excel', () => {
        expect(parseHora('2026-08-31 07:35:00')).toBe(455);
        expect(parseHora(1 / 3)).toBe(480);
    });

    it('devuelve null cuando la celda no tiene hora', () => {
        expect(parseHora('')).toBeNull();
        expect(parseHora('AUSENTE')).toBeNull();
        expect(parseHora(null)).toBeNull();
    });
});

describe('planilla · parseFecha', () => {
    it('lee DD/MM/YYYY, ISO, dos digitos y serial de Excel', () => {
        expect(parseFecha('31/08/2026')).toBe('2026-08-31');
        expect(parseFecha('2026-08-31')).toBe('2026-08-31');
        expect(parseFecha('31-08-26')).toBe('2026-08-31');
        expect(parseFecha(45292)).toBe('2024-01-01');
    });

    it('devuelve null si la celda no es una fecha', () => {
        expect(parseFecha('')).toBeNull();
        expect(parseFecha('HOLA')).toBeNull();
    });
});

describe('planilla · dias esperados', () => {
    it('filtra por dia de la semana y rango del periodo', () => {
        // Septiembre 2026: el 1 cae martes.
        expect(diasEsperados(2026, 9, { diasSemana: [1] })).toEqual([
            '2026-09-07',
            '2026-09-14',
            '2026-09-21',
            '2026-09-28',
        ]);
        expect(diasEsperados(2026, 9, { desde: '2026-09-29' })).toEqual(['2026-09-29', '2026-09-30']);
    });
});

describe('planilla · reglas de descuento', () => {
    it('no descuenta dentro de la gracia de 29 minutos', () => {
        expect(calcularTardanza(0, SALARIO).modo).toBe(MODO_TARDANZA.EN_GRACIA);
        expect(calcularTardanza(29, SALARIO).monto).toBe(0);
        expect(calcularTardanza(29, SALARIO).minutos).toBe(29);
    });

    it('descuenta Gs. 30.000 por cada bloque de 30 minutos desde el minuto 30', () => {
        expect(calcularTardanza(30, SALARIO)).toMatchObject({ bloques: 1, monto: 30000 });
        expect(calcularTardanza(59, SALARIO).monto).toBe(30000);
        expect(calcularTardanza(60, SALARIO).monto).toBe(60000);
        expect(calcularTardanza(90, SALARIO).monto).toBe(90000);
        expect(calcularTardanza(120, SALARIO).monto).toBe(120000);
    });

    it('con mas de 2 horas aplica 1 dia completo (salario / 30)', () => {
        const resultado = calcularTardanza(121, SALARIO);
        expect(resultado.modo).toBe(MODO_TARDANZA.DIA_COMPLETO);
        expect(resultado.dias).toBe(1);
        expect(resultado.monto).toBe(VALOR_DIA);
    });

    it('puede tomar el mayor entre 1 dia y los bloques (opcion documentada)', () => {
        const reglas = { ...REGLAS_PLANILLA, usarMayorEnDiaCompleto: true };
        expect(calcularTardanza(121, SALARIO, reglas).monto).toBe(120000);
    });

    it('admite contar los bloques iniciados (opcion de negocio)', () => {
        const reglas = { ...REGLAS_PLANILLA, modoBloques: 'iniciados' };
        expect(calcularTardanza(31, SALARIO, reglas).monto).toBe(60000);
        expect(calcularTardanza(31, SALARIO).monto).toBe(30000);
    });

    it('la ausencia descuenta 1 dia completo', () => {
        expect(calcularAusencia(SALARIO)).toEqual({ dias: 1, monto: VALOR_DIA });
        expect(calcularAusencia(0).monto).toBe(0);
    });
});

describe('planilla · deteccion de columnas', () => {
    it('reconoce los encabezados tipicos de un export de reloj', () => {
        const columnas = detectarColumnas(['ID', 'Nombre', 'Fecha', 'Entrada', 'Salida']);
        expect(columnas).toMatchObject({ biometricId: 0, nombre: 1, fecha: 2, entrada: 3, salida: 4 });
    });

    it('"No. Empleado" se lee como ID y no como nombre', () => {
        const columnas = detectarColumnas(['No. Empleado', 'Nombre y Apellido', 'Fecha', 'Hora Entrada']);
        expect(columnas).toMatchObject({ biometricId: 0, nombre: 1, fecha: 2, entrada: 3 });
    });

    it('deja en null las columnas que no reconoce', () => {
        expect(detectarColumnas(['A', 'B']).fecha).toBeNull();
    });

    it('reconoce la salida del parser Python de la planilla por bloques', () => {
        // Contrato con scripts/parse_asistencia.py: estas columnas deben mapear
        // solas para que el CSV del parser se pueda importar sin tocar nada.
        const columnas = detectarColumnas([
            'ID',
            'NOMBRE',
            'DEPARTAMENTO',
            'FECHA',
            'DIA',
            'ENTRADA',
            'SALIDA',
            'MARCADAS',
        ]);
        expect(columnas).toMatchObject({ biometricId: 0, nombre: 1, fecha: 3, entrada: 5, salida: 6 });
    });
});

describe('planilla · mapeo de funcionarios', () => {
    it('prefiere al activo cuando la cedula esta duplicada', () => {
        const indice = construirIndiceEmpleados([
            { id: 'a', fullName: 'WILLIAM A', dni: '7034253', status: 'INACTIVO' },
            { id: 'b', fullName: 'WILLIAM B', dni: '7034253', status: 'ACTIVO' },
        ]);
        expect(resolverFuncionario({ biometricId: '7034253' }, indice).id).toBe('b');
    });

    it('resuelve por id interno, por cedula y por nombre normalizado', () => {
        const indice = construirIndiceEmpleados(EMPLEADOS);
        expect(resolverFuncionario({ biometricId: 'e2' }, indice).id).toBe('e2');
        expect(resolverFuncionario({ biometricId: '1234567' }, indice).id).toBe('e1');
        expect(resolverFuncionario({ nombre: 'ana  gómez' }, indice).id).toBe('e1');
        expect(resolverFuncionario({ biometricId: 'x', nombre: 'NADIE' }, indice)).toBeNull();
    });

    it('acepta el nombre truncado del reloj solo si es inequivoco', () => {
        const indice = construirIndiceEmpleados([
            { id: 'a', fullName: 'GABRIEL PEREZ GOMEZ', dni: '111' },
            { id: 'b', fullName: 'MARIA LOPEZ', dni: '222' },
        ]);

        // 'GABRIEL PEREZ' identifica a un solo funcionario.
        expect(resolverFuncionario({ nombre: 'Gabriel Perez' }, indice).id).toBe('a');
        // Un nombre generico no debe elegir a cualquiera.
        expect(resolverFuncionario({ nombre: 'GABRIEL' }, indice).id).toBe('a');
        expect(resolverFuncionario({ nombre: 'JUAN' }, indice)).toBeNull();
    });
});

describe('planilla · evaluacion completa', () => {
    const dias = ['2026-09-01', '2026-09-02', '2026-09-03'];

    it('aplica tardanzas y ausencias sobre el periodo', () => {
        const { filas, totales } = evaluarAsistencia({
            empleados: EMPLEADOS,
            dias,
            asistencias: [
                { biometricId: '1234567', fecha: '2026-09-01', entrada: parseHora('08:45') },
                { biometricId: '1234567', fecha: '2026-09-02', entrada: parseHora('08:20') },
                { biometricId: '7654321', fecha: '2026-09-01', entrada: parseHora('08:00') },
            ],
        });

        const e1 = filas.find((fila) => fila.employeeId === 'e1');
        expect(e1).toMatchObject({
            tardanzas: 1,
            minutosRetraso: 45,
            ausencias: 1,
            diasDescontados: 1,
            montoTardanzas: 30000,
            montoAusencias: VALOR_DIA,
            montoTotal: 110000,
        });

        const e2 = filas.find((fila) => fila.employeeId === 'e2');
        expect(e2).toMatchObject({ tardanzas: 0, ausencias: 2, montoTotal: 160000 });

        expect(totales).toMatchObject({ funcionarios: 2, tardanzas: 1, ausencias: 3, montoTotal: 270000 });
    });

    it('incluye a los funcionarios sin marcaciones y lo advierte', () => {
        const { filas } = evaluarAsistencia({ empleados: EMPLEADOS, dias, asistencias: [] });
        expect(filas).toHaveLength(2);
        expect(filas[0].ausencias).toBe(3);
        expect(filas[0].advertencias).toHaveLength(1);
    });

    it('separa las marcaciones sin funcionario y las de otro periodo', () => {
        const { sinMapear, fueraDePeriodo } = evaluarAsistencia({
            empleados: EMPLEADOS,
            dias,
            asistencias: [
                { biometricId: '999999', nombre: 'DESCONOCIDO', fecha: '2026-09-01', entrada: 500 },
                { biometricId: '1234567', fecha: '2026-08-31', entrada: 500 },
            ],
        });
        expect(sinMapear).toHaveLength(1);
        expect(fueraDePeriodo).toHaveLength(1);
    });

    it('ignora a los inactivos que no marcan y respeta la fecha de ingreso', () => {
        const empleados = [
            ...EMPLEADOS,
            { id: 'e3', fullName: 'VIEJO', dni: '111', salary: SALARIO, status: 'INACTIVO' },
            { id: 'e4', fullName: 'NUEVO', dni: '222', salary: SALARIO, status: 'ACTIVO', startDate: '2026-09-03' },
        ];
        const { filas } = evaluarAsistencia({ empleados, dias, asistencias: [] });
        expect(filas.map((fila) => fila.employeeId)).toEqual(['e1', 'e2', 'e4']);

        const nuevo = filas.find((fila) => fila.employeeId === 'e4');
        expect(nuevo.diasEsperados).toBe(1);
        expect(nuevo.ausencias).toBe(1);
    });

    it('toma la hora de entrada configurada por funcionario o sucursal', () => {
        const { filas } = evaluarAsistencia({
            empleados: [EMPLEADOS[0]],
            dias: ['2026-09-01'],
            horaEntradaPorFuncionario: { e1: parseHora('09:00') },
            asistencias: [{ biometricId: '1234567', fecha: '2026-09-01', entrada: parseHora('09:31') }],
        });
        // 31 minutos sobre las 09:00 -> 1 bloque completo de 30 min.
        expect(filas[0].minutosRetraso).toBe(31);
        expect(filas[0].montoTardanzas).toBe(30000);
    });

    it('arma el motivo del descuento para el modulo de Descuentos', () => {
        expect(resumenDescuento({ tardanzas: 2, minutosRetraso: 75, ausencias: 1 })).toBe(
            'PLANILLA ASISTENCIA: 2 tardanza(s) / 01:15 - 1 ausencia(s)'
        );
    });
});

// ---------------------------- Reporte del reloj (matriz por bloques) ----------------------------

const DIAS_MES = Array.from({ length: 31 }, (_valor, indice) => indice + 1);

// Replica la estructura del archivo real del reloj (plamnilla.xlsx): titulo,
// periodo en la col C, cabecera de dias 1..31 y un par de filas por funcionario
// (datos + marcaciones). La fila de marcaciones puede quedar vacia.
function grillaReporteReloj(empleados, { offsetDias = 0, periodo = '2026-08-01 ~ 2026-08-31' } = {}) {
    const ancho = offsetDias + 31;
    const vacia = () => Array.from({ length: ancho }, () => null);

    const filaDias = vacia();
    DIAS_MES.forEach((dia, indice) => {
        filaDias[offsetDias + indice] = dia;
    });

    const filaPeriodo = vacia();
    filaPeriodo[0] = 'Periodo:';
    filaPeriodo[2] = periodo;

    const filas = [['Reporte de Eventos de Asistencia', ...vacia().slice(1)], vacia(), filaPeriodo, filaDias];

    for (const empleado of empleados) {
        const datos = vacia();
        datos[0] = 'ID:';
        datos[2] = empleado.id; // el reloj se carga con la CEDULA del funcionario
        datos[8] = 'Nombre:';
        datos[10] = empleado.nombre;
        datos[18] = 'Departamento:';
        datos[20] = 'Empresa';
        filas.push(datos);

        const marcas = vacia();
        for (const [dia, hora] of Object.entries(empleado.marcas || {})) {
            marcas[offsetDias + Number(dia) - 1] = hora;
        }
        filas.push(marcas);
    }

    return filas;
}

describe('planilla · reporte del reloj (matriz por bloques)', () => {
    const empleados = [
        { id: '1234567', nombre: 'PEREZ', marcas: { 1: '08:00', 2: '08:35', 4: '08:00' } },
        { id: '7654321', nombre: 'LOPEZ', marcas: {} }, // fila de marcaciones vacia
    ];

    it('detecta la cabecera de dias y el periodo', () => {
        const grilla = grillaReporteReloj(empleados);
        const cabecera = detectarCabeceraDias(grilla);

        expect(cabecera.fila).toBe(3);
        expect(cabecera.mapa.get(1)).toBe(0);
        expect(cabecera.mapa.get(31)).toBe(30);
        expect(detectarPeriodoBloques(grilla, 3)).toEqual({
            anio: 2026,
            mes: 8,
            desde: '2026-08-01',
            hasta: '2026-08-31',
        });
    });

    it('extrae funcionario, ID, nombre, departamento y marcas por dia', () => {
        const bloque = parsearBloquesAsistencia(grillaReporteReloj(empleados));

        expect(bloque.formato).toBe('bloques');
        expect(bloque.dias).toHaveLength(31);
        expect(bloque.funcionarios).toHaveLength(2);
        expect(bloque.registros).toHaveLength(3);
        expect(bloque.avisos).toEqual([]);

        const perez = bloque.funcionarios[0];
        expect(perez).toMatchObject({ id: '1234567', nombre: 'PEREZ', departamento: 'Empresa' });
        expect([...perez.marcas.keys()]).toEqual([1, 2, 4]);
        expect(perez.marcas.get(2)).toEqual(['08:35']);

        expect(bloque.funcionarios[1].marcas.size).toBe(0);
        expect(bloque.registros[0]).toMatchObject({
            biometricId: '1234567',
            fecha: '2026-08-01',
            entrada: parseHora('08:00'),
            marcas: ['08:00'],
        });
    });

    it('funciona igual si las columnas de dias arrancan corridas', () => {
        const bloque = parsearBloquesAsistencia(grillaReporteReloj(empleados, { offsetDias: 6 }));
        expect(bloque.funcionarios[0].marcas.get(1)).toEqual(['08:00']);
        expect(bloque.registros[0].fecha).toBe('2026-08-01');
    });

    it('separa varias marcas de una celda en entrada y salida', () => {
        const bloque = parsearBloquesAsistencia(
            grillaReporteReloj([{ id: '555', nombre: 'MULTI', marcas: { 3: '08:00 12:00 13:00 18:00' } }])
        );

        expect(bloque.registros[0]).toMatchObject({ entrada: parseHora('08:00'), salida: parseHora('18:00') });
        expect(bloque.registros[0].marcas).toEqual(['08:00', '12:00', '13:00', '18:00']);
    });

    it('devuelve null cuando el archivo no es el reporte del reloj', () => {
        const tabla = [
            ['ID', 'Nombre', 'Fecha', 'Entrada'],
            ['1', 'X', '2026-08-01', '08:00'],
        ];
        expect(parsearBloquesAsistencia(tabla)).toBeNull();
    });
});

describe('planilla · cruce por cedula y razon del descuento', () => {
    it('cruza el ID del reloj con la cedula del funcionario', () => {
        const bloque = parsearBloquesAsistencia(
            grillaReporteReloj([{ id: '1.234.567', nombre: 'PEREZ', marcas: { 1: '08:35', 2: '10:30' } }])
        );
        const dias = bloque.dias.map((dia) => `2026-08-${String(dia).padStart(2, '0')}`);

        const { filas } = evaluarAsistencia({
            asistencias: bloque.registros,
            empleados: [EMPLEADOS[0]], // EMPLEADOS[0].dni = '1.234.567'
            dias,
            horaEntradaDefecto: '08:00',
        });

        expect(filas).toHaveLength(1);
        expect(filas[0].tardanzas).toBe(2);
        expect(filas[0].minutosRetraso).toBe(185);
        expect(razonDescuento(filas[0])).toContain(
            'HORARIOS TARDIOS EN FECHAS 01/08 08:35 (35 min, Gs. 30.000), 02/08 10:30 (150 min, Gs. 80.000)'
        );
        expect(razonDescuento(filas[0])).toContain('FECHAS AUSENTES');
    });

    it('arma la razon con ausencias y horarios tardios', () => {
        const fila = {
            fechasAusentes: ['2026-08-04', '2026-08-11'],
            detalle: [{ fecha: '2026-08-02', entrada: parseHora('08:35'), minutos: 35, monto: 30000 }],
        };
        expect(razonDescuento(fila)).toBe(
            'RAZON: (FECHAS AUSENTES 04/08, 11/08; HORARIOS TARDIOS EN FECHAS 02/08 08:35 (35 min, Gs. 30.000))'
        );
    });
});

describe('planilla · dia libre en la ficha del funcionario', () => {
    const diasDeAgosto = Array.from(
        { length: 31 },
        (_valor, indice) => `2026-08-${String(indice + 1).padStart(2, '0')}`
    );

    it('calcula el dia de la semana de una fecha ISO', () => {
        expect(diaSemanaDe('2026-08-01')).toBe(6); // sabado
        expect(diaSemanaDe('2026-08-02')).toBe(0); // domingo
        expect(diaSemanaDe('2026-08-04')).toBe(2); // martes
        expect(diaSemanaDe('no-es-fecha')).toBeNull();
    });

    it('reconoce el dia libre configurado (acepta numero o texto)', () => {
        expect(esDiaLibre('2026-08-02', 0)).toBe(true);
        expect(esDiaLibre('2026-08-02', '0')).toBe(true);
        expect(esDiaLibre('2026-08-02', 2)).toBe(false);
        expect(esDiaLibre('2026-08-02', null)).toBe(false);
        expect(esDiaLibre('2026-08-02', '')).toBe(false);
        expect(etiquetaDiaLibre(0)).toBe('Domingo');
        expect(etiquetaDiaLibre('2')).toBe('Martes');
    });

    it('excluye el dia libre de los dias esperados (sucursal con libre rotativo)', () => {
        const { filas } = evaluarAsistencia({
            empleados: [
                { id: 'dom', fullName: 'LIBRA DOMINGO', dni: '111', salary: SALARIO, status: 'ACTIVO', diaLibre: 0 },
                { id: 'mar', fullName: 'LIBRA MARTES', dni: '222', salary: SALARIO, status: 'ACTIVO', diaLibre: 2 },
                { id: 'nada', fullName: 'SIN DIA LIBRE', dni: '333', salary: SALARIO, status: 'ACTIVO' },
            ],
            dias: diasDeAgosto,
            asistencias: [],
        });

        const domingo = filas.find((fila) => fila.employeeId === 'dom');
        const martes = filas.find((fila) => fila.employeeId === 'mar');
        const sinLibre = filas.find((fila) => fila.employeeId === 'nada');

        expect(domingo.diasEsperados).toBe(26); // 31 dias - 5 domingos
        expect(martes.diasEsperados).toBe(27); // 31 dias - 4 martes
        expect(sinLibre.diasEsperados).toBe(31);

        expect(domingo.fechasAusentes).not.toContain('2026-08-02');
        expect(domingo.fechasAusentes).toContain('2026-08-03');
        expect(martes.fechasAusentes).not.toContain('2026-08-04');
        expect(domingo.diaLibre).toBe(0);
    });

    it('ignora la marcacion hecha en el dia libre', () => {
        const { filas } = evaluarAsistencia({
            empleados: [
                { id: 'dom', fullName: 'LIBRA DOMINGO', dni: '111', salary: SALARIO, status: 'ACTIVO', diaLibre: 0 },
            ],
            dias: ['2026-08-02'], // domingo
            asistencias: [{ biometricId: '111', fecha: '2026-08-02', entrada: parseHora('11:30') }],
        });

        expect(filas[0].diasEsperados).toBe(0);
        expect(filas[0].tardanzas).toBe(0);
        expect(filas[0].ausencias).toBe(0);
        expect(filas[0].montoTotal).toBe(0);
    });

    it('encuentra la sucursal aunque la clave no este en mayusculas', () => {
        const { filas } = evaluarAsistencia({
            empleados: [
                { id: 'e1', fullName: 'X', dni: '111', salary: SALARIO, status: 'ACTIVO', branch: 'MR LIN RESTAURANT' },
            ],
            dias: diasDeAgosto,
            asistencias: [],
            diaLibrePorSucursal: { '  mr lin restaurant ': 0 },
        });

        expect(filas[0].diaLibre).toBe(0);
        expect(filas[0].diasEsperados).toBe(26);
    });

    it('hereda el dia libre de la sucursal y la ficha lo puede sobreescribir', () => {
        const { filas } = evaluarAsistencia({
            empleados: [
                {
                    id: 'hereda',
                    fullName: 'HEREDA',
                    dni: '111',
                    salary: SALARIO,
                    status: 'ACTIVO',
                    branch: 'MR LIN RESTAURANT',
                },
                {
                    id: 'propio',
                    fullName: 'PROPIO',
                    dni: '222',
                    salary: SALARIO,
                    status: 'ACTIVO',
                    branch: 'MR LIN RESTAURANT',
                    diaLibre: 2,
                },
                {
                    id: 'suelto',
                    fullName: 'SUELTO',
                    dni: '333',
                    salary: SALARIO,
                    status: 'ACTIVO',
                    branch: 'SIN CONFIGURAR',
                },
            ],
            dias: diasDeAgosto,
            asistencias: [],
            diaLibrePorSucursal: { 'MR LIN RESTAURANT': 0 },
        });

        const hereda = filas.find((fila) => fila.employeeId === 'hereda');
        const propio = filas.find((fila) => fila.employeeId === 'propio');
        const suelto = filas.find((fila) => fila.employeeId === 'suelto');

        expect(hereda.diaLibre).toBe(0);
        expect(hereda.diasEsperados).toBe(26); // domingos fuera
        expect(hereda.fechasAusentes).not.toContain('2026-08-02');

        expect(propio.diaLibre).toBe(2); // la ficha gana sobre la sucursal
        expect(propio.diasEsperados).toBe(27); // martes fuera

        expect(suelto.diaLibre).toBeNull();
        expect(suelto.diasEsperados).toBe(31);
    });
});
