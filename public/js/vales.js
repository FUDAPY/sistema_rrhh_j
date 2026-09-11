import { collection, addDoc, serverTimestamp, updateDoc, doc } from './db.js';
import { db, auth } from './firebase-config.js';
import { uiConfirm } from './ui.js';
import * as Export from './export.js';
import { printTicket } from './print-service.js';
import { getValeAvailable, getValeLimit, isValeLimitExhausted, formatGs } from './vales-cupo.js';

let latestEmployees = [];
let latestVales = [];
let latestValesCreate = [];

function formatGsInputValue(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? new Intl.NumberFormat('es-PY').format(digits) : '';
}

function getEmployeeValeSnapshot(emp) {
    if (!emp) return { name: '', branch: '', position: '', dni: '' };
    return {
        name: emp.fullName || emp.employeeName || '',
        branch: emp.branch || emp.employeeBranch || emp.sucursal || '',
        position: emp.position || emp.employeePosition || emp.role || '',
        dni: emp.dni || emp.ci || emp.documento || emp.cedula || '',
    };
}

function buildValeCode(employeeId, baseDate, prefix = 'VAL') {
    const now = new Date();
    const localStamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const datePart =
        String(baseDate || now.toISOString().split('T')[0])
            .replace(/\D/g, '')
            .slice(0, 8) || localStamp.slice(0, 8);
    const employeePart = String(employeeId || 'SINEMP')
        .slice(-4)
        .toUpperCase();
    return `${prefix}-${datePart}-${localStamp.slice(8, 14)}-${employeePart}`;
}

// Nombre del funcionario que efectua el pago (se guarda para las reimpresiones).
function getCurrentPayerName() {
    const sessionUser = auth.currentUser;
    if (!sessionUser) return '';
    return String(sessionUser.displayName || sessionUser.email || '').trim();
}

function buildValeAuditFields(emp, valeDate, sourceModule, paymentCode) {
    const snapshot = getEmployeeValeSnapshot(emp);
    return {
        employeeName: snapshot.name,
        employeeNameUpper: snapshot.name ? snapshot.name.toUpperCase() : '',
        employeeDni: snapshot.dni,
        employeeBranch: snapshot.branch,
        employeePosition: snapshot.position,
        payerName: getCurrentPayerName(),
        valeDateKey: valeDate || '',
        sourceModule,
        paymentCode,
        approvedAt: serverTimestamp(),
        approvedAtLocal: new Date().toISOString(),
    };
}

function formatValeDate(value) {
    if (!value?.toDate) return '-';
    return value.toDate().toLocaleDateString('es-PY');
}

// ==========================================
// 1. VISTA: CREAR VALE (ADMIN)
// ==========================================
export function getViewCreateVale(employees, vales = []) {
    latestEmployees = employees;
    latestValesCreate = vales;
    const options = employees.map((e) => `<option value="${e.id}">${e.fullName}</option>`).join('');
    return `
        <div class="max-w-2xl mx-auto bg-white p-10 rounded-[40px] shadow-xl border border-amber-50 fade-in">
            <h3 class="text-2xl font-black text-slate-800 mb-8">Emitir Nuevo Vale</h3>
            <form id="createValeForm" class="space-y-6">
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Funcionario</label>
                    <div class="relative">
                        <select id="valeEmpSelect" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none appearance-none">
                            <option value="">Seleccione...</option>
                            ${options}
                        </select>
                        <i class="ph-bold ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
                    </div>
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Monto</label>
                    <input type="text" id="valeAmount" placeholder="0" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-black text-amber-500 text-lg outline-none">
                    <p id="valeCupoInfo" class="text-xs font-black mt-2 h-4"></p>
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Motivo</label>
                    <input type="text" id="valeReason" placeholder="Adelanto..." class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none">
                </div>
                <button type="submit" class="w-full bg-amber-500 text-white py-4 rounded-2xl font-black shadow-xl shadow-amber-200 hover:bg-amber-600 transition-all">REGISTRAR Y APROBAR</button>
            </form>
        </div>`;
}

let currentUserRole = 'ADMIN';

export function setValesUserRole(role) {
    if (role) currentUserRole = role;
}

export function setupCreateValeLogic(toastCb) {
    const amountInput = document.getElementById('valeAmount');
    if (amountInput) {
        amountInput.addEventListener('input', (e) => {
            e.target.value = formatGsInputValue(e.target.value);
        });
    }

    // Info de cupo (40%) usando la MISMA logica compartida que la solicitud publica
    const empSelect = document.getElementById('valeEmpSelect');
    const cupoInfo = document.getElementById('valeCupoInfo');
    if (empSelect && cupoInfo) {
        empSelect.addEventListener('change', () => {
            const emp = latestEmployees.find((e) => e.id === empSelect.value);
            if (!emp) {
                cupoInfo.textContent = '';
                return;
            }
            const limit = getValeLimit(emp.salary);
            const available = getValeAvailable(emp.salary, latestValesCreate, emp.id);
            const exhausted = isValeLimitExhausted(available);
            cupoInfo.textContent = exhausted
                ? `Cupo agotado este mes (limite Gs. ${formatGs(limit)})`
                : `Disponible este mes: Gs. ${formatGs(available)} de Gs. ${formatGs(limit)}`;
            cupoInfo.className = `text-xs font-black mt-2 h-4 ${exhausted ? 'text-rose-600' : 'text-emerald-600'}`;
        });
    }

    const form = document.getElementById('createValeForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const empId = document.getElementById('valeEmpSelect').value;
        const amount = Number((amountInput?.value || '').replace(/\./g, ''));
        const reason = document.getElementById('valeReason').value.trim();
        const selectedEmployee = latestEmployees.find((emp) => emp.id === empId);
        const snapshot = getEmployeeValeSnapshot(selectedEmployee);
        const valeDate = new Date().toISOString().split('T')[0];
        const paymentCode = buildValeCode(empId, valeDate, 'VAL');

        if (!empId || !amount) return toastCb('Error', 'Complete los datos');
        if (!snapshot.name) return toastCb('Error', 'No se pudo resolver el funcionario del vale.');

        const available = selectedEmployee ? getValeAvailable(selectedEmployee.salary, latestValesCreate, empId) : 0;
        if (selectedEmployee && amount > available) {
            toastCb(
                'Aviso',
                `El monto supera el cupo disponible del mes (Gs. ${formatGs(available)}). Se registrara igual.`
            );
        }

        try {
            const isRRHH = currentUserRole === 'RRHH';
            await addDoc(collection(db, 'vales'), {
                employeeId: empId,
                amount,
                requestedAmount: amount,
                approvedAmount: amount,
                reason,
                status: 'Aprobado',
                estadoAprobacion: isRRHH ? 'PENDIENTE_RENDICION' : 'APROBADO',
                creadoPorRol: currentUserRole,
                createdAt: serverTimestamp(),
                ...buildValeAuditFields(selectedEmployee, valeDate, 'VALE_DIRECTO', paymentCode),
            });

            toastCb('Exito', 'Vale registrado correctamente');
            form.reset();

            printTicket({
                sucursal: snapshot.branch || 'MATRIZ',
                employeeName: snapshot.name,
                employeeDni: snapshot.dni,
                employeePosition: snapshot.position,
                payerName: getCurrentPayerName(),
                paymentCode,
                type: 'VALE / ADELANTO',
                detail: reason || 'Adelanto de Salario',
                amount,
                // Siempre dos ejemplares: Administracion y Funcionario.
                doubleTicket: true,
            }).catch((err) => console.error('Error al imprimir vale:', err));
        } catch (error) {
            console.error(error);
            toastCb('Error', 'No se pudo registrar');
        }
    });
}

// ==========================================
// 2. VISTA: LISTA HISTORIAL
// ==========================================
export function getViewListVales(vales, employees) {
    latestVales = vales;
    latestEmployees = employees;

    const grouped = {};
    vales.forEach((v) => {
        if (!grouped[v.employeeId]) grouped[v.employeeId] = [];
        grouped[v.employeeId].push(v);
    });

    let html = `<div class="max-w-6xl mx-auto space-y-8 fade-in pb-20">
        <div class="flex items-center justify-between gap-3">
            <h3 class="text-2xl font-black text-slate-800">Historial de Vales</h3>
            ${Export.exportButton('exportValesCsv()')}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">`;

    if (Object.keys(grouped).length === 0) {
        return '<div class="p-20 text-center text-slate-300">No hay historial de vales.</div>';
    }

    Object.keys(grouped).forEach((empId) => {
        const emp = employees.find((e) => e.id === empId);
        const snapshotName = grouped[empId].find((item) => item.employeeName)?.employeeName || '';
        const name = emp ? emp.fullName : snapshotName || 'Desconocido';
        const lista = grouped[empId].sort((a, b) => {
            const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
            const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
            return db - da;
        });

        html += `
            <div class="bg-white p-5 rounded-[25px] border border-slate-100 shadow-sm hover:shadow-lg transition-all cursor-pointer group" onclick="document.getElementById('vhist-${empId}').classList.remove('hidden')">
                <div class="flex items-center gap-3 mb-2">
                    <div class="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform"><i class="ph-fill ph-ticket"></i></div>
                    <div>
                        <h5 class="font-bold text-slate-700 text-sm">${name}</h5>
                        <p class="text-[10px] text-slate-400 font-bold uppercase">${lista.length} Vales</p>
                    </div>
                </div>
            </div>
            
            <div id="vhist-${empId}" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm" onclick="this.classList.add('hidden')">
                <div class="bg-white w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-[30px] p-6 m-4 shadow-2xl animate-scale-up border border-slate-200" onclick="event.stopPropagation()">
                    <div class="flex justify-between items-center mb-6">
                        <h3 class="font-black text-xl text-slate-800">${name}</h3>
                        <button onclick="document.getElementById('vhist-${empId}').classList.add('hidden')" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><i class="ph-bold ph-x"></i></button>
                    </div>
                    <div class="space-y-3">
                        ${lista
                            .map((v) => {
                                const date = formatValeDate(v.createdAt);
                                const requestedAmount = Number(v.requestedAmount || v.amount || 0);
                                const approvedAmount = Number(v.approvedAmount || v.amount || 0);
                                const wasAdjusted =
                                    requestedAmount > 0 && approvedAmount > 0 && requestedAmount !== approvedAmount;
                                let statusClass = 'bg-slate-100 text-slate-500';
                                if (v.status === 'Pendiente') statusClass = 'bg-amber-100 text-amber-600';
                                if (v.status === 'Aprobado') statusClass = 'bg-blue-100 text-blue-600';
                                if (v.status === 'Cobrado')
                                    statusClass = 'bg-emerald-100 text-emerald-600 line-through opacity-60';
                                if (v.status === 'Rechazado')
                                    statusClass = 'bg-red-100 text-red-600 line-through opacity-60';

                                return `
                                <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center">
                                    <div>
                                        <p class="font-black text-slate-700">Gs. ${approvedAmount.toLocaleString()}</p>
                                        <p class="text-[10px] text-slate-400 uppercase font-bold">${v.reason || 'Sin motivo'}</p>
                                        ${wasAdjusted ? `<p class="text-[10px] text-amber-600 font-black mt-1">Solicitado: Gs. ${requestedAmount.toLocaleString()} | Aprobado: Gs. ${approvedAmount.toLocaleString()}</p>` : ''}
                                        ${v.paymentCode ? `<p class="text-[10px] text-blue-600 font-black mt-1">Cod: ${v.paymentCode}</p>` : ''}
                                    </div>
                                    <div class="text-right">
                                        <span class="text-[10px] text-slate-400 block mb-1">${date}</span>
                                        <span class="text-[9px] px-2 py-0.5 rounded font-black uppercase ${statusClass}">${v.status}</span>
                                    </div>
                                </div>`;
                            })
                            .join('')}
                    </div>
                </div>
            </div>`;
    });

    return html + '</div></div>';
}

// ==========================================
// 3. VISTA: APROBAR SOLICITUDES (CON FECHA Y HORA)
// ==========================================
export function getViewApproveVales(vales, employees) {
    latestVales = vales;
    latestEmployees = employees;

    const pendientes = vales.filter((v) => v.status === 'Pendiente');

    if (pendientes.length === 0) {
        return `
            <div class="flex flex-col items-center justify-center h-full py-20 opacity-50 fade-in">
                <i class="ph-duotone ph-check-circle text-6xl text-slate-300 mb-4"></i>
                <p class="text-slate-400 font-bold">No hay solicitudes pendientes</p>
            </div>`;
    }

    let html = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 fade-in pb-20">`;

    pendientes.forEach((v) => {
        const emp = employees.find((e) => e.id === v.employeeId);
        const snapshot = getEmployeeValeSnapshot(
            emp || {
                fullName: v.employeeName,
                branch: v.employeeBranch,
                position: v.employeePosition,
            }
        );
        let fechaHora = 'Reciente';
        if (v.createdAt?.toDate) {
            const d = v.createdAt.toDate();
            fechaHora =
                d.toLocaleDateString('es-PY') +
                ' ' +
                d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
        }

        html += `
            <div class="bg-white p-6 rounded-[30px] shadow-lg border-2 border-amber-100 relative overflow-hidden group hover:-translate-y-1 transition-all">
                <div class="absolute top-0 right-0 p-3 opacity-10"><i class="ph-duotone ph-ticket text-8xl text-amber-500"></i></div>
                
                <div class="flex items-center gap-2 mb-3">
                    <span class="bg-amber-50 text-amber-600 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide flex items-center gap-1">
                        <i class="ph-bold ph-clock"></i> ${fechaHora}
                    </span>
                </div>

                <div class="relative z-10">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-12 h-12 rounded-2xl bg-slate-100 overflow-hidden">
                            ${emp?.photo ? `<img src="${emp.photo}" class="w-full h-full object-cover">` : '<i class="ph-fill ph-user p-3 text-slate-300"></i>'}
                        </div>
                        <div>
                            <h4 class="font-black text-slate-800 leading-tight">${snapshot.name || 'Desconocido'}</h4>
                            <p class="text-xs text-slate-400 font-bold uppercase">${snapshot.position || '---'}</p>
                        </div>
                    </div>
                    
                    <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6">
                        <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Monto Solicitado</p>
                        <p class="text-3xl font-black text-slate-800">Gs. ${Number(v.amount || 0).toLocaleString()}</p>
                        <div class="mt-2 pt-2 border-t border-slate-200">
                            <p class="text-xs text-slate-500 font-medium italic">"${v.reason || 'Sin motivo'}"</p>
                        </div>
                    </div>

                    <div class="mb-6">
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-2 block">Monto a Aprobar</label>
                        <input
                            type="text"
                            id="approveValeAmount-${v.id}"
                            value="${formatGsInputValue(v.amount)}"
                            oninput="formatValeApprovalAmount(this)"
                            class="w-full border-2 border-amber-100 p-4 rounded-2xl bg-amber-50/60 font-black text-amber-600 text-lg outline-none focus:border-amber-400"
                        >
                        <p class="text-[10px] font-bold text-slate-400 mt-2">Si lo necesitas, podes corregir el monto antes de aprobar e imprimir el recibo.</p>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <button onclick="rejectVale('${v.id}')" class="py-3 rounded-xl border-2 border-slate-100 text-slate-400 font-black text-xs hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-colors">RECHAZAR</button>
                        <button onclick="approveVale('${v.id}')" class="py-3 rounded-xl bg-amber-500 text-white font-black text-xs shadow-lg shadow-amber-200 hover:bg-amber-600 transition-transform active:scale-95">APROBAR</button>
                    </div>
                </div>
            </div>`;
    });

    html += `</div>`;
    return html;
}

// ==========================================
// 4. FUNCIONES GLOBALES DE ACCION
// ==========================================
export function initValesGlobalListeners(toastCb) {
    window.exportValesCsv = () => {
        const empName = (id) => latestEmployees.find((e) => e.id === id)?.fullName || id;
        const columns = [
            { label: 'Funcionario', value: (v) => v.employeeName || empName(v.employeeId) },
            { label: 'Fecha', value: (v) => formatValeDate(v.createdAt) },
            { label: 'Sucursal', value: (v) => v.employeeBranch || '' },
            { label: 'Solicitado', value: (v) => Number(v.requestedAmount || v.amount || 0) },
            { label: 'Aprobado', value: (v) => Number(v.approvedAmount || v.amount || 0) },
            { label: 'Motivo', value: (v) => v.reason || '' },
            { label: 'Estado', value: (v) => v.status || '' },
        ];
        Export.downloadCsv(
            `vales-${Export.dateStamp()}`,
            columns,
            latestVales.filter((v) => !v.deleted)
        );
        toastCb('Exportado', 'CSV de vales generado.');
    };
    window.formatValeApprovalAmount = (input) => {
        if (!input) return;
        input.value = formatGsInputValue(input.value);
    };

    window.approveVale = async (id) => {
        try {
            const vale = latestVales.find((item) => item.id === id);
            if (!vale) {
                toastCb('Error', 'No se encontro el vale seleccionado.');
                return;
            }

            const amountInput = document.getElementById(`approveValeAmount-${id}`);
            const approvedAmount = Number(
                String(amountInput?.value || '')
                    .replace(/\./g, '')
                    .replace(/\D/g, '')
            );
            const requestedAmount = Number(vale.requestedAmount || vale.amount || 0);

            if (!approvedAmount || approvedAmount <= 0) {
                toastCb('Error', 'Ingrese un monto valido para aprobar.');
                return;
            }

            const confirmado = await uiConfirm({
                title: 'Aprobar vale',
                message: `¿Aprobar e imprimir ticket por Gs. ${approvedAmount.toLocaleString('es-PY')}?`,
                tone: 'info',
                confirmText: 'Aprobar',
            });
            if (!confirmado) return;

            const employee = latestEmployees.find((emp) => emp.id === vale.employeeId);
            const snapshot = getEmployeeValeSnapshot(employee);
            if (!snapshot.name) {
                toastCb('Error', 'No se pudo resolver el funcionario del vale.');
                return;
            }

            const valeDate = new Date().toISOString().split('T')[0];
            const paymentCode = buildValeCode(vale.employeeId, valeDate, 'VAL');

            await updateDoc(doc(db, 'vales', id), {
                status: 'Aprobado',
                amount: approvedAmount,
                requestedAmount,
                approvedAmount,
                ...buildValeAuditFields(employee, valeDate, 'APROBACION_VALE', paymentCode),
            });

            const detail =
                approvedAmount !== requestedAmount
                    ? `${vale.reason || 'Adelanto de Salario'} | Ajustado de Gs. ${requestedAmount.toLocaleString('es-PY')} a Gs. ${approvedAmount.toLocaleString('es-PY')}`
                    : vale.reason || 'Adelanto de Salario';

            await printTicket({
                sucursal: snapshot.branch || 'MATRIZ',
                employeeName: snapshot.name,
                employeeDni: snapshot.dni,
                employeePosition: snapshot.position,
                payerName: getCurrentPayerName(),
                paymentCode,
                type: 'VALE / ADELANTO',
                detail,
                amount: approvedAmount,
                // Siempre dos ejemplares: Administracion y Funcionario.
                doubleTicket: true,
            });

            toastCb('Aprobado', 'Vale aprobado y ticket impreso.');
        } catch (e) {
            console.error(e);
            toastCb('Error', 'No se pudo actualizar.');
        }
    };

    window.rejectVale = async (id) => {
        const confirmado = await uiConfirm({
            title: 'Rechazar vale',
            message: '¿Rechazar solicitud?',
            tone: 'danger',
            confirmText: 'Rechazar',
        });
        if (!confirmado) return;
        try {
            await updateDoc(doc(db, 'vales', id), { status: 'Rechazado' });
            toastCb('Rechazado', 'La solicitud ha sido rechazada.');
        } catch (e) {
            console.error(e);
            toastCb('Error', 'No se pudo actualizar.');
        }
    };
}
