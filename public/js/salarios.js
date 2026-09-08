import { collection, addDoc, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { printTicket } from "./print-service.js"; 

const parseMonto = (valor) => {
    if (!valor) return 0;
    const limpio = String(valor).replace(/\D/g, ''); 
    return Number(limpio) || 0;
};

let salaryHistoryData = [];
let bodyScrollLocks = 0;
let currentUserRole = 'ADMIN';

export function setSalariosUserRole(role) {
    if (role) currentUserRole = role;
}

function lockBodyScroll() {
    if (bodyScrollLocks === 0) {
        document.body.dataset.previousOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
    }
    bodyScrollLocks += 1;
}

function unlockBodyScroll() {
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (bodyScrollLocks === 0) {
        document.body.style.overflow = document.body.dataset.previousOverflow || '';
        delete document.body.dataset.previousOverflow;
    }
}

function getCurrentUserEmail() {
    return auth.currentUser?.email || 'Sistema';
}

function isSoftDeleted(item) {
    return Boolean(item?.deleted);
}

function normalizeEffectiveDate(record) {
    if (!record) return null;
    if (typeof record.effectiveFrom === 'string') {
        const direct = parseDateOnly(record.effectiveFrom);
        if (direct) return direct;
    }
    if (typeof record.effectiveMonth === 'string') {
        const [year, month] = record.effectiveMonth.split('-').map(Number);
        if (year && month) return new Date(year, month - 1, 1);
    }
    return null;
}

function sortSalaryHistory(records = []) {
    return [...records].sort((a, b) => {
        const dateA = normalizeEffectiveDate(a)?.getTime() || 0;
        const dateB = normalizeEffectiveDate(b)?.getTime() || 0;
        return dateB - dateA;
    });
}

export function setSalaryHistoryData(history = []) {
    salaryHistoryData = sortSalaryHistory(
        history.filter(item => item && !item.deleted && item.active !== false)
    );
}

export function getSalaryHistoryForEmployee(employeeId) {
    return sortSalaryHistory(
        salaryHistoryData.filter(item => item.employeeId === employeeId && !item.deleted && item.active !== false)
    );
}

function getEffectiveSalaryRecord(emp, year, month) {
    if (!emp?.id) return null;
    const periodEnd = new Date(year, month, 0);
    const history = getSalaryHistoryForEmployee(emp.id);
    return history.find(record => {
        const effectiveDate = normalizeEffectiveDate(record);
        return effectiveDate && effectiveDate <= periodEnd;
    }) || null;
}

export function getEffectiveSalaryAmountForPeriod(emp, year, month) {
    const periodEnd = new Date(year, month, 0);
    const history = getSalaryHistoryForEmployee(emp?.id);
    const record = getEffectiveSalaryRecord(emp, year, month);
    if (record) {
        return parseMonto(record.newSalary);
    }
    const futureRecord = [...history]
        .reverse()
        .find(item => {
            const effectiveDate = normalizeEffectiveDate(item);
            return effectiveDate && effectiveDate > periodEnd;
        });
    if (futureRecord && futureRecord.previousSalary != null) {
        return parseMonto(futureRecord.previousSalary);
    }
    return parseMonto(emp?.salary);
}

export function getEffectiveSalaryAmountForDate(emp, referenceDate = new Date()) {
    return getEffectiveSalaryAmountForPeriod(emp, referenceDate.getFullYear(), referenceDate.getMonth() + 1);
}

window.filterPaymentHistory = (text) => {
    const term = text.toLowerCase();
    const items = document.querySelectorAll('.history-item');
    let hasResults = false;
    items.forEach(item => {
        const name = item.getAttribute('data-name').toLowerCase();
        if(name.includes(term)) { item.classList.remove('hidden'); hasResults = true; } 
        else { item.classList.add('hidden'); }
    });
    const msg = document.getElementById('noResultsMsg');
    if(msg) msg.classList.toggle('hidden', hasResults);
};

function countBusinessDays(year, month, startDay = 1, endDay = null) {
    const lastDayOfMonth = new Date(year, month, 0).getDate(); 
    const finalDay = endDay ? Math.min(endDay, lastDayOfMonth) : lastDayOfMonth;
    
    let count = 0;
    for (let day = startDay; day <= finalDay; day++) {
        const date = new Date(year, month - 1, day);
        if (date.getDay() !== 0) count++; // 0 es Domingo. Contamos Lunes(1) a Sabado(6)
    }
    return count;
}

function parseDateOnly(value) {
    if (!value || typeof value !== 'string') return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDateDisplay(value) {
    if (!value || typeof value !== 'string') return 'S/F';
    const [year, month, day] = value.split('-');
    if (!year || !month || !day) return value;
    return `${day}/${month}/${year}`;
}

function getPeriodBounds(year, month) {
    return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month, 0)
    };
}

function getEffectiveEndDate(emp) {
    if (!emp || emp.status !== 'INACTIVO') return null;
    return parseDateOnly(emp.endDate);
}

function isEmployeeRelevantForPeriod(emp, year, month) {
    const { start, end } = getPeriodBounds(year, month);
    const ingreso = parseDateOnly(emp.startDate);
    const salida = getEffectiveEndDate(emp);

    if (ingreso && ingreso > end) return false;
    if (salida && salida < start) return false;

    return true;
}

function getEmployeeTicketSnapshot(emp) {
    if (!emp) {
        return { name: '', branch: '', position: '' };
    }

    const pickText = (...values) => {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    };

    return {
        name: pickText(emp.fullName, emp.employeeName, emp.name),
        branch: pickText(emp.branch, emp.employeeBranch, emp.sucursal),
        position: pickText(emp.position, emp.employeePosition, emp.role)
    };
}

function buildSalaryAuditFields(emp, paymentDate, month, year, sourceModule) {
    const ticketEmployee = getEmployeeTicketSnapshot(emp);
    return {
        employeeName: ticketEmployee.name,
        employeeNameUpper: ticketEmployee.name ? ticketEmployee.name.toUpperCase() : '',
        employeeBranch: ticketEmployee.branch,
        employeePosition: ticketEmployee.position,
        employeeStatusSnapshot: emp?.status || 'ACTIVO',
        paymentDateKey: paymentDate || '',
        periodKey: `${year}-${String(month).padStart(2, '0')}`,
        sourceModule,
        createdAtLocal: new Date().toISOString()
    };
}

function buildPaymentCode(employeeId, paymentDate, prefix = 'PAY') {
    const now = new Date();
    const localStamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join('');
    const datePart = String(paymentDate || now.toISOString().split('T')[0]).replace(/\D/g, '').slice(0, 8) || localStamp.slice(0, 8);
    const employeePart = String(employeeId || 'SINEMP').slice(-4).toUpperCase();
    return `${prefix}-${datePart}-${localStamp.slice(8, 14)}-${employeePart}`;
}

function buildPaymentGroupId(employeeId, paymentDate, prefix = 'PAY') {
    const normalizedDate = paymentDate || new Date().toISOString().split('T')[0];
    return `${prefix}-${employeeId || 'SINEMP'}-${normalizedDate}-${Date.now()}`;
}

export function getBaseSalaryForMonth(emp, year, month) {
    let fullSalary = getEffectiveSalaryAmountForPeriod(emp, year, month);
    let esProporcional = false;
    let diasTrabajados = 30;
    let diasLaborablesReales = countBusinessDays(year, month, 1); 
    const { start: periodStart, end: periodEnd } = getPeriodBounds(year, month);

    let diaInicioCalculo = 1;
    let diaFinCalculo = null;
    let aplicaIngreso = false;
    let aplicaSalida = false;

    if (emp.startDate) {
        const ingreso = parseDateOnly(emp.startDate);
        if (ingreso && ingreso > periodEnd) {
            return { monto: 0, esProporcional: false, diasTrabajados: 0, diasLaborablesReales };
        }
        if (ingreso && ingreso.getFullYear() === year && (ingreso.getMonth() + 1) === month) {
            aplicaIngreso = true;
            diaInicioCalculo = ingreso.getDate();
        }
    }

    const salida = getEffectiveEndDate(emp);
    if (salida && salida < periodStart) {
        return { monto: 0, esProporcional: false, diasTrabajados: 0, diasLaborablesReales };
    }
    if (salida && salida.getFullYear() === year && (salida.getMonth() + 1) === month) {
        aplicaSalida = true;
        diaFinCalculo = salida.getDate();
    }

    if (aplicaIngreso || aplicaSalida) {
        esProporcional = true;
        diasTrabajados = countBusinessDays(year, month, diaInicioCalculo, diaFinCalculo);
        fullSalary = (fullSalary / 30) * diasTrabajados;
    }

    return {
        monto: Math.floor(fullSalary),
        esProporcional,
        diasTrabajados,
        diasLaborablesReales
    };
}

export function getSalaryTotalsForPeriod(emp, year, month, vales = [], comisiones = [], descuentos = [], salaries = []) {
    const salaryData = getBaseSalaryForMonth(emp, year, month);
    const salaryBase = salaryData.monto;

    const getRecordDate = (item, options = {}) => {
        const { preferApprovalDate = false } = options;

        if (preferApprovalDate) {
            if (item.valeDateKey && typeof item.valeDateKey === 'string') {
                const valeDate = parseDateOnly(item.valeDateKey);
                if (valeDate) return valeDate;
            }
            if (item.approvedAt && item.approvedAt.toDate) {
                return item.approvedAt.toDate();
            }
            if (item.approvedAt instanceof Date) {
                return item.approvedAt;
            }
            if (item.approvedAtLocal) {
                const localApprovedDate = new Date(item.approvedAtLocal);
                if (!Number.isNaN(localApprovedDate.getTime())) return localApprovedDate;
            }
        }

        if (item.date && typeof item.date === 'string') {
            const date = parseDateOnly(item.date);
            if (date) return date;
        }
        if (item.createdAt && item.createdAt.toDate) {
            return item.createdAt.toDate();
        }
        if (item.createdAt instanceof Date) {
            return item.createdAt;
        }
        if (item.createdAtLocal) {
            const localDate = new Date(item.createdAtLocal);
            if (!Number.isNaN(localDate.getTime())) return localDate;
        }
        return null;
    };

    const checkDate = (item, options = {}) => {
        const recordDate = getRecordDate(item, options);
        if (!recordDate) return false;
        return (recordDate.getMonth() + 1) === month && recordDate.getFullYear() === year;
    };

    const misVales = vales.filter(v => {
        if (v.employeeId !== emp.id) return false;
        if (isSoftDeleted(v)) return false;
        // Un vale PENDIENTE no impacta el salario: solo descuenta cuando esta aprobado o cobrado.

        const valeStatus = String(v.status || '').trim().toLowerCase();
        if (valeStatus === 'pendiente' || valeStatus === 'rechazado' || valeStatus === 'anulado') return false;
        const shouldPreferApprovalDate = valeStatus === 'aprobado' || valeStatus === 'cobrado';
        return checkDate(v, { preferApprovalDate: shouldPreferApprovalDate });
    });
    const totalVales = misVales.reduce((sum, v) => sum + parseMonto(v.approvedAmount ?? v.amount), 0);

    const misDescuentos = descuentos.filter(d => d.employeeId === emp.id && !isSoftDeleted(d) && d.status === 'Aplicado' && checkDate(d));
    const totalDescuentos = misDescuentos.reduce((sum, d) => sum + parseMonto(d.amount), 0);

    const misComisiones = comisiones.filter(c => c.employeeId === emp.id && !isSoftDeleted(c) && (c.status === 'Pendiente' || c.status === 'Aprobado') && checkDate(c));
    const totalComisiones = misComisiones.reduce((sum, c) => sum + parseMonto(c.amount), 0);

    const misPagos = salaries.filter(s => s.employeeId === emp.id && !isSoftDeleted(s) && Number(s.month) === month && Number(s.year) === year);
    const totalPagado = misPagos.reduce((sum, s) => sum + parseMonto(s.netPay), 0);

    const saldoPendiente = (salaryBase + totalComisiones) - (totalVales + totalDescuentos + totalPagado);

    return {
        base: salaryBase,
        esProporcional: salaryData.esProporcional,
        diasTrabajados: salaryData.diasTrabajados,
        vales: totalVales,
        valesList: misVales,
        descuentos: totalDescuentos,
        descuentosList: misDescuentos,
        comisiones: totalComisiones,
        comisionesList: misComisiones,
        yaPagado: totalPagado,
        pagosList: misPagos,
        saldo: saldoPendiente < 0 ? 0 : Math.floor(saldoPendiente)
    };
}

export function getViewPendingSalaries() {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return `
        <div class="max-w-7xl mx-auto space-y-6 fade-in pb-20">
            <div class="bg-white p-6 rounded-[30px] shadow-lg border border-blue-50 sticky top-4 z-20">
                <div class="flex flex-col xl:flex-row justify-between items-center gap-4">
                    <div class="flex items-center gap-4 w-full xl:w-auto">
                        <div class="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-xl"><i class="ph-fill ph-calculator"></i></div>
                        <div>
                            <h3 class="text-xl font-black text-slate-800">Liquidar Salarios</h3>
                            <p class="text-xs text-blue-500 font-bold uppercase">Seleccione el mes a procesar</p>
                        </div>
                    </div>
                    
                    <div class="flex flex-col md:flex-row items-center gap-3 w-full xl:w-auto">
                        <div class="w-full md:w-auto">
                            <input type="month" id="filterMonth" value="${defaultMonth}" class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-2 px-4 font-bold text-slate-700 outline-none focus:border-blue-500 cursor-pointer shadow-sm">
                        </div>

                        <div class="relative w-full md:w-56">
                            <input type="text" id="liqSearch" placeholder="Buscar funcionario..." class="w-full bg-slate-50 border-2 border-slate-100 rounded-xl py-2 pl-9 pr-4 font-bold text-slate-700 outline-none focus:border-blue-500 shadow-sm">
                            <i class="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        </div>

                        <div class="relative w-full md:w-56">
                            <select id="filterBranch" class="w-full bg-slate-800 text-white border-none rounded-xl py-2 pl-3 pr-8 font-bold text-xs appearance-none outline-none cursor-pointer hover:bg-slate-700 transition-all shadow-md">
                                <option value="TODAS">VER TODAS LAS SUCURSALES</option>
                            </select>
                            <i class="ph-bold ph-buildings absolute right-3 top-1/2 -translate-y-1/2 text-white pointer-events-none"></i>
                        </div>
                        
                        <button id="btnPrintPayroll" class="bg-blue-600 text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-md hover:bg-blue-500 transition-all flex-shrink-0 group" title="Imprimir Nomina en Pantalla">
                            <i class="ph-bold ph-printer text-lg group-hover:scale-110 transition-transform"></i>
                        </button>
                    </div>
                </div>
            </div>

            <div id="massPayrollGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>

            <div id="payrollCard" class="hidden fixed inset-0 bg-black/70 z-50 flex items-center justify-center backdrop-blur-sm p-3 sm:p-4 md:p-6 animate-fade-in">
                <div class="bg-white rounded-[35px] shadow-2xl flex flex-col overflow-hidden relative w-full" style="width:min(95vw, 1120px); max-height:90vh;">
                    <div class="sticky top-0 flex items-center justify-between gap-4 p-5 sm:p-6 border-b border-slate-100 bg-white z-20 pr-16">
                        <h3 class="text-lg sm:text-xl font-black text-slate-800 uppercase tracking-wide">Detalle de Liquidacion</h3>
                        <button id="payrollCardClose" class="absolute top-4 right-4 sm:top-5 sm:right-5 w-11 h-11 bg-slate-100 rounded-full flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors shadow-sm">
                            <i class="ph-bold ph-x text-lg"></i>
                        </button>
                    </div>
                    <div id="payrollCardContent" class="p-4 sm:p-6 lg:p-8 overflow-y-auto overscroll-contain custom-scroll bg-white flex-1 min-h-0"></div>
                </div>
                <div id="movementEditorModal" class="hidden fixed inset-0 z-[60] bg-black/45 backdrop-blur-[1px] p-4 flex items-center justify-center"></div>
            </div>
        </div>`;
}

export function setupPendingSalariesLogic(toastCb, employees, vales, comisiones, descuentos, salaries) {
    unlockBodyScroll();
    const searchInput = document.getElementById('liqSearch');
    const gridDiv = document.getElementById('massPayrollGrid');
    const cardModal = document.getElementById('payrollCard');
    const cardContent = document.getElementById('payrollCardContent');
    const cardClose = document.getElementById('payrollCardClose');
    const movementEditorModal = document.getElementById('movementEditorModal');
    const monthInput = document.getElementById('filterMonth');
    const btnPrint = document.getElementById('btnPrintPayroll');
    const branchFilter = document.getElementById('filterBranch');

    let selectedYear = new Date().getFullYear();
    let selectedMonth = new Date().getMonth() + 1;

    const closePayrollModal = () => {
        if (!cardModal || cardModal.classList.contains('hidden')) return;
        cardModal.classList.add('hidden');
        if (movementEditorModal) {
            movementEditorModal.classList.add('hidden');
            movementEditorModal.innerHTML = '';
        }
        unlockBodyScroll();
    };

    const openPayrollModal = () => {
        if (!cardModal) return;
        if (cardModal.classList.contains('hidden')) {
            cardModal.classList.remove('hidden');
            lockBodyScroll();
        }
    };

    if (cardClose) {
        cardClose.onclick = closePayrollModal;
    }

    if (cardModal) {
        cardModal.addEventListener('click', (event) => {
            if (event.target === cardModal) {
                closePayrollModal();
            }
        });
    }

    if(branchFilter) {
        const currentVal = branchFilter.value;
        branchFilter.innerHTML = '<option value="TODAS">VER TODAS LAS SUCURSALES</option>';
        
        const uniqueBranches = [...new Set(employees.map(e => e.branch).filter(b => b))].sort();
        uniqueBranches.forEach(suc => {
            const opt = document.createElement('option');
            opt.value = suc;
            opt.innerText = suc.toUpperCase();
            branchFilter.appendChild(opt);
        });
        
        if (currentVal && uniqueBranches.includes(currentVal)) {
            branchFilter.value = currentVal;
        }
    }

    function calculateTotals(emp, year, month) {
        return getSalaryTotalsForPeriod(emp, year, month, vales, comisiones, descuentos, salaries);
    }

    function renderGrid() {
        gridDiv.innerHTML = '';
        const term = searchInput.value.toLowerCase();
        const selectedBranch = branchFilter ? branchFilter.value : 'TODAS';
        const sortedEmployees = [...employees].sort((a, b) => a.fullName.localeCompare(b.fullName));

        let visibleCount = 0;

        sortedEmployees.forEach(emp => {
            if (!emp.fullName.toLowerCase().includes(term)) return;
            if (selectedBranch !== 'TODAS' && emp.branch !== selectedBranch) return;
            if (!isEmployeeRelevantForPeriod(emp, selectedYear, selectedMonth)) return;
            if (emp.status === 'INACTIVO' && emp.endDate) {
                const salida = new Date(emp.endDate + 'T00:00:00');
                const mesSalida = salida.getMonth() + 1;
                const anioSalida = salida.getFullYear();
                
                if (selectedYear > anioSalida) return;
                if (selectedYear === anioSalida && selectedMonth > mesSalida) return;
            }

            visibleCount++;
            const data = calculateTotals(emp, selectedYear, selectedMonth);
            
            const isPaidOff = data.saldo === 0 && (data.base > 0 || data.yaPagado > 0);
            
            let isInactiveBadge = '';
            let bgCardClass = 'bg-white';
            
            if(emp.status === 'INACTIVO') {
                isInactiveBadge = `<span class="bg-rose-100 text-rose-600 px-2 py-1 rounded text-[9px] font-black uppercase shadow-sm">LIQ. FINAL (BAJA)</span>`;
                bgCardClass = 'bg-rose-50/30';
            }

            const statusClass = isPaidOff ? "bg-slate-50 border-slate-200 opacity-60" : `${bgCardClass} border-blue-100 hover:border-blue-400 hover:shadow-xl`;
            const btnClass = isPaidOff ? "bg-slate-200 text-slate-500" : "bg-blue-600 text-white hover:bg-blue-700";

            const card = document.createElement('div');
            card.className = `p-5 rounded-[25px] border-2 transition-all cursor-pointer group relative overflow-hidden ${statusClass}`;
            card.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-100 flex-shrink-0 overflow-hidden">
                             ${emp.photo ? `<img src="${emp.photo}" class="w-full h-full object-cover">` : '<i class="ph-fill ph-user p-2 text-slate-300"></i>'}
                        </div>
                        <div>
                            <h5 class="font-black text-slate-700 text-sm leading-tight">${emp.fullName}</h5>
                            <p class="text-[10px] text-slate-400 font-bold uppercase">${emp.position}</p>
                            <p class="text-[10px] text-slate-400 font-semibold mt-1">Ingreso: ${formatDateDisplay(emp.startDate)}${emp.status === 'INACTIVO' && emp.endDate ? ` | Baja: ${formatDateDisplay(emp.endDate)}` : ''}</p>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1 items-end">
                        ${isPaidOff ? '<span class="bg-emerald-100 text-emerald-600 px-2 py-1 rounded text-[9px] font-black uppercase shadow-sm">Saldado</span>' : ''}
                        ${isInactiveBadge}
                    </div>
                </div>
                <div class="space-y-1 mb-4">
                    <div class="flex justify-between text-xs text-slate-500 font-medium"><span>Sueldo Base:</span> <span>Gs. ${data.base.toLocaleString()}</span></div>
                    <div class="flex justify-between text-xs text-slate-500 font-medium"><span>Pagado/Adelantado:</span> <span class="text-indigo-500">- Gs. ${data.yaPagado.toLocaleString()}</span></div>
                    <div class="flex justify-between text-xs text-slate-500 font-medium"><span>Desc/Vales/Sanc:</span> <span class="text-rose-500">- Gs. ${(data.vales + data.descuentos).toLocaleString()}</span></div>
                </div>
                <div class="border-t border-slate-100 pt-3 flex justify-between items-center">
                    <div>
                        <p class="text-[10px] text-slate-400 font-black uppercase">Saldo a Pagar</p>
                        <p class="text-xl font-black text-slate-800">Gs. ${data.saldo.toLocaleString()}</p>
                    </div>
                    <button class="w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${btnClass}"><i class="ph-bold ph-caret-right text-lg"></i></button>
                </div>
                <div class="absolute bottom-2 right-2 opacity-10 text-[10px] font-black uppercase pointer-events-none">${emp.branch}</div>
            `;
            card.onclick = () => renderDetailModal(emp, data);
            gridDiv.appendChild(card);
        });

        if (visibleCount === 0) {
            gridDiv.innerHTML = `<div class="col-span-full text-center py-20 opacity-50">
                <i class="ph ph-magnifying-glass text-4xl mb-2"></i>
                <p class="font-bold">No se encontraron funcionarios activos en este periodo.</p>
            </div>`;
        }
    }

    function renderDetailModal(emp, data) {
        const periodText = `${selectedMonth}/${selectedYear}`;
        const today = new Date().toISOString().split('T')[0];

        const getMovementDate = (item) => {
            if (item.date && typeof item.date === 'string') return new Date(item.date + 'T12:00:00');
            if (item.createdAt?.toDate) return item.createdAt.toDate();
            if (item.createdAt instanceof Date) return item.createdAt;
            if (item.createdAtLocal) {
                const localDate = new Date(item.createdAtLocal);
                if (!Number.isNaN(localDate.getTime())) return localDate;
            }
            return new Date();
        };

        const canManageMovements = Boolean(auth.currentUser);
        const historyItems = [
            ...data.valesList.filter(item => !isSoftDeleted(item)).map(v => ({
                id: v.id,
                source: 'vales',
                type: 'VALE',
                amount: parseMonto(v.approvedAmount ?? v.amount),
                detail: v.reason || 'Solicitud de Vale',
                dateObj: getMovementDate(v)
            })),
            ...data.pagosList.filter(item => !isSoftDeleted(item)).map(p => ({
                id: p.id,
                source: 'salaries',
                type: p.type === 'INDIVIDUAL' ? 'ADELANTO' : 'LIQUIDACION',
                amount: parseMonto(p.netPay),
                detail: p.details || 'Pago de Salario',
                dateObj: getMovementDate(p)
            })),
            ...data.descuentosList.filter(item => !isSoftDeleted(item)).map(d => ({
                id: d.id,
                source: 'descuentos',
                type: 'DESCUENTO',
                amount: parseMonto(d.amount),
                detail: d.reason || 'Descuento Aplicado',
                dateObj: getMovementDate(d)
            })),
            ...data.comisionesList.filter(item => !isSoftDeleted(item)).map(c => ({
                id: c.id,
                source: 'comisiones',
                type: 'COMISION',
                amount: parseMonto(c.amount),
                detail: c.reason || c.concept || 'Comision',
                dateObj: getMovementDate(c)
            }))
        ].sort((a, b) => b.dateObj - a.dateObj);

        let historyHTML = '';
        if (historyItems.length > 0) {
            historyHTML = `
            <div class="mt-8">
                <h4 class="font-bold text-slate-800 text-xs uppercase tracking-widest mb-4 border-b pb-2">Historial de Movimientos (Recientes)</h4>
                <div class="space-y-2">
                ${historyItems.map(item => {
                    const dateStr = item.dateObj.toLocaleDateString('es-PY');
                    let badgeClass = 'bg-slate-100 text-slate-600';
                    let amountColor = 'text-slate-700';

                    if(item.type === 'VALE') { badgeClass = 'bg-amber-100 text-amber-700'; amountColor = 'text-amber-700'; }
                    if(item.type === 'ADELANTO') { badgeClass = 'bg-indigo-100 text-indigo-700'; amountColor = 'text-indigo-700'; }
                    if(item.type === 'DESCUENTO') { badgeClass = 'bg-rose-100 text-rose-700'; amountColor = 'text-rose-700'; }
                    if(item.type === 'COMISION') { badgeClass = 'bg-emerald-100 text-emerald-700'; amountColor = 'text-emerald-700'; }

                    return `
                    <div class="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                        <div class="flex items-center gap-3">
                            <div class="text-[10px] font-bold text-slate-400 bg-white border border-slate-200 px-2 py-1 rounded text-center min-w-[70px]">${dateStr}</div>
                            <div>
                                <span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${badgeClass} mr-2">${item.type}</span>
                                <span class="text-xs font-bold text-slate-600">${item.detail}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="font-black text-sm ${amountColor}">Gs. ${parseMonto(item.amount).toLocaleString()}</span>
                            ${canManageMovements ? `
                                <button type="button" data-movement-edit="${item.source}:${item.id}" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-600 transition-colors flex items-center justify-center" title="Editar movimiento">
                                    <i class="ph-bold ph-pencil-simple text-sm"></i>
                                </button>
                                <button type="button" data-movement-delete="${item.source}:${item.id}" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600 transition-colors flex items-center justify-center" title="Eliminar movimiento">
                                    <i class="ph-bold ph-trash text-sm"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>`;
                }).join('')}
                </div>
            </div>`;
        } else {
            historyHTML = `<div class="mt-8 text-center text-xs text-slate-400 py-8 border-2 border-dashed border-slate-100 rounded-xl">No hay movimientos registrados en este periodo.</div>`;
        }

        let alertaBaja = '';
        if(emp.status === 'INACTIVO') {
            alertaBaja = `
            <div class="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-700">
                <i class="ph-fill ph-warning-octagon text-2xl"></i>
                <div>
                    <p class="font-black text-xs uppercase tracking-wider">Funcionario Inactivo</p>
                    <p class="text-[10px] font-bold">Dado de baja el: ${formatDateDisplay(emp.endDate)}. Se aplica calculo de liquidacion final.</p>
                </div>
            </div>`;
        }

        cardContent.innerHTML = `
            <div class="flex flex-col lg:flex-row gap-8 h-full">
                <div class="flex-1 space-y-6">
                    <div>
                        <h2 class="text-3xl font-black text-slate-800 leading-none">${emp.fullName}</h2>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Liquidacion Mes: ${periodText}</p>
                        <div class="flex flex-wrap gap-2 mt-3">
                            <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Ingreso: ${formatDateDisplay(emp.startDate)}</span>
                            ${emp.status === 'INACTIVO' ? `<span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Baja: ${formatDateDisplay(emp.endDate)}</span>` : ''}
                        </div>
                        ${alertaBaja}
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div class="p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                            <span class="text-[10px] font-bold text-blue-400 uppercase block mb-1">Salario Base ${data.esProporcional ? '(Prop.)' : ''}</span>
                            <span class="text-xl font-black text-slate-800">Gs. ${data.base.toLocaleString()}</span>
                            ${data.esProporcional ? `<div class="mt-1 text-[9px] font-bold text-blue-500 bg-blue-100 inline-block px-1.5 rounded">Calculado sobre ${data.diasTrabajados} dias habiles (Base/30)</div>` : ''}
                        </div>
                        <div class="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100">
                            <span class="text-[10px] font-bold text-emerald-500 uppercase block mb-1">Comisiones</span>
                            <span class="text-xl font-black text-emerald-700">+ Gs. ${data.comisiones.toLocaleString()}</span>
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <div class="flex-1 p-3 bg-amber-50 rounded-xl border border-amber-100 text-center">
                            <span class="block text-[9px] font-bold text-amber-700 uppercase">Vales</span>
                            <span class="block text-sm font-black text-amber-800">- ${data.vales.toLocaleString()}</span>
                        </div>
                        <div class="flex-1 p-3 bg-rose-50 rounded-xl border border-rose-100 text-center">
                            <span class="block text-[9px] font-bold text-rose-700 uppercase">Descuentos</span>
                            <span class="block text-sm font-black text-rose-800">- ${data.descuentos.toLocaleString()}</span>
                        </div>
                        <div class="flex-1 p-3 bg-indigo-50 rounded-xl border border-indigo-100 text-center">
                            <span class="block text-[9px] font-bold text-indigo-700 uppercase">Adelantos</span>
                            <span class="block text-sm font-black text-indigo-800">- ${data.yaPagado.toLocaleString()}</span>
                        </div>
                    </div>

                    ${historyHTML}
                </div>

                <div class="lg:w-80 flex-shrink-0">
                    <div class="bg-slate-800 rounded-[30px] p-6 text-white shadow-xl sticky top-0">
                        <p class="text-slate-400 font-bold text-[10px] uppercase tracking-[3px] mb-2">SALDO PENDIENTE</p>
                        <h3 class="text-4xl font-black tracking-tight mb-6">Gs. ${data.saldo.toLocaleString()}</h3>
                        
                        <div class="space-y-4 mb-8">
                            <div>
                                <label class="text-[10px] font-bold text-slate-400 uppercase block mb-1">Fecha de Pago</label>
                                <input type="date" id="liquidDate" value="${today}" class="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white font-bold outline-none focus:border-blue-500">
                            </div>
                            <div>
                                <label class="text-[10px] font-bold text-slate-400 uppercase block mb-1">Monto a Pagar</label>
                                <div class="relative">
                                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">Gs.</span>
                                    <input type="text" id="amountToPay" value="${data.saldo.toLocaleString('es-PY')}" class="w-full bg-slate-700 border border-slate-600 rounded-xl py-3 pl-10 pr-3 text-xl font-black text-white outline-none focus:border-blue-500 text-right">
                                </div>
                            </div>
                            <div>
                                <label class="text-[10px] font-bold text-slate-400 uppercase block mb-1">Observacion</label>
                                <textarea id="liquidObservation" rows="3" placeholder="Escriba una observacion opcional..." class="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white font-bold outline-none focus:border-blue-500 resize-none"></textarea>
                            </div>
                        </div>

                        <button id="btnConfirmPay" ${data.saldo === 0 ? 'disabled' : ''} class="w-full bg-blue-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-4 rounded-xl font-black shadow-lg hover:bg-blue-500 transition-all flex justify-center items-center gap-2 group">
                            <span class="group-hover:scale-105 transition-transform flex items-center gap-2">
                                <i class="ph-bold ph-check-circle text-xl"></i> 
                                ${data.saldo === 0 ? 'MES SALDADO' : 'CONFIRMAR PAGO'}
                            </span>
                        </button>
                    </div>
                </div>
            </div>`;

        const getSourceArray = (source) => {
            if (source === 'vales') return vales;
            if (source === 'descuentos') return descuentos;
            if (source === 'comisiones') return comisiones;
            if (source === 'salaries') return salaries;
            return [];
        };

        const getMovementRecord = (source, id) => getSourceArray(source).find(item => item.id === id);

        const applyLocalMovementPatch = (source, id, patch) => {
            const sourceArray = getSourceArray(source);
            const index = sourceArray.findIndex(item => item.id === id);
            if (index >= 0) {
                sourceArray[index] = { ...sourceArray[index], ...patch };
            }
        };

        const rerenderCurrentEmployee = () => {
            const freshEmployee = employees.find(item => item.id === emp.id) || emp;
            const freshData = calculateTotals(freshEmployee, selectedYear, selectedMonth);
            renderGrid();
            renderDetailModal(freshEmployee, freshData);
        };

        const closeMovementEditor = () => {
            if (!movementEditorModal) return;
            movementEditorModal.classList.add('hidden');
            movementEditorModal.innerHTML = '';
        };

        const openMovementEditor = (movement) => {
            if (!movementEditorModal) return;

            movementEditorModal.innerHTML = `
                <div class="bg-white w-full max-w-md rounded-[28px] shadow-2xl border border-slate-100 overflow-hidden" onclick="event.stopPropagation()">
                    <div class="flex items-center justify-between p-5 border-b border-slate-100">
                        <div>
                            <h4 class="font-black text-slate-800">Editar Movimiento</h4>
                            <p class="text-[11px] font-bold text-slate-400 uppercase">${movement.type}</p>
                        </div>
                        <button type="button" id="closeMovementEditor" class="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center">
                            <i class="ph-bold ph-x"></i>
                        </button>
                    </div>
                    <form id="movementEditorForm" class="p-5 space-y-4">
                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Monto</label>
                            <input type="text" id="movementAmountInput" value="${movement.amount.toLocaleString('es-PY')}" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-black text-slate-700">
                        </div>
                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Observacion</label>
                            <textarea id="movementObservationInput" rows="4" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 resize-none">${movement.detail || ''}</textarea>
                        </div>
                        <div class="flex gap-3">
                            <button type="button" id="cancelMovementEditor" class="flex-1 bg-slate-100 text-slate-700 py-3 rounded-2xl font-black">Cancelar</button>
                            <button type="submit" class="flex-1 bg-blue-600 text-white py-3 rounded-2xl font-black">Guardar</button>
                        </div>
                    </form>
                </div>
            `;
            movementEditorModal.classList.remove('hidden');

            const amountField = document.getElementById('movementAmountInput');
            const observationField = document.getElementById('movementObservationInput');
            amountField?.addEventListener('input', (event) => {
                let value = event.target.value.replace(/\D/g, '');
                event.target.value = value ? new Intl.NumberFormat('es-PY').format(value) : '';
            });

            document.getElementById('closeMovementEditor')?.addEventListener('click', closeMovementEditor);
            document.getElementById('cancelMovementEditor')?.addEventListener('click', closeMovementEditor);
            movementEditorModal.onclick = (event) => {
                if (event.target === movementEditorModal) closeMovementEditor();
            };

            document.getElementById('movementEditorForm')?.addEventListener('submit', async (event) => {
                event.preventDefault();

                const liveRecord = getMovementRecord(movement.source, movement.id);
                if (!liveRecord) {
                    toastCb("Error", "El movimiento ya no existe.");
                    closeMovementEditor();
                    return;
                }
                if (isSoftDeleted(liveRecord)) {
                    toastCb("Error", "El movimiento ya fue eliminado.");
                    closeMovementEditor();
                    return;
                }

                const newAmount = parseMonto(amountField.value);
                const newObservation = (observationField.value || '').trim();

                if (!amountField.value.trim()) return toastCb("Error", "Ingrese un monto.");
                if (amountField.value.includes('-')) return toastCb("Error", "El monto no puede ser negativo.");
                if (!newAmount && newAmount !== 0) return toastCb("Error", "El monto debe ser numerico.");
                if (newAmount < 0) return toastCb("Error", "El monto no puede ser negativo.");
                if (newObservation.length > 300) return toastCb("Error", "La observacion no puede superar 300 caracteres.");

                const patch = {
                    editedAt: serverTimestamp(),
                    editedBy: getCurrentUserEmail()
                };

                if (movement.source === 'salaries') {
                    patch.netPay = newAmount;
                    patch.details = newObservation;
                } else if (movement.source === 'vales') {
                    patch.amount = newAmount;
                    patch.approvedAmount = newAmount;
                    patch.reason = newObservation;
                } else if (movement.source === 'descuentos') {
                    patch.amount = newAmount;
                    patch.reason = newObservation;
                } else if (movement.source === 'comisiones') {
                    patch.amount = newAmount;
                    patch.reason = newObservation;
                }

                try {
                    await updateDoc(doc(db, movement.source, movement.id), patch);
                    applyLocalMovementPatch(movement.source, movement.id, patch);
                    closeMovementEditor();
                    toastCb("Exito", "Movimiento actualizado.");
                    rerenderCurrentEmployee();
                } catch (error) {
                    console.error(error);
                    toastCb("Error", "No se pudo actualizar el movimiento.");
                }
            });
        };

        const deleteMovement = async (movement) => {
            const liveRecord = getMovementRecord(movement.source, movement.id);
            if (!liveRecord) return toastCb("Error", "El movimiento no existe.");
            if (isSoftDeleted(liveRecord)) return toastCb("Error", "El movimiento ya fue eliminado.");
            if (!confirm(`Eliminar ${movement.type} por Gs. ${movement.amount.toLocaleString('es-PY')}?`)) return;

            const patch = {
                deleted: true,
                deletedAt: serverTimestamp(),
                deletedBy: getCurrentUserEmail()
            };

            try {
                await updateDoc(doc(db, movement.source, movement.id), patch);
                applyLocalMovementPatch(movement.source, movement.id, patch);
                closeMovementEditor();
                toastCb("Exito", "Movimiento eliminado.");
                rerenderCurrentEmployee();
            } catch (error) {
                console.error(error);
                toastCb("Error", "No se pudo eliminar el movimiento.");
            }
        };

        openPayrollModal();

        const inputPay = document.getElementById('amountToPay');
        inputPay.addEventListener('input', (e) => { 
            let val = e.target.value.replace(/\D/g, '');
            e.target.value = new Intl.NumberFormat('es-PY').format(val); 
        });

        if (canManageMovements) {
            cardContent.querySelectorAll('[data-movement-edit]').forEach(button => {
                button.addEventListener('click', () => {
                    const [source, id] = button.dataset.movementEdit.split(':');
                    const movement = historyItems.find(item => item.source === source && item.id === id);
                    if (movement) openMovementEditor(movement);
                });
            });

            cardContent.querySelectorAll('[data-movement-delete]').forEach(button => {
                button.addEventListener('click', () => {
                    const [source, id] = button.dataset.movementDelete.split(':');
                    const movement = historyItems.find(item => item.source === source && item.id === id);
                    if (movement) deleteMovement(movement);
                });
            });
        }

        const btnPay = document.getElementById('btnConfirmPay');
        if(btnPay && !btnPay.disabled) {
            btnPay.onclick = async () => {
                const amountRaw = parseMonto(inputPay.value);
                const chosenDate = document.getElementById('liquidDate').value;
                const observation = (document.getElementById('liquidObservation')?.value || '').trim();
                const ticketEmployee = getEmployeeTicketSnapshot(emp);
                const paymentCode = buildPaymentCode(emp.id, chosenDate, 'SAL');
                const paymentGroupId = buildPaymentGroupId(emp.id, chosenDate, 'SAL');
                if(amountRaw <= 0) return alert("Ingrese un monto valido");
                if(!confirm(`Registrar pago de Gs. ${amountRaw.toLocaleString()}?`)) return;
                
                btnPay.disabled = true; btnPay.innerText = 'GUARDANDO...';
                try {
                    const isRRHH = currentUserRole === 'RRHH';
                    await addDoc(collection(db, "salaries"), {
                        employeeId: emp.id, netPay: amountRaw, salaryBase: data.base,
                        ...buildSalaryAuditFields(emp, chosenDate, selectedMonth, selectedYear, 'LIQUIDAR_SALARIOS'),
                        paymentCode, paymentGroupId, ticketTotalAmount: amountRaw,
                        month: selectedMonth, year: selectedYear, date: chosenDate,
                        status: 'Pagado', paymentMethod: 'EFECTIVO', type: 'LIQUIDACION', details: observation, createdAt: serverTimestamp(),
                        estadoAprobacion: isRRHH ? 'PENDIENTE_RENDICION' : 'APROBADO',
                        creadoPorRol: currentUserRole
                    });
                    
                    const batch = [];
                    data.valesList.forEach(v => batch.push(updateDoc(doc(db, "vales", v.id), { status: 'Cobrado' })));
                    data.comisionesList
                              .filter(c => c.status === 'Aprobado')
                              .forEach(c => batch.push(updateDoc(doc(db, "comisiones", c.id), { status: 'Pagado' })));
                    
                    if(batch.length > 0) await Promise.all(batch);

                    toastCb("Exito", "Pago registrado correctamente.");
                    closePayrollModal();
                    renderGrid(); 

                    // IMPRIMIR TICKET AL CONFIRMAR (CON DOBLE TICKET SI ES RRHH) DE FORMA NO BLOQUEANTE
                    printTicket({
                        sucursal: ticketEmployee.branch, 
                        employeeName: ticketEmployee.name, 
                        employeePosition: ticketEmployee.position, 
                        paymentCode,
                        type: emp.status === 'INACTIVO' ? 'LIQUIDACION FINAL' : 'LIQUIDACION DE SUELDO', 
                        detail: observation ? `Periodo: ${selectedMonth}/${selectedYear} | Obs: ${observation}` : `Periodo: ${selectedMonth}/${selectedYear}`, 
                        amount: amountRaw,
                        doubleTicket: isRRHH
                    }).catch(err => console.error("Error al imprimir ticket:", err));
                } catch (e) { 
                    console.error(e); 
                    toastCb("Error", "Error al procesar el pago."); 
                    btnPay.disabled = false; 
                }
            };
        }
    }

    if(btnPrint) {
        btnPrint.onclick = () => {
            const branch = branchFilter ? branchFilter.value : 'TODAS'; 
            const sorted = [...employees].sort((a,b) => a.fullName.localeCompare(b.fullName));
            let filas = '';
            let granTotal = 0;

            sorted.forEach(emp => {
                if(branch !== 'TODAS' && emp.branch !== branch) return;
                if (!isEmployeeRelevantForPeriod(emp, selectedYear, selectedMonth)) return;
                
                // NO IMPRIMIR FANTASMAS EN REPORTES (misma logica que la grilla)
                if (emp.status === 'INACTIVO' && emp.endDate) {
                    const salida = new Date(emp.endDate + 'T00:00:00');
                    const mesSalida = salida.getMonth() + 1;
                    const anioSalida = salida.getFullYear();
                    if (selectedYear > anioSalida) return;
                    if (selectedYear === anioSalida && selectedMonth > mesSalida) return;
                }

                const d = calculateTotals(emp, selectedYear, selectedMonth);
                
                filas += `
                <tr>
                    <td>${emp.fullName} ${emp.status==='INACTIVO' ? '(BAJA)' : ''}</td>
                    <td class="text-right">${d.base.toLocaleString()}</td>
                    <td class="text-right">+${d.comisiones.toLocaleString()}</td>
                    <td class="text-right">-${(d.vales + d.descuentos).toLocaleString()}</td>
                    <td class="text-right">-${d.yaPagado.toLocaleString()}</td>
                    <td class="text-right font-bold">${d.saldo.toLocaleString()}</td>
                </tr>`;
                granTotal += d.saldo;
            });

            const ventana = window.open('', '_blank', 'width=900,height=600');
            ventana.document.write(`
                <html>
                <head>
                    <title>Nomina - ${branch}</title>
                    <style>
                        body { font-family: 'Arial', sans-serif; padding: 20px; color: #333; }
                        h1 { font-size: 20px; margin-bottom: 5px; text-transform: uppercase; }
                        p { margin: 0; font-size: 12px; color: #666; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 11px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f8f9fa; font-weight: bold; text-transform: uppercase; }
                        .text-right { text-align: right; }
                        .font-bold { font-weight: bold; }
                        .total-row { background-color: #f1f5f9; font-weight: bold; font-size: 14px; }
                        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 15px; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div>
                            <h1>PLANILLA DE SUELDOS Y JORNALES</h1>
                            <p>EMPRESA: LIN GROUP</p>
                            <p>PERIODO: ${selectedMonth}/${selectedYear}</p>
                        </div>
                        <div style="text-align: right;">
                            <p>SUCURSAL / CENTRO DE COSTO</p>
                            <h2 style="margin: 0; font-size: 16px;">${branch}</h2>
                            <p>FECHA IMPRESION: ${new Date().toLocaleDateString()}</p>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>FUNCIONARIO</th>
                                <th class="text-right">SUELDO BASE</th>
                                <th class="text-right">COMISIONES</th>
                                <th class="text-right">DESC/VALES</th>
                                <th class="text-right">ADELANTOS</th>
                                <th class="text-right">NETO A COBRAR</th>
                            </tr>
                        </thead>
                        <tbody>${filas}</tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="5" class="text-right">TOTAL A PAGAR:</td>
                                <td class="text-right">Gs. ${granTotal.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                    <div style="margin-top: 40px; text-align: center; font-size: 10px; color: #999;">
                        <p>--- FIN DEL DOCUMENTO ---</p>
                    </div>
                    <script>
                        window.onload = function() { window.print(); }
                    </script>
                </body>
                </html>
            `);
            ventana.document.close();
        };
    }

    if(monthInput) {
        monthInput.addEventListener('change', (e) => {
            const [y, m] = e.target.value.split('-');
            selectedYear = parseInt(y); selectedMonth = parseInt(m); renderGrid();
        });
    }
    if(searchInput) searchInput.addEventListener('input', () => renderGrid());
    if(branchFilter) branchFilter.addEventListener('change', () => renderGrid());

    renderGrid();
}

// ==========================================
// 3. VISTA HTML: PAGO INDIVIDUAL
// ==========================================
export function getViewIndividualPayment(employees) {
    const today = new Date().toISOString().split('T')[0];
    return `
        <div class="max-w-2xl mx-auto bg-white p-10 rounded-[40px] shadow-xl border border-indigo-50 fade-in">
            <h3 class="text-2xl font-black text-slate-800 mb-8">Pago Individual</h3>
            <form id="individualPayForm" class="space-y-6">
                <div class="relative">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Funcionario (Solo Activos)</label>
                    <input type="text" id="paySearchEmp" placeholder="Buscar funcionario..." autocomplete="off" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700">
                    <div id="payEmpList" class="hidden absolute w-full bg-white border border-slate-200 rounded-xl shadow-xl mt-1 max-h-48 overflow-y-auto z-50"></div>
                    <input type="hidden" id="payEmpId">
                </div>
                <div id="payMiniStatement" class="hidden bg-indigo-50 p-5 rounded-2xl border border-indigo-100 animate-fade-in-up">
                    <div class="flex justify-between items-center mb-2"><span class="text-xs font-bold text-indigo-400 uppercase">Salario Anterior Pendiente</span><span class="text-xs font-bold text-slate-500" id="miniDate"></span></div>
                    <div class="grid grid-cols-2 gap-4 text-center">
                        <div class="bg-white p-3 rounded-xl shadow-sm"><p class="text-[10px] text-slate-400 font-bold uppercase">Base Adeudada</p><p id="miniBase" class="font-black text-slate-700">0</p></div>
                        <div class="bg-white p-3 rounded-xl shadow-sm border border-indigo-100"><p class="text-[10px] text-indigo-400 font-bold uppercase">Total Pendiente</p><p id="miniNet" class="font-black text-indigo-600 text-lg">0</p></div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-6">
                    <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Fecha</label><input type="date" id="payDate" value="${today}" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold"></div>
                    <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Monto</label><input type="text" id="payAmount" placeholder="0" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-black text-indigo-600 text-lg"></div>
                </div>
                <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Concepto</label><input type="text" id="payDetail" placeholder="Ej: Pago de salarios pendientes..." class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold"></div>
                <button type="submit" class="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-700 flex justify-center items-center gap-2">REGISTRAR PAGO</button>
            </form>
        </div>`;
}

// ==========================================
// 4. LOGICA DE NEGOCIO: PAGO INDIVIDUAL
// ==========================================
export function setupIndividualPaymentLogic(toastCb, employees, vales, comisiones, descuentos, salaries) {
    const form = document.getElementById('individualPayForm');
    if (!form) return; 
    const submitLabel = "REGISTRAR PAGO";

    const now = new Date();
    const currentMonth = now.getMonth() + 1; 
    const currentYear = now.getFullYear(); 
    const getDinero = (val) => {
        if (!val) return 0;
        const s = String(val).replace(/\./g, '').replace(/,/g, '').replace(/\D/g, ''); 
        return Number(s) || 0;
    };

    const getMesAnio = (item) => {
        if (!item) return null;
        if (item.month && item.year) return { m: Number(item.month), y: Number(item.year) };
        if (item.date && typeof item.date === 'string') {
            const parts = item.date.split('-');
            return { m: Number(parts[1]), y: Number(parts[0]) };
        }
        const ts = item.createdAt || item.fecha;
        if (ts && ts.toDate) {
            const d = ts.toDate();
            return { m: d.getMonth() + 1, y: d.getFullYear() };
        }
        return null;
    };

    const periodToIndex = (year, month) => (year * 12) + (month - 1);
    const indexToPeriod = (index) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });
    const formatPeriod = (month, year) => `${String(month).padStart(2, '0')}/${year}`;
    const getPreviousPeriod = (year, month) => month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

    const getRelevantMonthsUntil = (emp, limitYear, limitMonth) => {
        const previous = getPreviousPeriod(limitYear, limitMonth);
        return isEmployeeRelevantForPeriod(emp, previous.year, previous.month) ? [previous] : [];
    };

    const buildMonthlyDebt = (emp, year, month) => {
        const salaryData = getBaseSalaryForMonth(emp, year, month);
        const base = salaryData.monto;

        const filterByPeriod = (item) => {
            if (item.employeeId !== emp.id) return false;
            if (isSoftDeleted(item)) return false;
            const st = (item.status || '').toLowerCase();
            if (st.includes('anulado') || st.includes('rechazado')) return false;
            const fecha = getMesAnio(item);
            return fecha && fecha.m === month && fecha.y === year;
        };

        const totalVales = vales.filter(filterByPeriod).reduce((sum, v) => sum + getDinero(v.approvedAmount ?? v.amount), 0);
        const totalDesc = descuentos.filter(filterByPeriod).reduce((sum, d) => sum + getDinero(d.amount), 0);
        const totalPagos = salaries.filter(filterByPeriod).reduce((sum, p) => sum + getDinero(p.netPay), 0);
        const totalComis = comisiones.filter(filterByPeriod).reduce((sum, c) => sum + getDinero(c.amount), 0);
        const saldo = (base + totalComis) - (totalVales + totalDesc + totalPagos);

        return {
            year,
            month,
            label: formatPeriod(month, year),
            base,
            saldo: saldo > 0 ? Math.floor(saldo) : 0
        };
    };

    const getDebtSummary = (emp, limitYear, limitMonth) => {
        const breakdown = getRelevantMonthsUntil(emp, limitYear, limitMonth)
            .map(period => buildMonthlyDebt(emp, period.year, period.month))
            .filter(period => period.saldo > 0);

        return {
            breakdown,
            total: breakdown.reduce((sum, item) => sum + item.saldo, 0),
            baseTotal: breakdown.reduce((sum, item) => sum + item.base, 0)
        };
    };

    const buildDebtDescription = (breakdown) => {
        if (!breakdown.length) return '';
        if (breakdown.length === 1) return `Saldo Pendiente ${breakdown[0].label}`;
        return `Saldos ${breakdown[0].label} y ${breakdown[breakdown.length - 1].label}`;
    };

    const restoreSubmitButton = (btn) => {
        btn.disabled = false;
        btn.innerText = submitLabel;
    };

    const searchInput = document.getElementById('paySearchEmp');
    const listDiv = document.getElementById('payEmpList');
    const idInput = document.getElementById('payEmpId');
    const amountInput = document.getElementById('payAmount');
    
    if(amountInput) {
        amountInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '');
            e.target.value = new Intl.NumberFormat('es-PY').format(val);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const txt = e.target.value.toLowerCase();
            idInput.value = '';
            document.getElementById('payMiniStatement').classList.add('hidden');
            listDiv.innerHTML = ''; 
            listDiv.classList.add('hidden');
            if(!txt) return;

            // FILTRAMOS PARA QUE NO SE LE PUEDA DAR ADELANTOS A INACTIVOS
            const matches = employees.filter(e => e.fullName.toLowerCase().includes(txt) && e.status !== 'INACTIVO');
            
            if(matches.length > 0) {
                listDiv.classList.remove('hidden');
                matches.forEach(emp => {
                    const div = document.createElement('div');
                    div.className = "p-3 hover:bg-blue-50 cursor-pointer border-b text-sm font-bold text-slate-700";
                    div.innerText = emp.fullName;
                    div.onclick = () => {
                        searchInput.value = emp.fullName;
                        idInput.value = emp.id;
                        listDiv.classList.add('hidden');

                        const debtSummary = getDebtSummary(emp, currentYear, currentMonth);
                        const miniDiv = document.getElementById('payMiniStatement');
                        const lblSaldo = document.getElementById('miniNet');
                        const detailInput = document.getElementById('payDetail');
                        const previousPeriod = getPreviousPeriod(currentYear, currentMonth);

                        miniDiv.classList.remove('hidden');
                        document.getElementById('miniDate').innerText = debtSummary.breakdown.length
                            ? debtSummary.breakdown[0].label
                            : formatPeriod(previousPeriod.month, previousPeriod.year); 
                        
                        document.getElementById('miniBase').innerText = debtSummary.baseTotal.toLocaleString();

                        if (debtSummary.total > 0) {
                            lblSaldo.innerHTML = `<span class="text-rose-600 font-black animate-pulse">PENDIENTE: Gs. ${debtSummary.total.toLocaleString()}</span>`;
                            amountInput.value = debtSummary.total.toLocaleString('es-PY'); 
                            detailInput.value = buildDebtDescription(debtSummary.breakdown);
                        } else {
                            lblSaldo.innerHTML = `<span class="text-emerald-500 font-bold">AL DIA</span>`;
                            amountInput.value = '';
                            detailInput.value = 'Adelanto de Sueldo';
                        }
                    };
                    listDiv.appendChild(div);
                });
            }
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerText = "GUARDANDO...";

        try {
            const empId = idInput.value;
            const montoPago = getDinero(amountInput.value);
            const fechaPago = document.getElementById('payDate').value; 
            const detalle = document.getElementById('payDetail').value;
            const selectedEmployee = employees.find(e => e.id === empId);
            const ticketEmployee = getEmployeeTicketSnapshot(selectedEmployee);
            const [rawYear, rawMonth] = (fechaPago || '').split('-').map(Number);
            const payYear = rawYear || currentYear;
            const payMonth = rawMonth || currentMonth;
            const paymentCode = buildPaymentCode(empId, fechaPago, 'IND');
            const paymentGroupId = buildPaymentGroupId(empId, fechaPago, 'IND');
            
            if (!empId || montoPago <= 0) {
                alert("Por favor seleccione un funcionario y un monto valido.");
                restoreSubmitButton(btn);
                return;
            }

            if (!selectedEmployee) {
                alert("No se encontro el funcionario seleccionado. Busquelo nuevamente en la lista.");
                restoreSubmitButton(btn);
                return;
            }

            if (!ticketEmployee.name) {
                alert("No se pudo resolver el nombre del funcionario. Seleccione nuevamente desde la lista.");
                restoreSubmitButton(btn);
                return;
            }

            const debtSummary = getDebtSummary(selectedEmployee, payYear, payMonth);
            let restante = montoPago;
            const appliedDetails = [];

            const isRRHH = currentUserRole === 'RRHH';
            if (debtSummary.total > 0) {
                for (const debt of debtSummary.breakdown) {
                    if (restante <= 0) break;

                    const aplicado = Math.min(restante, debt.saldo);
                    if (aplicado <= 0) continue;

                    await addDoc(collection(db, "salaries"), {
                        employeeId: empId,
                        netPay: aplicado,
                        salaryBase: debt.base,
                        ...buildSalaryAuditFields(selectedEmployee, fechaPago, debt.month, debt.year, 'PAGO_INDIVIDUAL'),
                        paymentCode, paymentGroupId, ticketTotalAmount: montoPago,
                        date: fechaPago,
                        month: debt.month,
                        year: debt.year,
                        status: 'Pagado',
                        paymentMethod: 'EFECTIVO',
                        type: 'LIQUIDACION',
                        details: detalle ? `${detalle} (Imputado a ${debt.label})` : `Cancelacion ${debt.label}`,
                        createdAt: serverTimestamp(),
                        estadoAprobacion: isRRHH ? 'PENDIENTE_RENDICION' : 'APROBADO',
                        creadoPorRol: currentUserRole
                    });
                    appliedDetails.push(`${debt.label}: Gs. ${aplicado.toLocaleString('es-PY')}`);
                    restante -= aplicado;
                }
            }

            if (restante > 0) {
                await addDoc(collection(db, "salaries"), {
                    employeeId: empId,
                    netPay: restante,
                    ...buildSalaryAuditFields(selectedEmployee, fechaPago, payMonth, payYear, 'PAGO_INDIVIDUAL'),
                    paymentCode, paymentGroupId, ticketTotalAmount: montoPago,
                    date: fechaPago,
                    month: payMonth,
                    year: payYear,
                    status: 'Pagado',
                    paymentMethod: 'EFECTIVO',
                    type: 'INDIVIDUAL',
                    details: detalle,
                    createdAt: serverTimestamp(),
                    estadoAprobacion: isRRHH ? 'PENDIENTE_RENDICION' : 'APROBADO',
                    creadoPorRol: currentUserRole
                });
                appliedDetails.push(`Adelanto ${formatPeriod(payMonth, payYear)}: Gs. ${restante.toLocaleString('es-PY')}`);
            }

            const ticketDetail = detalle
                ? `${detalle}${appliedDetails.length ? ` | ${appliedDetails.join(' | ')}` : ''}`
                : (appliedDetails.join(' | ') || 'Adelanto de Sueldo');

            toastCb("Exito", "Pago registrado.");
            form.reset();
            const statement = document.getElementById('payMiniStatement');
            if (statement) statement.classList.add('hidden');
            if (searchInput) searchInput.value = '';

            printTicket({
                sucursal: ticketEmployee.branch,
                employeeName: ticketEmployee.name,
                employeePosition: ticketEmployee.position,
                paymentCode,
                type: 'ADELANTO / PAGO',
                detail: ticketDetail,
                amount: montoPago,
                doubleTicket: isRRHH
            }).catch(err => console.error("Error al imprimir ticket:", err));

            alert("Pago registrado correctamente.\nEl sistema ha actualizado los saldos.");
            return;

        } catch (error) {
            console.error("ERROR GRAVE:", error);
            alert("Ocurrio un error al guardar.");
        } finally {
            restoreSubmitButton(btn);
        }
    });
}

// ==========================================
// 5. VISTA: HISTORIAL PAGOS
// ==========================================
export function getViewHistorySalaries(salaries, employees) {
    const sortedSalaries = [...salaries].sort((a,b) => {
        const dateA = a.createdAt ? a.createdAt.toDate() : new Date(a.date || 0);
        const dateB = b.createdAt ? b.createdAt.toDate() : new Date(b.date || 0);
        return dateB - dateA;
    });

    let html = `
    <div class="max-w-4xl mx-auto space-y-6 fade-in pb-20">
        <div class="bg-white p-6 rounded-[30px] shadow-lg border border-indigo-50 sticky top-4 z-20">
            <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                <div><h3 class="text-2xl font-black text-slate-800">Historial de Pagos</h3><p class="text-xs text-slate-400 font-bold uppercase tracking-widest">Cronologia de Egresos</p></div>
                <div class="relative w-full md:w-1/2">
                    <input type="text" oninput="filterPaymentHistory(this.value)" placeholder="Filtrar por nombre..." class="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 pl-10 pr-4 font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all">
                    <i class="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg"></i>
                </div>
            </div>
        </div>
        <div id="historyList" class="space-y-4">
            <div id="noResultsMsg" class="hidden text-center py-10 text-slate-400 font-bold">No se encontraron pagos para ese nombre.</div>`;

    if(sortedSalaries.length === 0) return html + '<div class="text-center py-20 text-slate-300 font-bold text-xl">No hay pagos registrados aun.</div></div>';

    sortedSalaries.forEach(pay => {
        const emp = employees ? employees.find(e => e.id === pay.employeeId) : null;
        const snapshotName = (pay.employeeName || '').trim();
        const snapshotPosition = (pay.employeePosition || '').trim();
        const paymentCode = pay.paymentCode || pay.paymentGroupId || `LEGACY-${String(pay.id || '').slice(-6).toUpperCase()}`;
        const empName = snapshotName || (emp ? emp.fullName : 'Funcionario Eliminado');
        const empPos = snapshotPosition || (emp ? emp.position : '---');
        const amount = pay.netPay.toLocaleString();
        let fechaDisplay = pay.date; let horaDisplay = '';
        if(pay.createdAt && pay.createdAt.toDate) {
            const d = pay.createdAt.toDate();
            if(pay.date) { const parts = pay.date.split('-'); if(parts.length === 3) fechaDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`; } 
            else { fechaDisplay = d.toLocaleDateString('es-PY', { day: '2-digit', month: 'long', year: 'numeric' }); }
            horaDisplay = d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
        } else if (pay.date) { const parts = pay.date.split('-'); if(parts.length === 3) fechaDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`; }

        const isInd = pay.type === 'INDIVIDUAL';
        const icon = isInd ? 'ph-hand-coins' : 'ph-wallet';
        const color = isInd ? 'text-indigo-600 bg-indigo-50' : 'text-emerald-600 bg-emerald-50';
        const borderColor = isInd ? 'border-indigo-100' : 'border-emerald-100';

        html += `
            <div class="history-item bg-white p-5 rounded-[25px] border ${borderColor} shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row justify-between items-center gap-4" data-name="${`${empName} ${pay.employeeId || ''} ${pay.sourceModule || ''} ${paymentCode}`.toLowerCase()}">
                <div class="flex items-center gap-4 w-full md:w-auto">
                    <div class="w-12 h-12 rounded-2xl ${color} flex items-center justify-center text-2xl flex-shrink-0"><i class="ph-fill ${icon}"></i></div>
                    <div class="overflow-hidden">
                        <h5 class="font-black text-slate-800 text-lg leading-tight truncate">${empName}</h5>
                        <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${empPos}</p>
                        <div class="flex flex-wrap items-center gap-2 mt-1">
                            <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded flex items-center gap-1"><i class="ph-bold ph-calendar-blank"></i> ${fechaDisplay}</span>
                            ${horaDisplay?`<span class="text-[10px] font-bold text-slate-400 flex items-center gap-1"><i class="ph-bold ph-clock"></i> ${horaDisplay}</span>`:''}
                            <span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">ID: ${pay.employeeId || 'S/ID'}</span>
                            <span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">Cod: ${paymentCode}</span>
                            ${pay.sourceModule ? `<span class="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">${pay.sourceModule}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="text-right w-full md:w-auto border-t md:border-t-0 border-slate-50 pt-3 md:pt-0 pl-0 md:pl-6 flex justify-between md:block items-center">
                    <span class="md:hidden text-xs font-bold text-slate-400 uppercase">${pay.type}</span>
                    <div><p class="font-black text-2xl text-slate-800">Gs. ${amount}</p><p class="text-[10px] text-slate-400 font-bold uppercase text-right">${pay.details || (isInd?'Adelanto':'Liquidacion')}</p></div>
                </div>
            </div>`;
    });
    return html + `</div></div>`;
}

export function getViewPaymentAudit(salaries, employees) {
    const sortedSalaries = [...salaries].sort((a, b) => {
        const dateA = a.createdAt ? a.createdAt.toDate() : new Date(a.date || 0);
        const dateB = b.createdAt ? b.createdAt.toDate() : new Date(b.date || 0);
        return dateB - dateA;
    });

    const groupedTickets = new Set(sortedSalaries.map(pay => pay.paymentGroupId || `DOC-${pay.id}`));
    const mismatchedRecords = sortedSalaries.filter(pay => {
        const currentEmployee = employees.find(emp => emp.id === pay.employeeId);
        const snapshotName = (pay.employeeName || '').trim().toUpperCase();
        const currentName = currentEmployee?.fullName ? currentEmployee.fullName.trim().toUpperCase() : '';
        return (snapshotName && currentName && snapshotName !== currentName) || (!currentEmployee && snapshotName);
    }).length;
    const totalNetPay = sortedSalaries.reduce((sum, pay) => sum + (Number(pay.netPay) || 0), 0);

    let rows = '';

    sortedSalaries.forEach(pay => {
        const currentEmployee = employees.find(emp => emp.id === pay.employeeId);
        const snapshotName = (pay.employeeName || '').trim();
        const snapshotPosition = (pay.employeePosition || '').trim();
        const paymentCode = pay.paymentCode || pay.paymentGroupId || `LEGACY-${String(pay.id || '').slice(-6).toUpperCase()}`;
        const displayName = snapshotName || currentEmployee?.fullName || 'FUNCIONARIO NO DISPONIBLE';
        const currentName = currentEmployee?.fullName || '';
        const displayPosition = snapshotPosition || currentEmployee?.position || 'SIN CARGO';
        const createdAtDate = pay.createdAt?.toDate ? pay.createdAt.toDate() : null;
        const serverDate = createdAtDate ? createdAtDate.toLocaleDateString('es-PY') : 'S/F';
        const serverTime = createdAtDate ? createdAtDate.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
        const manualDate = pay.date || '';
        const localDate = pay.createdAtLocal ? pay.createdAtLocal.slice(0, 10) : '';
        const localTime = pay.createdAtLocal ? pay.createdAtLocal.slice(11, 19) : '--:--:--';
        const sourceModule = pay.sourceModule || 'LEGACY';
        const ticketTotal = Number(pay.ticketTotalAmount) || Number(pay.netPay) || 0;
        const amount = Number(pay.netPay) || 0;
        const typeLabel = pay.type || 'SIN TIPO';
        const paymentGroupId = pay.paymentGroupId || `LEGACY-${pay.id}`;
        const periodKey = pay.periodKey || `${pay.year || '----'}-${String(pay.month || '--').padStart(2, '0')}`;
        const snapshotMismatch = snapshotName && currentName && snapshotName.toUpperCase() !== currentName.toUpperCase();
        const employeeMissing = !currentEmployee;
        const warningBadge = snapshotMismatch
            ? '<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-[10px] font-black uppercase">Nombre distinto al legajo actual</span>'
            : (employeeMissing ? '<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded-full text-[10px] font-black uppercase">Legajo no disponible</span>' : '');
        const sourceColor = sourceModule === 'PAGO_INDIVIDUAL'
            ? 'bg-indigo-100 text-indigo-700'
            : (sourceModule === 'LIQUIDAR_SALARIOS' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700');

        rows += `
            <article class="audit-item bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm hover:shadow-lg transition-all space-y-4"
                data-search="${`${displayName} ${currentName} ${pay.employeeId || ''} ${paymentGroupId} ${paymentCode} ${typeLabel} ${sourceModule} ${pay.details || ''}`.toLowerCase()}"
                data-date="${manualDate}"
                data-amount="${amount}"
                data-ticket-total="${ticketTotal}"
                data-source="${sourceModule}"
                data-type="${typeLabel}">
                <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                    <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <h4 class="text-xl font-black text-slate-800">${displayName}</h4>
                            <span class="px-2 py-1 rounded-full text-[10px] font-black uppercase ${sourceColor}">${sourceModule}</span>
                            <span class="px-2 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-700">${typeLabel}</span>
                            ${warningBadge}
                        </div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">${displayPosition}</p>
                        <div class="flex flex-wrap gap-2 text-[11px] font-bold">
                            <span class="bg-slate-100 text-slate-700 px-2 py-1 rounded-full">EmployeeId: ${pay.employeeId || 'S/ID'}</span>
                            <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Codigo: ${paymentCode}</span>
                            <span class="bg-slate-100 text-slate-700 px-2 py-1 rounded-full">Periodo: ${periodKey}</span>
                            <span class="bg-slate-100 text-slate-700 px-2 py-1 rounded-full">Grupo: ${paymentGroupId}</span>
                        </div>
                    </div>
                    <div class="xl:text-right">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Documento</p>
                        <p class="text-3xl font-black text-slate-800">Gs. ${amount.toLocaleString('es-PY')}</p>
                        <p class="text-[11px] font-bold text-slate-500">Ticket total: Gs. ${ticketTotal.toLocaleString('es-PY')}</p>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha Manual</p>
                        <p class="font-black text-slate-800 mt-1">${manualDate || 'S/F'}</p>
                    </div>
                    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Servidor</p>
                        <p class="font-black text-slate-800 mt-1">${serverDate}</p>
                        <p class="text-[11px] font-bold text-slate-500">${serverTime}</p>
                    </div>
                    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Reloj Local</p>
                        <p class="font-black text-slate-800 mt-1">${localDate || 'LEGACY'}</p>
                        <p class="text-[11px] font-bold text-slate-500">${localTime}</p>
                    </div>
                    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Snapshot</p>
                        <p class="font-black text-slate-800 mt-1">${snapshotName || 'SIN NOMBRE GUARDADO'}</p>
                        <p class="text-[11px] font-bold text-slate-500">${pay.employeeStatusSnapshot || 'SIN ESTADO'}</p>
                    </div>
                </div>

                <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Detalle / Observacion</p>
                    <p class="text-sm font-bold text-slate-700 break-words">${pay.details || 'Sin observacion registrada.'}</p>
                </div>
            </article>`;
    });

    return `
        <div class="max-w-7xl mx-auto space-y-6 fade-in pb-20">
            <div class="bg-white rounded-[32px] border border-slate-100 shadow-lg p-6 space-y-6 sticky top-4 z-20">
                <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                    <div>
                        <h3 class="text-2xl font-black text-slate-800">Auditoria de Pagos</h3>
                        <p class="text-sm text-slate-500 font-bold mt-1">Version 5.1 para rastrear tickets, diferencias de hora, montos y referencias de funcionario.</p>
                    </div>
                    <div class="flex flex-wrap gap-3 text-xs font-black uppercase">
                        <span class="bg-slate-100 text-slate-700 px-3 py-2 rounded-full">Registros: ${sortedSalaries.length}</span>
                        <span class="bg-emerald-100 text-emerald-700 px-3 py-2 rounded-full">Total: Gs. ${totalNetPay.toLocaleString('es-PY')}</span>
                        <span class="bg-blue-100 text-blue-700 px-3 py-2 rounded-full">Tickets: ${groupedTickets.size}</span>
                        <span class="bg-amber-100 text-amber-700 px-3 py-2 rounded-full">Alertas: ${mismatchedRecords}</span>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                    <input id="auditSearch" type="text" placeholder="Buscar nombre, employeeId, grupo..." class="xl:col-span-2 w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 px-4 font-bold text-slate-700 outline-none focus:border-blue-500">
                    <input id="auditDate" type="date" class="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 px-4 font-bold text-slate-700 outline-none focus:border-blue-500">
                    <input id="auditAmount" type="text" placeholder="Monto exacto" class="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 px-4 font-bold text-slate-700 outline-none focus:border-blue-500">
                    <select id="auditSource" class="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 px-4 font-bold text-slate-700 outline-none focus:border-blue-500">
                        <option value="">Todos los origenes</option>
                        <option value="PAGO_INDIVIDUAL">Pago Individual</option>
                        <option value="LIQUIDAR_SALARIOS">Liquidar Salarios</option>
                        <option value="LEGACY">Legacy / Antiguo</option>
                    </select>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select id="auditType" class="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-3 px-4 font-bold text-slate-700 outline-none focus:border-blue-500">
                        <option value="">Todos los tipos</option>
                        <option value="LIQUIDACION">Liquidacion</option>
                        <option value="INDIVIDUAL">Individual</option>
                    </select>
                    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
                        <p class="text-[10px] font-black uppercase tracking-widest text-indigo-400">Visibles</p>
                        <p id="auditVisibleCount" class="text-2xl font-black text-indigo-700">${sortedSalaries.length}</p>
                    </div>
                    <div class="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
                        <p class="text-[10px] font-black uppercase tracking-widest text-emerald-400">Suma Visible</p>
                        <p id="auditVisibleTotal" class="text-2xl font-black text-emerald-700">Gs. ${totalNetPay.toLocaleString('es-PY')}</p>
                    </div>
                </div>
            </div>

            <div id="auditEmpty" class="hidden bg-white border border-dashed border-slate-200 rounded-[32px] p-10 text-center text-slate-400 font-bold">
                No se encontraron pagos con los filtros aplicados.
            </div>

            <div id="auditList" class="space-y-4">
                ${rows || '<div class="bg-white rounded-[32px] border border-dashed border-slate-200 p-10 text-center text-slate-400 font-bold">No hay pagos registrados aun.</div>'}
            </div>
        </div>`;
}

export function setupPaymentAuditLogic() {
    const list = document.getElementById('auditList');
    if (!list) return;

    const searchInput = document.getElementById('auditSearch');
    const dateInput = document.getElementById('auditDate');
    const amountInput = document.getElementById('auditAmount');
    const sourceInput = document.getElementById('auditSource');
    const typeInput = document.getElementById('auditType');
    const emptyState = document.getElementById('auditEmpty');
    const visibleCount = document.getElementById('auditVisibleCount');
    const visibleTotal = document.getElementById('auditVisibleTotal');

    const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

    const applyFilters = () => {
        const query = (searchInput?.value || '').trim().toLowerCase();
        const date = dateInput?.value || '';
        const amount = normalizeDigits(amountInput?.value || '');
        const source = sourceInput?.value || '';
        const type = typeInput?.value || '';
        const items = Array.from(list.querySelectorAll('.audit-item'));
        let count = 0;
        let total = 0;

        items.forEach(item => {
            const itemSearch = item.dataset.search || '';
            const itemDate = item.dataset.date || '';
            const itemAmount = normalizeDigits(item.dataset.amount || '');
            const itemTicketTotal = normalizeDigits(item.dataset.ticketTotal || '');
            const itemSource = item.dataset.source || '';
            const itemType = item.dataset.type || '';

            const matchesSearch = !query || itemSearch.includes(query);
            const matchesDate = !date || itemDate === date;
            const matchesAmount = !amount || itemAmount === amount || itemTicketTotal === amount;
            const matchesSource = !source || itemSource === source;
            const matchesType = !type || itemType === type;

            const isVisible = matchesSearch && matchesDate && matchesAmount && matchesSource && matchesType;
            item.classList.toggle('hidden', !isVisible);

            if (isVisible) {
                count++;
                total += Number(item.dataset.amount || 0);
            }
        });

        if (visibleCount) visibleCount.textContent = String(count);
        if (visibleTotal) visibleTotal.textContent = `Gs. ${total.toLocaleString('es-PY')}`;
        if (emptyState) emptyState.classList.toggle('hidden', count > 0);
    };

    [searchInput, dateInput, sourceInput, typeInput].forEach(input => input?.addEventListener('input', applyFilters));
    amountInput?.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        e.target.value = value ? new Intl.NumberFormat('es-PY').format(value) : '';
        applyFilters();
    });

    applyFilters();
}

export function initSalariosGlobalListeners(toastCb) {}


