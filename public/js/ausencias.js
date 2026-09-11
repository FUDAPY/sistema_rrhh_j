// public/js/ausencias.js
import { collection, addDoc, serverTimestamp, deleteDoc, doc } from './db.js';
import { db } from './firebase-config.js';
import { uiConfirm } from './ui.js';

let _toast = null;

// ==========================================
// 1. LISTENERS GLOBALES
// ==========================================
export function initAusenciasListeners(toastCb) {
    _toast = toastCb;

    window.deleteAusencia = async (id) => {
        const confirmado = await uiConfirm({
            title: 'Eliminar registro',
            message:
                '¿Eliminar este registro del sistema? (Atención: deberá reversar manualmente los descuentos si ya liquidó el salario).',
            tone: 'danger',
            confirmText: 'Eliminar',
        });
        if (!confirmado) return;
        try {
            await deleteDoc(doc(db, 'ausencias', id));
            if (_toast) _toast('Eliminado', 'Registro borrado exitosamente.');
        } catch (e) {
            console.error(e);
        }
    };
}

// ==========================================
// 2. LÓGICA DE REGISTRO (CON CÁLCULOS AUTOMÁTICOS)
// ==========================================
export function setupCreateAusenciaLogic(toastCb) {
    const form = document.getElementById('ausenciaForm');
    if (!form) return;

    // --- HELPER: Calcula la diferencia en minutos entre dos horas (HH:MM) ---
    const getMinutesDiff = (entradaFija, entradaReal) => {
        if (!entradaFija || !entradaReal) return 0;
        const [h1, m1] = entradaFija.split(':').map(Number);
        const [h2, m2] = entradaReal.split(':').map(Number);

        const minutosFija = h1 * 60 + m1;
        const minutosReal = h2 * 60 + m2;

        const diff = minutosReal - minutosFija;
        return diff > 0 ? diff : 0; // Solo cuenta si llegó tarde
    };

    // --- HELPER: Extrae números de "Gs. 2.500.000" ---
    const parseDinero = (val) => {
        if (!val) return 0;
        return Number(String(val).replace(/\D/g, '')) || 0;
    };

    // Dinamismo del formulario (Mostrar/Ocultar campos según el tipo)
    const typeSelect = document.getElementById('aus-type');
    const containerFechas = document.getElementById('containerFechas');
    const containerHoras = document.getElementById('containerHoras');
    const empSelect = document.getElementById('aus-emp');

    typeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Llegada Tardia') {
            containerFechas.classList.add('hidden');
            containerHoras.classList.remove('hidden');

            // Auto-seleccionar fecha de hoy para la llegada tardía
            document.getElementById('aus-date-tardia').value = new Date().toISOString().split('T')[0];
        } else {
            containerFechas.classList.remove('hidden');
            containerHoras.classList.add('hidden');
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const empId = document.getElementById('aus-emp').value;
        const type = document.getElementById('aus-type').value;
        const reason = document.getElementById('aus-reason').value;

        // Datos del Empleado Seleccionado (del dataset del option)
        const selectedOption = empSelect.options[empSelect.selectedIndex];
        const empName = selectedOption.text;
        const empBranch = selectedOption.dataset.branch;
        const empSalary = parseDinero(selectedOption.dataset.salary);
        const branchEntrada = selectedOption.dataset.entrada;

        if (!empId) return toastCb('Error', 'Seleccione un funcionario.');

        let registro = {
            employeeId: empId,
            employeeName: empName,
            branch: empBranch,
            type: type,
            reason: reason,
            createdAt: serverTimestamp(),
            status: 'Procesado', // Para que pueda filtrarse después
        };

        // ==========================================
        // CÁLCULO A: LLEGADA TARDÍA (REGLA DE MINUTOS)
        // ==========================================
        if (type === 'Llegada Tardia') {
            const fecha = document.getElementById('aus-date-tardia').value;
            const horaLlegada = document.getElementById('aus-hora').value;

            if (!fecha || !horaLlegada) return toastCb('Error', 'Ingrese la fecha y la hora de llegada.');
            if (!branchEntrada)
                return toastCb(
                    'Atención',
                    `La sucursal ${empBranch} no tiene horario de entrada configurado en el sistema.`
                );

            const minutosTarde = getMinutesDiff(branchEntrada, horaLlegada);

            let multa = 0;
            if (minutosTarde <= 0) {
                return toastCb('Aviso', 'El horario ingresado NO es tardío según la sucursal.');
            } else if (minutosTarde <= 29) {
                multa = 5000;
            } else if (minutosTarde >= 30 && minutosTarde <= 59) {
                multa = 10000;
            } else if (minutosTarde >= 60) {
                multa = 20000;
            }

            const confirmado = await uiConfirm({
                title: 'Confirmar tardanza',
                message: `Resumen Llegada Tardía:\n- Horario Sucursal: ${branchEntrada}\n- Llegó: ${horaLlegada}\n- Minutos tarde: ${minutosTarde} min.\n\n>> MULTA A APLICAR: Gs. ${multa.toLocaleString()}\n\n¿Confirmar y aplicar descuento?`,
                tone: 'warning',
                confirmText: 'Aplicar descuento',
            });
            if (!confirmado) return;

            registro.date = fecha;
            registro.llegadaFija = branchEntrada;
            registro.llegadaReal = horaLlegada;
            registro.minutosTarde = minutosTarde;
            registro.montoDescuento = multa;
            registro.detail = `Tardanza: ${minutosTarde} min (${horaLlegada})`;
        }
        // ==========================================
        // CÁLCULO B: AUSENCIAS (REGLA DE / 30)
        // ==========================================
        else {
            const start = document.getElementById('aus-start').value;
            const end = document.getElementById('aus-end').value;

            if (!start || !end) return toastCb('Error', 'Complete las fechas de inicio y fin.');
            if (new Date(end) < new Date(start))
                return toastCb('Error', 'La fecha fin no puede ser anterior al inicio.');

            // Calcular días (incluso si es 1 solo día)
            const d1 = new Date(start + 'T00:00:00');
            const d2 = new Date(end + 'T00:00:00');
            const diffTime = Math.abs(d2 - d1);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 para incluir ambos días

            let multa = 0;
            // Solo descontamos plata si es Falta Injustificada
            if (type === 'Falta Injustificada') {
                multa = Math.floor((empSalary / 30) * diffDays);
                const confirmado = await uiConfirm({
                    title: 'Confirmar falta',
                    message: `Resumen de Falta:\n- Días ausente: ${diffDays}\n- Salario Diario: Gs. ${Math.floor(empSalary / 30).toLocaleString()}\n\n>> DESCUENTO A APLICAR: Gs. ${multa.toLocaleString()}\n\n¿Confirmar?`,
                    tone: 'warning',
                    confirmText: 'Aplicar descuento',
                });
                if (!confirmado) return;
            }

            registro.startDate = start;
            registro.endDate = end;
            registro.dias = diffDays;
            registro.montoDescuento = multa; // 0 si es Vacaciones, Enfermedad, etc.
            registro.date = start; // Usamos el inicio para la liquidación mensual
            registro.detail = `${type} (${diffDays} días)`;
        }

        const btn = form.querySelector('button[type="submit"]');
        const oldText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> PROCESANDO...';

        try {
            // 1. GUARDAMOS EL REGISTRO DE CONTROL (AUDITORÍA)
            await addDoc(collection(db, 'ausencias'), registro);

            // 2. SI HAY MULTA, LA ENVIAMOS DIRECTO AL MÓDULO DE DESCUENTOS PARA QUE AFECTE EL SALARIO
            if (registro.montoDescuento > 0) {
                await addDoc(collection(db, 'descuentos'), {
                    employeeId: empId,
                    amount: registro.montoDescuento,
                    reason: registro.detail,
                    date: registro.date, // Para que descuente en el mes correcto
                    createdAt: serverTimestamp(),
                    status: 'Aplicado',
                });
            }

            toastCb('Completado', 'Control de Asistencia registrado. Descuentos aplicados si corresponde.');
            form.reset();
            // Restaurar vista por defecto
            containerFechas.classList.remove('hidden');
            containerHoras.classList.add('hidden');
        } catch (error) {
            console.error(error);
            toastCb('Error', 'Fallo de conexión al guardar.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    });
}

// ==========================================
// 3. VISTA: FORMULARIO
// ==========================================
export function getViewCreateAusencia(employees) {
    // FILTRAMOS SOLO ACTIVOS PARA ASIGNARLES FALTAS O TARDANZAS
    const activos = employees
        .filter((e) => e.status !== 'INACTIVO')
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Ojo a los data-attributes, son vitales para los cálculos en el JS
    const optionsHtml = activos
        .map(
            (e) => `
        <option value="${e.id}" data-salary="${e.salary}" data-branch="${e.branch}" data-entrada="${e.horarioEntrada || '07:00'}">
            ${e.fullName} (${e.branch})
        </option>
    `
        )
        .join('');

    return `
        <div class="max-w-4xl mx-auto bg-white p-10 rounded-[40px] shadow-2xl border border-rose-50 fade-in">
            <div class="flex items-center justify-between mb-8 pb-6 border-b border-slate-100">
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center text-3xl shadow-sm">
                        <i class="ph-fill ph-clock-user"></i>
                    </div>
                    <div>
                        <h3 class="text-2xl font-black text-slate-800 tracking-tight">Control de Asistencia</h3>
                        <p class="text-rose-500 font-bold text-xs uppercase tracking-widest">Faltas y Llegadas Tardías</p>
                    </div>
                </div>
            </div>

            <form id="ausenciaForm" class="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                <div class="md:col-span-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Funcionario (Activo)</label>
                    <div class="relative">
                        <select id="aus-emp" required class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-rose-400 appearance-none shadow-sm cursor-pointer">
                            <option value="">Seleccione al colaborador...</option>
                            ${optionsHtml}
                        </select>
                        <i class="ph-bold ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-lg"></i>
                    </div>
                </div>

                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Tipo de Registro</label>
                    <div class="relative">
                        <select id="aus-type" required class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-rose-400 appearance-none cursor-pointer">
                            <option value="Falta Injustificada">❌ Falta Injustificada (Descuenta Sueldo)</option>
                            <option value="Llegada Tardia">⏰ Llegada Tardía (Multa por minutos)</option>
                            <option value="Enfermedad">🏥 Enfermedad / Reposo Médico (Justificado)</option>
                            <option value="Permiso">👤 Permiso Personal (Justificado)</option>
                            <option value="Vacaciones">✈️ Vacaciones (Justificado)</option>
                            <option value="Maternidad">👶 Maternidad / Paternidad (Justificado)</option>
                        </select>
                        <i class="ph-bold ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
                    </div>
                </div>

                <div>
                     <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Motivo / Observación</label>
                     <input type="text" id="aus-reason" placeholder="Ej: Retraso por lluvia, Certificado IPS..." class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold outline-none focus:border-rose-400 text-slate-700">
                </div>

                <div id="containerFechas" class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8 p-6 bg-slate-50 border border-slate-100 rounded-[30px] animate-fade-in">
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Ausente Desde</label>
                        <input type="date" id="aus-start" class="w-full border-2 border-white p-4 rounded-2xl bg-white font-bold text-slate-600 outline-none focus:border-rose-400 shadow-sm cursor-pointer">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Ausente Hasta (Incluido)</label>
                        <input type="date" id="aus-end" class="w-full border-2 border-white p-4 rounded-2xl bg-white font-bold text-slate-600 outline-none focus:border-rose-400 shadow-sm cursor-pointer">
                    </div>
                </div>

                <div id="containerHoras" class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8 p-6 bg-rose-50 border border-rose-100 rounded-[30px] hidden animate-fade-in">
                    <div>
                        <label class="text-[10px] font-black text-rose-500 uppercase tracking-widest px-2 mb-1 block">Fecha de la Tardanza</label>
                        <input type="date" id="aus-date-tardia" class="w-full border-2 border-white p-4 rounded-2xl bg-white font-bold text-rose-700 outline-none focus:border-rose-400 shadow-sm cursor-pointer">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-rose-500 uppercase tracking-widest px-2 mb-1 block">Hora exacta de Llegada</label>
                        <input type="time" id="aus-hora" class="w-full border-2 border-rose-200 p-4 rounded-2xl bg-white font-black text-rose-700 outline-none focus:border-rose-500 shadow-sm cursor-pointer text-xl text-center">
                    </div>
                    <div class="md:col-span-2 text-[10px] text-rose-500 font-bold text-center bg-white py-2 rounded-xl border border-rose-100">
                        * El sistema cruzará esta hora con el Horario de Entrada de la Sucursal del empleado.
                    </div>
                </div>

                <div class="md:col-span-2 pt-4">
                    <button type="submit" class="w-full bg-slate-900 text-white py-5 rounded-[20px] font-black shadow-2xl hover:bg-rose-600 hover:-translate-y-1 active:scale-95 transition-all flex justify-center items-center gap-3">
                        <i class="ph-bold ph-calculator text-2xl"></i> PROCESAR Y APLICAR AL SALARIO
                    </button>
                </div>
            </form>
        </div>`;
}

// ==========================================
// 4. VISTA: LISTADO Y REPORTE
// ==========================================
export function getViewListAusencias(ausencias, employees) {
    const todayStr = new Date().toLocaleDateString();

    // ORDENAMOS DE MÁS RECIENTE A MÁS ANTIGUO
    const listaOrdenada = [...ausencias].sort((a, b) => {
        const da = a.createdAt ? a.createdAt.toDate() : new Date(a.startDate || a.date);
        const db = b.createdAt ? b.createdAt.toDate() : new Date(b.startDate || b.date);
        return db - da;
    });

    let filasHTML = '';

    listaOrdenada.forEach((a) => {
        const empName = a.employeeName || 'S/N';

        let color = 'bg-slate-50 text-slate-600 border-slate-200';
        if (a.type === 'Falta Injustificada') color = 'bg-red-50 text-red-600 border-red-200 font-black';
        if (a.type === 'Llegada Tardia') color = 'bg-amber-50 text-amber-700 border-amber-200 font-bold';
        if (a.type === 'Enfermedad' || a.type === 'Vacaciones') color = 'bg-sky-50 text-sky-600 border-sky-200';

        let fechaDisplay = '';
        if (a.type === 'Llegada Tardia') {
            const [y, m, d] = (a.date || '').split('-');
            fechaDisplay = `${d}/${m}/${y}`;
        } else {
            const d1 = a.startDate ? a.startDate.split('-').reverse().join('/') : '-';
            const d2 = a.endDate ? a.endDate.split('-').reverse().join('/') : '-';
            fechaDisplay = d1 === d2 ? d1 : `${d1} al ${d2}`;
        }

        filasHTML += `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-3 text-xs font-bold text-slate-800">${empName}</td>
            <td class="p-3"><span class="text-[9px] uppercase px-2 py-1 rounded-md border ${color}">${a.type}</span></td>
            <td class="p-3 text-xs text-slate-500 font-medium">${fechaDisplay}</td>
            <td class="p-3 text-[10px] text-slate-400 italic max-w-[200px] truncate" title="${a.reason || a.detail}">${a.reason || a.detail}</td>
            <td class="p-3 text-right text-xs font-black text-rose-600">${a.montoDescuento > 0 ? '-Gs. ' + a.montoDescuento.toLocaleString() : '---'}</td>
            <td class="p-3 text-center">
                <button onclick="deleteAusencia('${a.id}')" class="text-slate-300 hover:text-red-500 transition-colors"><i class="ph-bold ph-trash text-lg"></i></button>
            </td>
        </tr>`;
    });

    if (listaOrdenada.length === 0) {
        filasHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400 font-bold">No hay registros de incidencias en la base de datos.</td></tr>`;
    }

    return `
    <div class="max-w-6xl mx-auto space-y-6 fade-in pb-20">
        <div class="bg-white p-8 rounded-[40px] shadow-2xl border border-slate-50">
            <div class="flex justify-between items-center mb-8 border-b border-slate-100 pb-6">
                <div>
                    <h3 class="text-2xl font-black text-slate-800 flex items-center gap-2"><i class="ph-fill ph-clipboard-text text-blue-600"></i> Auditoría de Asistencia</h3>
                    <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Registro de Incidencias Operativas</p>
                </div>
                <button onclick="window.printReporteAsistencia()" class="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-xs shadow-lg hover:bg-blue-600 transition-colors flex items-center gap-2">
                    <i class="ph-bold ph-printer text-lg"></i> REPORTE GERENCIAL
                </button>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-100 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                            <th class="p-3 rounded-tl-xl">Colaborador</th>
                            <th class="p-3">Incidencia</th>
                            <th class="p-3">Fecha(s)</th>
                            <th class="p-3">Detalle / Motivo</th>
                            <th class="p-3 text-right">Multa (Gs)</th>
                            <th class="p-3 text-center rounded-tr-xl">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasHTML}
                    </tbody>
                </table>
            </div>
        </div>

        <div id="hiddenReportContainer" class="hidden"></div>
    </div>
    
    <script>
        window.printReporteAsistencia = () => {
            const tableHTML = document.querySelector('tbody').innerHTML;
            const ventana = window.open('', '_blank', 'width=900,height=700');
            
            ventana.document.write(\`
                <html>
                <head>
                    <title>Reporte de Asistencia</title>
                    <style>
                        body { font-family: 'Arial', sans-serif; padding: 40px; color: #111; line-height: 1.4; }
                        .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #000; padding-bottom: 20px; }
                        h1 { font-size: 24px; margin: 0 0 5px 0; letter-spacing: 2px; }
                        h2 { font-size: 14px; margin: 0; color: #444; font-weight: normal; text-transform: uppercase;}
                        table { width: 100%; border-collapse: collapse; margin-bottom: 50px; font-size: 11px; }
                        th, td { border: 1px solid #000; padding: 10px 8px; text-align: left; }
                        th { background-color: #eee; font-weight: bold; text-transform: uppercase; }
                        .text-right { text-align: right; }
                        .text-center { text-align: center; }
                        .firma-box { width: 300px; margin: 0 auto; text-align: center; border-top: 1px solid #000; padding-top: 10px; margin-top: 80px;}
                        .firma-nombre { font-size: 14px; font-weight: bold; }
                        .firma-cargo { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px;}
                        
                        /* Ocultar la columna de acciones al imprimir */
                        td:last-child, th:last-child { display: none !important; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>LIN GROUP</h1>
                        <h2>REPORTE GERENCIAL DE INCIDENCIAS Y ASISTENCIA</h2>
                        <p style="font-size: 10px; margin-top: 10px;">Fecha de Emisión: ${todayStr}</p>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Colaborador</th>
                                <th>Tipo de Incidencia</th>
                                <th>Fecha(s)</th>
                                <th>Detalle Registrado</th>
                                <th class="text-right">Multa Aplicada</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${tableHTML}
                        </tbody>
                    </table>

                    <div class="firma-box">
                        <div class="firma-nombre">GIULIANO CATELLA</div>
                        <div class="firma-cargo">ADMINISTRADOR GENERAL</div>
                    </div>
                    
                    <script>
                        window.onload = () => { window.print(); };
                    </script>
                </body>
                </html>
            \`);
            ventana.document.close();
        };
    </script>
    `;
}
