/**
 * ============================================================================
 * CORE SYSTEM ENGINE - LINGROUP MANAGEMENT v4.0 (2026)
 * ============================================================================
 * Este archivo centraliza la gestion de estados, listeners de base de datos
 * en tiempo real, ruteo de vistas y orquestacion de modulos contables.
 * * Desarrollado con Firebase Firestore y Tailwind CSS.
 * * MODIFICADO: Modulo de Sucursales Dinamicas con Horarios Operativos.
 * ============================================================================
 */

import { onAuthStateChanged, signOut, createUser } from './auth.js';

import {
    collection,
    onSnapshot,
    query,
    orderBy,
    deleteDoc,
    updateDoc,
    doc,
    addDoc,
    serverTimestamp,
    where,
} from './db.js';

import { auth, db } from './firebase-config.js';
import { uiConfirm, uiPrompt } from './ui.js';
import * as Export from './export.js';
import { printTicket } from './print-service.js';

import * as ValesModule from './vales.js';
import * as SalariosModule from './salarios.js';
import * as ComisionesModule from './comisiones.js';
import * as ProveedoresModule from './proveedores.js';
import * as AusenciasModule from './ausencias.js';
import * as DesempenoModule from './desempeno.js';

const VERSION = '5.7.0';

const LISTA_SUCURSALES = [
    'MR LIN RESTAURANTE',
    'ESTUDIO JURIDICO LIN GROUP',
    'EMPENOS CHICOLIN',
    'PRESTAMOS CHICOLIN',
    'COMPUTECH',
    'CONSULTORIA LIN GROUP',
];

const CONFIG_UI = {
    toastDuration: 4000,
    sidebarActive: 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 translate-x-2',
    sidebarInactive: 'text-slate-400 hover:text-white hover:bg-slate-800/50',
    maxPhotoSize: 500, // px
};

let employeesData = [];
let valesData = [];
let comisionesData = [];
let salariesData = [];
let descuentosData = [];
let proveedoresData = [];
let ausenciasData = [];
let desempenoData = [];
let salaryHistoryData = [];
let usersData = [];
let currentUserRole = null;
let usersLoaded = false;
let appBootstrapped = false;
let sucursalesData = []; // NUEVO: Estado global para sucursales
let currentView = 'dashboard';
let rrhhModalLocks = 0;

const RRHH_ALLOWED_VIEWS = [
    'dashboard',
    'rrhh_new',
    'rrhh_list',
    'rrhh_liquidaciones',
    'admin_desc',
    'admin_suc',
    'admin_ausencia_new',
    'admin_ausencia_list',
    'salario_pend',
    'salario_individual',
    'salario_ind',
];

function denyAccess() {
    console.warn("Acceso denegado: el usuario no tiene un rol asignado en la coleccion 'users'.");
    document.body.innerHTML = `
        <div style="font-family:Inter,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;padding:24px;">
            <div style="background:#fff;border-radius:28px;padding:40px;max-width:460px;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,.35);">
                <div style="font-size:48px;">&#128274;</div>
                <h1 style="font-size:20px;font-weight:900;color:#0f172a;margin:16px 0 8px;">Acceso restringido</h1>
                <p style="color:#64748b;font-size:14px;font-weight:600;margin:0 0 24px;">
                    Tu usuario no tiene un rol asignado en el sistema. Solicita al administrador que registre tu correo en la gestion de usuarios.
                </p>
                <button id="denyLogout" style="background:#dc2626;color:#fff;border:0;font-weight:800;padding:14px 28px;border-radius:16px;cursor:pointer;">Cerrar sesion</button>
            </div>
        </div>`;
    const denyLogout = document.getElementById('denyLogout');
    if (denyLogout) {
        denyLogout.addEventListener('click', () => {
            signOut(auth).then(() => {
                window.location.href = 'index.html';
            });
        });
    }
}

function syncUserRole() {
    if (!auth.currentUser) return;

    // Esperamos a que la coleccion 'users' este cargada para resolver el rol.
    // Sin rol explicito NO se concede acceso (antes se asumia ADMIN por defecto).
    if (!usersLoaded) return;

    const email = (auth.currentUser.email || '').toLowerCase();
    const userDoc = usersData.find((u) => u.email && u.email.toLowerCase() === email);
    const resolvedRole = userDoc ? userDoc.role : null;

    if (!resolvedRole) {
        denyAccess();
        return;
    }

    currentUserRole = resolvedRole;

    ValesModule.setValesUserRole(currentUserRole);
    SalariosModule.setSalariosUserRole(currentUserRole);

    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) userEmailEl.innerText = auth.currentUser.email;

    const roleBadge = document.querySelector('#userEmail + p');
    if (roleBadge) roleBadge.innerText = currentUserRole === 'RRHH' ? 'RRHH' : 'Admin';

    if (currentUserRole === 'RRHH' && !RRHH_ALLOWED_VIEWS.includes(currentView)) {
        currentView = 'dashboard';
    }

    renderMenu();

    if (!appBootstrapped) {
        appBootstrapped = true;
        renderContent();
    }
}

onAuthStateChanged(auth, (user) => {
    if (!user) {
        console.log('Acceso no autorizado. Redireccionando...');
        window.location.href = 'index.html';
    } else {
        console.log(`Sesion iniciada: ${user.email}`);
        syncUserRole();
        initApp();
    }
});

const btnLogout = document.getElementById('btnLogout');
if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        const confirmado = await uiConfirm({
            title: 'Cerrar sesion',
            message: 'Seguro que desea cerrar sesion?',
            tone: 'warning',
            confirmText: 'Cerrar sesion',
        });
        if (confirmado) {
            signOut(auth).then(() => {
                console.log('Sesion cerrada.');
                window.location.href = 'index.html';
            });
        }
    });
}

function initApp() {
    console.info('%cInicializando aplicacion LINGROUP', 'color: #3b82f6; font-weight: bold; font-size: 1.2rem;');
    syncVersionBadges();
    if (currentUserRole) renderMenu();

    onSnapshot(collection(db, 'users'), (snapshot) => {
        usersData = [];
        snapshot.forEach((doc) => usersData.push({ id: doc.id, ...doc.data() }));
        usersLoaded = true;
        syncUserRole();
        refreshCurrentViewIf('admin_users');
    });

    onSnapshot(query(collection(db, 'sucursales'), orderBy('name')), (snapshot) => {
        sucursalesData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        console.log(`${sucursalesData.length} sucursales sincronizadas.`);
        refreshCurrentViewIf('admin_suc');
        refreshCurrentViewIf('rrhh_new');
    });

    const qEmp = query(collection(db, 'employees'), orderBy('fullName'));
    onSnapshot(qEmp, (snapshot) => {
        employeesData = [];
        snapshot.forEach((doc) => employeesData.push({ id: doc.id, ...doc.data() }));
        updateDashboardCards();
        refreshCurrentViewIf('rrhh');
        refreshCurrentViewIf('salario');
    });

    onSnapshot(collection(db, 'salaryHistory'), (snapshot) => {
        salaryHistoryData = [];
        snapshot.forEach((doc) => salaryHistoryData.push({ id: doc.id, ...doc.data() }));
        SalariosModule.setSalaryHistoryData(salaryHistoryData);
        refreshCurrentViewIf('rrhh');
        refreshCurrentViewIf('salario');
    });

    onSnapshot(collection(db, 'vales'), (snapshot) => {
        valesData = [];
        snapshot.forEach((doc) => valesData.push({ id: doc.id, ...doc.data() }));
        refreshCurrentViewIf('vales');
        refreshCurrentViewIf('salario');
    });

    onSnapshot(collection(db, 'comisiones'), (snapshot) => {
        comisionesData = [];
        snapshot.forEach((doc) => comisionesData.push({ id: doc.id, ...doc.data() }));
        refreshCurrentViewIf('com');
        refreshCurrentViewIf('salario');
    });

    const qSal = query(collection(db, 'salaries'), orderBy('date', 'desc'));
    onSnapshot(qSal, (snapshot) => {
        salariesData = [];
        snapshot.forEach((doc) => salariesData.push({ id: doc.id, ...doc.data() }));
        refreshCurrentViewIf('salario');
        updateDashboardCards();
    });

    onSnapshot(collection(db, 'descuentos'), (snapshot) => {
        descuentosData = [];
        snapshot.forEach((doc) => descuentosData.push({ id: doc.id, ...doc.data() }));
        refreshCurrentViewIf('admin_desc');
        refreshCurrentViewIf('salario_pend');
        refreshCurrentViewIf('salario_individual');
    });

    onSnapshot(collection(db, 'proveedores'), (snap) => {
        proveedoresData = [];
        snap.forEach((d) => proveedoresData.push({ id: d.id, ...d.data() }));
        refreshCurrentViewIf('admin_prov');
    });

    onSnapshot(collection(db, 'ausencias'), (snap) => {
        ausenciasData = [];
        snap.forEach((d) => ausenciasData.push({ id: d.id, ...d.data() }));
        refreshCurrentViewIf('admin_ausencia');
    });

    onSnapshot(collection(db, 'evaluaciones'), (snap) => {
        desempenoData = [];
        snap.forEach((d) => desempenoData.push({ id: d.id, ...d.data() }));
        refreshCurrentViewIf('admin_desempeno');
    });

    ValesModule.initValesGlobalListeners(showToast);
    ComisionesModule.initComisionesGlobalListeners(showToast);
    SalariosModule.initSalariosGlobalListeners(showToast);
    ProveedoresModule.initProveedoresListeners(showToast);
    AusenciasModule.initAusenciasListeners(showToast);
    DesempenoModule.initDesempenoListeners(showToast);

    initRRHHGlobalListeners();
    if (currentUserRole) renderContent();
}

function refreshCurrentViewIf(sectionKey) {
    if (currentView.includes(sectionKey) || currentView === 'dashboard') {
        renderContent();
    }
}

function syncVersionBadges() {
    document.querySelectorAll('[data-system-version]').forEach((node) => {
        node.textContent = VERSION;
    });
}

function lockRRHHModalScroll() {
    if (rrhhModalLocks === 0) {
        document.body.dataset.rrhhPreviousOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
    }
    rrhhModalLocks += 1;
}

function unlockRRHHModalScroll() {
    rrhhModalLocks = Math.max(0, rrhhModalLocks - 1);
    if (rrhhModalLocks === 0) {
        document.body.style.overflow = document.body.dataset.rrhhPreviousOverflow || '';
        delete document.body.dataset.rrhhPreviousOverflow;
    }
}

// ==========================================
// LOGICA DE GESTION DE RECURSOS HUMANOS
// ==========================================

function initRRHHGlobalListeners() {
    const getSalaryHistoryForEmployee = (employeeId) =>
        SalariosModule.getSalaryHistoryForEmployee(employeeId).filter((item) => !item.deleted && item.active !== false);

    const closeSalaryIncreaseModal = () => {
        const modal = document.getElementById('salaryIncreaseModal');
        if (!modal || modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        unlockRRHHModalScroll();
    };

    const renderSalaryHistoryPreview = (employee) => {
        const container = document.getElementById('salaryIncreaseHistory');
        if (!container || !employee) return;

        const history = getSalaryHistoryForEmployee(employee.id);
        if (!history.length) {
            container.innerHTML = `<div class="text-xs text-slate-400 font-bold bg-slate-50 rounded-2xl p-4 border border-slate-100">Todavia no hay aumentos registrados para este funcionario.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="space-y-2">
                ${history
                    .slice(0, 6)
                    .map(
                        (item) => `
                    <div class="p-3 rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                        <div>
                            <p class="text-xs font-black text-slate-700">Gs. ${Number(item.previousSalary || 0).toLocaleString()} -> Gs. ${Number(item.newSalary || 0).toLocaleString()}</p>
                            <p class="text-[10px] font-bold text-slate-400 uppercase">${formatDateDisplay(item.effectiveFrom)}${item.reason ? ` | ${item.reason}` : ''}</p>
                        </div>
                        <span class="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">${item.createdBy || 'Sistema'}</span>
                    </div>
                `
                    )
                    .join('')}
            </div>`;
    };

    window.closeSalaryIncreaseModal = closeSalaryIncreaseModal;

    window.openSalaryIncreaseModal = (id) => {
        const employee = employeesData.find((item) => item.id === id);
        const modal = document.getElementById('salaryIncreaseModal');
        const form = document.getElementById('salaryIncreaseForm');
        if (!employee || !modal || !form) return;

        const today = new Date().toISOString().split('T')[0];
        const currentSalary = SalariosModule.getEffectiveSalaryAmountForDate(employee, new Date());

        form.employeeId.value = employee.id;
        form.employeeName.value = employee.fullName;
        form.currentSalary.value = currentSalary.toLocaleString('es-PY');
        form.newSalary.value = '';
        form.effectiveFrom.value = today;
        form.reason.value = '';

        renderSalaryHistoryPreview(employee);
        modal.classList.remove('hidden');
        lockRRHHModalScroll();
    };

    window.saveSalaryIncrease = async (event) => {
        event.preventDefault();
        const form = document.getElementById('salaryIncreaseForm');
        if (!form) return;

        const btn = document.getElementById('btnSaveSalaryIncrease');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'GUARDANDO...';

        try {
            const employeeId = form.employeeId.value;
            const employee = employeesData.find((item) => item.id === employeeId);
            const rawNewSalary = Number(form.newSalary.value);
            const newSalary = Math.floor(rawNewSalary);
            const effectiveFrom = form.effectiveFrom.value;
            const reason = (form.reason.value || '').trim();
            const effectiveDate = parseDateOnly(effectiveFrom);

            if (!employee) throw new Error('Funcionario inexistente.');
            if (!effectiveDate) throw new Error('La fecha de vigencia es obligatoria.');
            if (!Number.isFinite(rawNewSalary)) throw new Error('Ingrese un nuevo salario valido.');
            if (newSalary < 0) throw new Error('El salario no puede ser negativo.');
            if (newSalary === 0) throw new Error('El salario no puede quedar en cero.');
            if (reason.length > 300) throw new Error('La observacion no puede superar 300 caracteres.');

            const effectiveMonth = `${effectiveDate.getFullYear()}-${String(effectiveDate.getMonth() + 1).padStart(2, '0')}`;
            const history = getSalaryHistoryForEmployee(employee.id);
            if (history.some((item) => item.effectiveMonth === effectiveMonth)) {
                throw new Error('Ya existe un aumento activo para ese mismo mes.');
            }

            const previousSalary = SalariosModule.getEffectiveSalaryAmountForPeriod(
                employee,
                effectiveDate.getFullYear(),
                effectiveDate.getMonth() + 1
            );
            if (newSalary <= previousSalary) {
                throw new Error('El nuevo salario debe ser mayor al salario vigente para esa fecha.');
            }

            await addDoc(collection(db, 'salaryHistory'), {
                employeeId: employee.id,
                previousSalary,
                newSalary,
                effectiveFrom,
                effectiveMonth,
                reason,
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.email || 'Sistema',
                active: true,
            });

            const today = new Date();
            const shouldSyncEmployeeCard = effectiveDate <= new Date(today.getFullYear(), today.getMonth() + 1, 0);
            if (shouldSyncEmployeeCard) {
                await updateDoc(doc(db, 'employees', employee.id), {
                    salary: newSalary,
                    updatedAt: serverTimestamp(),
                });
            }

            showToast('Exito', 'Aumento salarial registrado.');
            closeSalaryIncreaseModal();
        } catch (error) {
            console.error(error);
            showToast('Error', error.message || 'No se pudo registrar el aumento salarial.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    };

    window.deleteEmployee = async (id, name) => {
        const confirmStr =
            `PELIGRO: Esta a punto de eliminar a ${name}.\n\n` +
            `Esto no borrara sus pagos historicos pero el funcionario ya no aparecera en las planillas.\n` +
            `Desea continuar?`;
        const confirmado = await uiConfirm({
            title: 'Eliminar funcionario',
            message: confirmStr,
            tone: 'danger',
            confirmText: 'Eliminar',
        });
        if (!confirmado) return;

        try {
            await deleteDoc(doc(db, 'employees', id));
            showToast('Eliminado', 'Funcionario removido del sistema.');
        } catch (error) {
            console.error(error);
            showToast('Error', 'Fallo al intentar eliminar el registro.');
        }
    };

    // Dar de baja (RRHH)
    window.deactivateEmployee = async (id, name) => {
        const emp = employeesData.find((e) => e.id === id);
        const today = new Date().toISOString().split('T')[0];
        const endDate = await uiPrompt({
            title: 'Dar de baja',
            message: `Fecha de baja para ${name} (AAAA-MM-DD):`,
            defaultValue: today,
            inputType: 'date',
            confirmText: 'Dar de baja',
        });
        if (!endDate) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return showToast('Error', 'Formato de fecha invalido (AAAA-MM-DD).');
        if (emp?.startDate && endDate < emp.startDate)
            return showToast('Error', 'La fecha de baja no puede ser anterior al ingreso.');

        try {
            await updateDoc(doc(db, 'employees', id), { status: 'INACTIVO', endDate });
            showToast('Exito', `${name} dado de baja.`);
        } catch (error) {
            console.error(error);
            showToast('Error', 'No se pudo dar de baja al funcionario.');
        }
    };

    window.editEmployee = (id) => {
        const emp = employeesData.find((e) => e.id === id);
        if (!emp) return;

        navigateTo('rrhh_new', 'Editar Funcionario');

        setTimeout(() => {
            const form = document.getElementById('empForm');
            if (!form) return;

            form.employeeId.value = emp.id;
            form.fullName.value = emp.fullName;
            form.dni.value = emp.dni || '';
            form.dob.value = emp.dob;
            form.startDate.value = emp.startDate || '';
            form.phone.value = emp.phone;
            form.address.value = emp.address;
            form.position.value = emp.position;
            form.salary.value = emp.salary;
            form.branch.value = emp.branch;

            if (form.status) form.status.value = emp.status || 'ACTIVO';
            if (form.endDate) form.endDate.value = emp.endDate || '';

            const endDateContainer = document.getElementById('endDateContainer');
            if (endDateContainer) {
                if (emp.status === 'INACTIVO') endDateContainer.classList.remove('hidden');
                else endDateContainer.classList.add('hidden');
            }

            const preview = document.getElementById('preview');
            const icon = document.getElementById('iconPreview');
            if (emp.photo) {
                preview.src = emp.photo;
                preview.classList.remove('hidden');
                icon.classList.add('hidden');
            }

            const btn = document.getElementById('btnSave');
            btn.innerHTML = '<i class="ph-bold ph-arrows-clockwise text-xl"></i> ACTUALIZAR FICHA';
            btn.classList.replace('bg-blue-600', 'bg-indigo-600');
            document.getElementById('formTitle').innerText = `Editando: ${emp.fullName}`;
        }, 150);
    };

    window.toggleEndDateVisibility = (statusSelect) => {
        const endDateContainer = document.getElementById('endDateContainer');
        if (!endDateContainer) return;

        if (statusSelect.value === 'INACTIVO') {
            endDateContainer.classList.remove('hidden');
        } else {
            endDateContainer.classList.add('hidden');
            const endDateInput = document.querySelector('input[name="endDate"]');
            if (endDateInput) endDateInput.value = '';
        }
    };
}

const menuItemsAdmin = [
    { id: 'dashboard', label: 'Resumen Global', icon: 'ph-chart-pie-slice', type: 'single' },
    {
        label: 'Gestion RRHH',
        icon: 'ph-users-three',
        type: 'group',
        children: [
            { id: 'rrhh_new', label: 'Nuevo Funcionario' },
            { id: 'rrhh_list', label: 'Lista de Personal' },
            { id: 'rrhh_liquidaciones', label: 'Calendario de Liquidaciones' },
        ],
    },
    {
        label: 'Vales / Anticipos',
        icon: 'ph-ticket',
        type: 'group',
        children: [
            { id: 'vales_new', label: 'Solicitar Vale' },
            { id: 'vales_aprob', label: 'Aprobar Solicitudes' },
            { id: 'vales_list', label: 'Historial de Vales' },
        ],
    },
    {
        label: 'Nomina y Pagos',
        icon: 'ph-coins',
        type: 'group',
        children: [
            { id: 'salario_ind', label: 'Historial de Pagos' },
            { id: 'salario_auditoria', label: 'Auditoria de Pagos' },
            { id: 'salario_pend', label: 'Liquidar Pendientes' },
            { id: 'salario_individual', label: 'Pago Individual' },
        ],
    },
    {
        label: 'Comisiones',
        icon: 'ph-trend-up',
        type: 'group',
        children: [
            { id: 'com_reg', label: 'Registrar (+)' },
            { id: 'com_res', label: 'Reporte Mensual' },
        ],
    },
    {
        label: 'Administrativo',
        icon: 'ph-briefcase',
        type: 'group',
        children: [
            { id: 'admin_desc', label: 'Descuentos (-)' },
            { id: 'admin_suc', label: 'Sucursales / Horarios' },
            { id: 'admin_prov_new', label: 'Nuevo Proveedor' },
            { id: 'admin_prov_list', label: 'Lista Proveedores' },
            { id: 'admin_ausencia_new', label: 'Reportar Ausencia' },
            { id: 'admin_ausencia_list', label: 'Historial Ausencias' },
            { id: 'admin_desempeno_new', label: 'Nueva Evaluacion' },
            { id: 'admin_desempeno_list', label: 'Historial Desempeno' },
        ],
    },
    {
        label: 'Gestion Sistema',
        icon: 'ph-gear-six',
        type: 'group',
        children: [
            { id: 'admin_users', label: 'Gestion de Usuarios' },
            { id: 'admin_aprobacion_pagos', label: 'Aprobacion de Pagos' },
        ],
    },
    { id: 'birthdays', label: 'Cumpleanos', icon: 'ph-cake', type: 'single' },
];

const menuItemsRRHH = [
    { id: 'dashboard', label: 'Resumen Global', icon: 'ph-chart-pie-slice', type: 'single' },
    { id: 'rrhh_new', label: 'Nuevo Funcionario', icon: 'ph-user-plus', type: 'single' },
    { id: 'rrhh_list', label: 'Lista de Personal', icon: 'ph-users-three', type: 'single' },
    { id: 'rrhh_liquidaciones', label: 'Calendario de Liquidaciones', icon: 'ph-calendar-check', type: 'single' },
    { id: 'admin_desc', label: 'Descuentos (-)', icon: 'ph-minus-circle', type: 'single' },
    { id: 'admin_suc', label: 'Sucursales / Horarios', icon: 'ph-storefront', type: 'single' },
    { id: 'admin_ausencia_new', label: 'Reportar Ausencia', icon: 'ph-user-minus', type: 'single' },
    { id: 'admin_ausencia_list', label: 'Historial Ausencias', icon: 'ph-clipboard-text', type: 'single' },
    {
        label: 'Nomina y Pagos',
        icon: 'ph-coins',
        type: 'group',
        children: [
            { id: 'salario_pend', label: 'Liquidar Pendientes' },
            { id: 'salario_individual', label: 'Pago Individual' },
            { id: 'salario_ind', label: 'Historial de Pagos' },
        ],
    },
];

// Menu lateral (visible en movil).
window.toggleSidebar = (forceOpen) => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar) return;

    const isOpen = !sidebar.classList.contains('-translate-x-full');
    const open = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;

    sidebar.classList.toggle('-translate-x-full', !open);
    sidebar.classList.toggle('translate-x-0', open);
    if (overlay) overlay.classList.toggle('hidden', !open);
};

// Acerca de / creditos del sistema.
window.openAboutModal = () => {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.classList.remove('hidden');
};

window.closeAboutModal = (event) => {
    if (event && event.target && event.target.id !== 'aboutModal') return;
    const modal = document.getElementById('aboutModal');
    if (modal) modal.classList.add('hidden');
};

function renderMenu() {
    const nav = document.getElementById('sidebarMenu');
    if (!nav) return;
    nav.innerHTML = '';

    const items = currentUserRole === 'RRHH' ? menuItemsRRHH : menuItemsAdmin;

    items.forEach((item) => {
        if (item.type === 'group') {
            nav.innerHTML += `
                <div class="px-6 py-3 mt-4 text-[10px] font-black text-slate-500 uppercase tracking-[2px] flex items-center gap-2 border-t border-slate-800/30 pt-4">
                    <i class="ph ${item.icon} text-sm text-blue-500"></i> ${item.label}
                </div>`;
            item.children.forEach((c) => {
                const active = currentView === c.id ? CONFIG_UI.sidebarActive : CONFIG_UI.sidebarInactive;
                nav.innerHTML += `
                    <div onclick="navigateTo('${c.id}', '${c.label}')" class="cursor-pointer ml-4 mr-4 px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 mb-1 ${active}">
                        ${c.label}
                    </div>`;
            });
        } else {
            const active =
                currentView === item.id
                    ? CONFIG_UI.sidebarActive.replace('translate-x-2', '')
                    : CONFIG_UI.sidebarInactive;
            nav.innerHTML += `
                <div onclick="navigateTo('${item.id}', '${item.label}')" class="mx-4 cursor-pointer px-4 py-3.5 rounded-xl text-sm font-bold flex items-center gap-3 transition-all duration-300 mb-2 ${active}">
                    <i class="ph ${item.icon} text-xl"></i> <span>${item.label}</span>
                </div>`;
        }
    });
    window.navigateTo = navigateTo;
}

function navigateTo(id, label) {
    if (currentUserRole === 'RRHH' && !RRHH_ALLOWED_VIEWS.includes(id)) {
        id = 'dashboard';
        label = 'Resumen Global';
    }
    currentView = id;
    const title = document.getElementById('pageTitle');
    if (title) title.innerText = label;
    renderMenu();
    renderContent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.innerWidth < 1024 && typeof window.toggleSidebar === 'function') window.toggleSidebar(false);
}

function renderContent() {
    const main = document.getElementById('mainContent');
    if (!main) return;
    main.innerHTML = '';

    switch (currentView) {
        case 'dashboard':
            main.innerHTML = viewDashboard();
            break;
        case 'rrhh_new':
            main.innerHTML = viewNewEmployee();
            setupEmployeeForm();
            break;
        case 'rrhh_list':
            main.innerHTML = viewEmployeeList();
            break;
        case 'rrhh_liquidaciones':
            main.innerHTML = viewRRHHLiquidationsCalendar();
            break;
        case 'vales_new':
            main.innerHTML = ValesModule.getViewCreateVale(employeesData, valesData);
            ValesModule.setupCreateValeLogic(showToast);
            break;
        case 'vales_list':
            main.innerHTML = ValesModule.getViewListVales(valesData, employeesData);
            break;
        case 'vales_aprob':
            main.innerHTML = ValesModule.getViewApproveVales(valesData, employeesData);
            break;
        case 'com_reg':
            main.innerHTML = ComisionesModule.getViewCreateComision(employeesData);
            ComisionesModule.setupCreateComisionLogic(showToast);
            break;
        case 'com_res':
            main.innerHTML = ComisionesModule.getViewListComisiones(comisionesData);
            break;
        case 'salario_pend':
            main.innerHTML = SalariosModule.getViewPendingSalaries();
            SalariosModule.setupPendingSalariesLogic(
                showToast,
                employeesData,
                valesData,
                comisionesData,
                descuentosData,
                salariesData
            );
            break;
        case 'salario_ind':
            main.innerHTML = SalariosModule.getViewHistorySalaries(salariesData, employeesData);
            SalariosModule.setupHistorySalaries();
            break;
        case 'salario_auditoria':
            main.innerHTML = SalariosModule.getViewPaymentAudit(salariesData, employeesData);
            SalariosModule.setupPaymentAuditLogic();
            break;
        case 'salario_individual':
            main.innerHTML = SalariosModule.getViewIndividualPayment(employeesData);
            SalariosModule.setupIndividualPaymentLogic(
                showToast,
                employeesData,
                valesData,
                comisionesData,
                descuentosData,
                salariesData
            );
            break;
        case 'admin_desc':
            main.innerHTML = viewAdminDescuentos();
            break;
        case 'admin_suc':
            main.innerHTML = viewAdminSucursales();
            break;
        case 'admin_prov_new':
            main.innerHTML = ProveedoresModule.getViewCreateProveedor();
            ProveedoresModule.setupCreateProveedorLogic(showToast);
            break;
        case 'admin_prov_list':
            main.innerHTML = ProveedoresModule.getViewListProveedores(proveedoresData);
            break;
        case 'admin_ausencia_new':
            main.innerHTML = AusenciasModule.getViewCreateAusencia(employeesData);
            AusenciasModule.setupCreateAusenciaLogic(showToast);
            break;
        case 'admin_ausencia_list':
            main.innerHTML = AusenciasModule.getViewListAusencias(ausenciasData, employeesData);
            break;
        case 'admin_desempeno_new':
            main.innerHTML = DesempenoModule.getViewCreateDesempeno(employeesData);
            DesempenoModule.setupCreateDesempenoLogic(showToast);
            break;
        case 'admin_desempeno_list':
            main.innerHTML = DesempenoModule.getViewListDesempeno(desempenoData, employeesData);
            break;
        case 'admin_users':
            main.innerHTML = viewAdminUsers();
            break;
        case 'admin_aprobacion_pagos':
            main.innerHTML = viewAdminAprobacionPagos();
            break;
        case 'birthdays':
            main.innerHTML = viewBirthdays();
            break;
        default:
            main.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-slate-400 py-20">
                    <i class="ph ph-cone text-6xl mb-4 opacity-30"></i>
                <p class="font-bold">Modulo ${currentView} no esta disponible en esta version.</p>
                </div>`;
    }
}

function parseDateOnly(value) {
    if (!value || typeof value !== 'string') return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDateDisplay(value) {
    const date = value instanceof Date ? value : parseDateOnly(value);
    if (!date || Number.isNaN(date.getTime())) return 'S/F';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function getEmployeeIntegrityIssues(emp) {
    const issues = [];
    const startDate = parseDateOnly(emp.startDate);
    const endDate = parseDateOnly(emp.endDate);
    const status = emp.status || 'ACTIVO';

    if (!startDate) {
        issues.push({
            label: 'FECHA DE INGRESO INVALIDA',
            detail: 'La fecha de ingreso falta o no se puede interpretar correctamente.',
            tone: 'amber',
        });
    }

    if (status === 'ACTIVO' && endDate) {
        issues.push({
            label: 'ACTIVO CON FECHA DE BAJA',
            detail: 'El funcionario sigue activo, pero la ficha conserva una fecha de baja.',
            tone: 'amber',
        });
    }

    if (status === 'INACTIVO' && !endDate) {
        issues.push({
            label: 'INACTIVO SIN FECHA DE BAJA',
            detail: 'No se puede calcular correctamente su liquidacion final ni el calendario de pago.',
            tone: 'rose',
        });
    }

    if (startDate && endDate && endDate < startDate) {
        issues.push({
            label: 'FECHAS INCONSISTENTES',
            detail: 'La fecha de baja es anterior a la fecha de ingreso.',
            tone: 'rose',
        });
    }

    return issues;
}

function getIntegrityToneClasses(tone) {
    if (tone === 'rose') {
        return {
            badge: 'bg-rose-100 text-rose-700',
            panel: 'bg-rose-50 border-rose-200 text-rose-700',
        };
    }
    return {
        badge: 'bg-amber-100 text-amber-700',
        panel: 'bg-amber-50 border-amber-200 text-amber-700',
    };
}

function addOneMonthPreservingDay(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const targetMonthIndex = month + 1;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const targetMonth = targetMonthIndex % 12;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    return new Date(targetYear, targetMonth, Math.min(day, lastDay));
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDaysUntil(targetDate, baseDate = new Date()) {
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.round((startOfDay(targetDate) - startOfDay(baseDate)) / msPerDay);
}

function getPendingFinalSettlements() {
    return employeesData
        .filter((emp) => emp.status === 'INACTIVO' && emp.endDate)
        .map((emp) => {
            const endDate = parseDateOnly(emp.endDate);
            if (!endDate) return null;

            const dueDate = addOneMonthPreservingDay(endDate);
            const month = endDate.getMonth() + 1;
            const year = endDate.getFullYear();
            const totals = SalariosModule.getSalaryTotalsForPeriod(
                emp,
                year,
                month,
                valesData,
                comisionesData,
                descuentosData,
                salariesData
            );

            if (totals.saldo <= 0) return null;

            const daysUntil = getDaysUntil(dueDate);
            let statusLabel = `Vence en ${daysUntil} dias`;
            let statusClass = 'bg-blue-100 text-blue-700';

            if (daysUntil < 0) {
                statusLabel = `Atrasado ${Math.abs(daysUntil)} dias`;
                statusClass = 'bg-rose-100 text-rose-700';
            } else if (daysUntil === 0) {
                statusLabel = 'Vence hoy';
                statusClass = 'bg-amber-100 text-amber-700';
            } else if (daysUntil <= 7) {
                statusLabel = `Vence en ${daysUntil} dias`;
                statusClass = 'bg-amber-100 text-amber-700';
            }

            return {
                employeeId: emp.id,
                fullName: emp.fullName,
                branch: emp.branch || 'Sin sucursal',
                position: emp.position || 'Sin cargo',
                endDate,
                dueDate,
                month,
                year,
                pendingAmount: totals.saldo,
                statusLabel,
                statusClass,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.dueDate - b.dueDate || a.fullName.localeCompare(b.fullName));
}

function renderFinalSettlementsCalendarSection() {
    const pendingFinalSettlements = getPendingFinalSettlements();
    const totalPendingFinalSettlements = pendingFinalSettlements.reduce((acc, item) => acc + item.pendingAmount, 0);
    const overdueFinalSettlements = pendingFinalSettlements.filter((item) => getDaysUntil(item.dueDate) < 0).length;
    const nextFinalSettlement = pendingFinalSettlements[0] || null;
    const finalSettlementCalendarHtml =
        pendingFinalSettlements.length > 0
            ? pendingFinalSettlements
                  .map(
                      (item) => `
            <div class="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm hover:shadow-md transition-all">
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                            <span class="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${item.statusClass}">${item.statusLabel}</span>
                            <span class="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Periodo ${String(item.month).padStart(2, '0')}/${item.year}</span>
                        </div>
                        <h4 class="text-lg font-black text-slate-800">${item.fullName}</h4>
                        <p class="text-xs text-slate-500 font-bold uppercase tracking-wider">${item.position} | ${item.branch}</p>
                        <div class="flex flex-wrap gap-2 mt-3">
                            <span class="text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-1 rounded-full">Baja: ${formatDateDisplay(item.endDate)}</span>
                            <span class="text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-1 rounded-full">Pago segun contrato: ${formatDateDisplay(item.dueDate)}</span>
                        </div>
                    </div>
                    <div class="lg:text-right">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Pendiente a Pagar</p>
                        <p class="text-2xl font-black text-slate-800">Gs. ${item.pendingAmount.toLocaleString()}</p>
                        <button onclick="navigateTo('salario_pend', 'Pagos Pendientes')" class="mt-3 bg-slate-900 text-white text-xs font-black px-4 py-2 rounded-2xl hover:bg-blue-600 transition-colors">Abrir Liquidaciones</button>
                    </div>
                </div>
            </div>
        `
                  )
                  .join('')
            : `
            <div class="bg-white border border-dashed border-slate-200 rounded-[28px] p-10 text-center text-slate-400">
                <i class="ph ph-calendar-check text-4xl mb-3"></i>
                <p class="font-black text-slate-600">No hay liquidaciones finales pendientes.</p>
                <p class="text-sm mt-1">Cuando exista una baja con saldo por pagar, aparecera aqui ordenada por vencimiento.</p>
            </div>
        `;

    return `
        <div class="mt-8 space-y-6 fade-in">
            <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <h3 class="text-2xl font-black text-slate-800">Calendario de Liquidaciones Finales</h3>
                    <p class="text-sm text-slate-500 font-medium mt-1">Se agenda desde la fecha de baja y se toma como vencimiento el mismo dia del mes siguiente. Ejemplo aplicado: 19/03/2026 -> 19/04/2026.</p>
                </div>
                <button onclick="navigateTo('salario_pend', 'Pagos Pendientes')" class="bg-blue-600 text-white px-5 py-3 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition-colors">Revisar Liquidaciones</button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Pendientes por Baja</p>
                    <p class="text-3xl font-black text-slate-800 mt-2">${pendingFinalSettlements.length}</p>
                    <p class="text-xs text-slate-500 font-bold mt-1">Funcionarios con liquidacion pendiente</p>
                </div>
                <div class="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Pendiente</p>
                    <p class="text-3xl font-black text-slate-800 mt-2">Gs. ${totalPendingFinalSettlements.toLocaleString()}</p>
                    <p class="text-xs text-slate-500 font-bold mt-1">Saldo final aun no abonado</p>
                </div>
                <div class="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Proximo Vencimiento</p>
                    <p class="text-xl font-black text-slate-800 mt-2">${nextFinalSettlement ? nextFinalSettlement.fullName : 'Sin pendientes'}</p>
                    <p class="text-xs text-slate-500 font-bold mt-1">${nextFinalSettlement ? `${formatDateDisplay(nextFinalSettlement.dueDate)} | Gs. ${nextFinalSettlement.pendingAmount.toLocaleString()}` : `Atrasados: ${overdueFinalSettlements}`}</p>
                </div>
            </div>

            <div class="space-y-4">
                ${finalSettlementCalendarHtml}
            </div>
        </div>`;
}

function viewRRHHLiquidationsCalendar() {
    return `
        <div class="max-w-7xl mx-auto pb-20">
            ${renderFinalSettlementsCalendarSection()}
        </div>`;
}

// Dashboard: helpers de graficos

function resolveRecordDate(record) {
    if (!record) return null;
    if (record.createdAt?.toDate) return record.createdAt.toDate();
    if (record.createdAt instanceof Date) return record.createdAt;
    if (record.createdAtLocal) {
        const parsed = new Date(record.createdAtLocal);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
        const [y, m, d] = record.date.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    return null;
}

function getRecordMonth(record) {
    const month = Number(record?.month);
    const year = Number(record?.year);
    if (month >= 1 && month <= 12 && year > 2000) return { year, month };
    const date = resolveRecordDate(record);
    return date ? { year: date.getFullYear(), month: date.getMonth() + 1 } : null;
}

function getMonthBuckets(count = 6) {
    const now = new Date();
    const buckets = [];
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            label: d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''),
        });
    }
    return buckets;
}

function getMonthlyTotals(buckets) {
    const totals = new Map(buckets.map((b) => [`${b.year}-${b.month}`, 0]));
    salariesData.forEach((sal) => {
        if (sal.deleted) return;
        const key = getRecordMonth(sal);
        if (!key) return;
        const k = `${key.year}-${key.month}`;
        if (totals.has(k)) totals.set(k, totals.get(k) + (Number(sal.netPay) || 0));
    });
    return buckets.map((b) => ({ ...b, total: totals.get(`${b.year}-${b.month}`) || 0 }));
}

function getActiveByBranch() {
    const counts = {};
    employeesData
        .filter((e) => e.status !== 'INACTIVO')
        .forEach((e) => {
            const branch = e.branch || 'Sin sucursal';
            counts[branch] = (counts[branch] || 0) + 1;
        });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function renderMonthlyBars(series) {
    const max = Math.max(...series.map((s) => s.total), 1);
    return series
        .map((s) => {
            const pct = Math.max(2, Math.round((s.total / max) * 100));
            return `
            <div class="flex-1 flex flex-col items-center justify-end gap-2 h-full group">
                <span class="text-[9px] font-black text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">${Math.round(s.total / 1000).toLocaleString()}k</span>
                <div class="w-full max-w-[44px] bg-gradient-to-t from-indigo-500 to-indigo-400 rounded-t-xl group-hover:from-indigo-600 group-hover:to-indigo-500 transition-all" style="height:${pct}%"></div>
                <span class="text-[10px] font-black text-slate-400 uppercase">${s.label}</span>
            </div>`;
        })
        .join('');
}

function renderBranchBars(entries) {
    if (!entries.length) return '<p class="text-xs font-bold text-slate-400">Sin datos de sucursales.</p>';
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return entries
        .map(
            ([name, count]) => `
        <div class="mb-3 last:mb-0">
            <div class="flex items-center justify-between mb-1 gap-2">
                <span class="text-[11px] font-black text-slate-600 truncate" title="${name}">${name}</span>
                <span class="text-[11px] font-black text-slate-800">${count}</span>
            </div>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all" style="width:${Math.round((count / max) * 100)}%"></div>
            </div>
        </div>`
        )
        .join('');
}

function viewDashboard() {
    const activeEmployeesCount = employeesData.filter((e) => e.status !== 'INACTIVO').length;
    const totalValesPend = valesData
        .filter((v) => v.status === 'Pendiente')
        .reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalComsMes = comisionesData
        .filter((c) => c.status === 'Aprobado')
        .reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const totalPagado = salariesData.reduce((acc, curr) => acc + (curr.netPay || 0), 0);

    // --- Graficos y metricas ---
    const monthlySeries = getMonthlyTotals(getMonthBuckets(6));
    const monthlyBars = renderMonthlyBars(monthlySeries);
    const promedioMes = Math.round(monthlySeries.reduce((acc, s) => acc + s.total, 0) / (monthlySeries.length || 1));
    const branchBars = renderBranchBars(getActiveByBranch());

    const nowRef = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    const isCurrentMonth = (record) => {
        const key = getRecordMonth(record);
        return Boolean(key && key.year === nowRef.year && key.month === nowRef.month);
    };

    const valesPorAprobar = valesData.filter((v) => v.status === 'Pendiente').length;
    const descuentosMes = descuentosData
        .filter((d) => !d.deleted && isCurrentMonth(d))
        .reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const ausenciasMes = ausenciasData.filter((a) => isCurrentMonth(a)).length;
    const cumpleanosMes = employeesData.filter((e) => {
        if (e.status === 'INACTIVO' || !e.dob) return false;
        return Number(String(e.dob).split('-')[1]) === nowRef.month;
    }).length;

    const miniCards = [
        {
            label: 'Vales por aprobar',
            value: String(valesPorAprobar),
            icon: 'ph-ticket',
            tint: 'text-amber-600 bg-amber-50',
        },
        {
            label: 'Descuentos del mes',
            value: 'Gs. ' + descuentosMes.toLocaleString(),
            icon: 'ph-minus-circle',
            tint: 'text-rose-600 bg-rose-50',
        },
        {
            label: 'Ausencias del mes',
            value: String(ausenciasMes),
            icon: 'ph-user-minus',
            tint: 'text-orange-600 bg-orange-50',
        },
        {
            label: 'Cumpleanos del mes',
            value: String(cumpleanosMes),
            icon: 'ph-cake',
            tint: 'text-pink-600 bg-pink-50',
        },
    ];
    const miniMetrics = miniCards
        .map(
            (c) => `
        <div class="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${c.tint}"><i class="ph-fill ${c.icon} text-lg"></i></div>
            <div class="min-w-0">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">${c.label}</p>
                <p class="font-black text-slate-800 text-lg leading-tight truncate">${c.value}</p>
            </div>
        </div>`
        )
        .join('');

    return `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 fade-in mb-8">
            <div class="bg-white p-6 rounded-[30px] shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-lg transition-all">
                <div class="absolute -right-4 -bottom-4 bg-blue-50 w-24 h-24 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                <div class="relative z-10">
                    <div class="flex justify-between items-start mb-4">
                        <div class="p-3 bg-blue-100 text-blue-600 rounded-2xl"><i class="ph-fill ph-users text-xl"></i></div>
                        <span class="text-xs font-black text-slate-300 uppercase tracking-wider">RRHH</span>
                    </div>
                    <h3 id="dash-total-emp" class="text-3xl font-black text-slate-800">${activeEmployeesCount}</h3>
                    <p class="text-slate-400 text-xs font-bold mt-1">Colaboradores Activos</p>
                </div>
            </div>

            <div class="bg-white p-6 rounded-[30px] shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-lg transition-all">
                <div class="absolute -right-4 -bottom-4 bg-amber-50 w-24 h-24 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                <div class="relative z-10">
                    <div class="flex justify-between items-start mb-4">
                        <div class="p-3 bg-amber-100 text-amber-600 rounded-2xl"><i class="ph-fill ph-ticket text-xl"></i></div>
                        <span class="text-xs font-black text-slate-300 uppercase tracking-wider">VALES</span>
                    </div>
                    <h3 class="text-3xl font-black text-slate-800">Gs. ${totalValesPend.toLocaleString()}</h3>
                    <p class="text-slate-400 text-xs font-bold mt-1">Pendiente de Aprobacion</p>
                </div>
            </div>

            <div class="bg-white p-6 rounded-[30px] shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-lg transition-all">
                <div class="absolute -right-4 -bottom-4 bg-emerald-50 w-24 h-24 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                <div class="relative z-10">
                    <div class="flex justify-between items-start mb-4">
                        <div class="p-3 bg-emerald-100 text-emerald-600 rounded-2xl"><i class="ph-fill ph-trend-up text-xl"></i></div>
                        <span class="text-xs font-black text-slate-300 uppercase tracking-wider">COMISIONES</span>
                    </div>
                    <h3 class="text-3xl font-black text-slate-800">Gs. ${totalComsMes.toLocaleString()}</h3>
                    <p class="text-slate-400 text-xs font-bold mt-1">Aprobadas del Mes</p>
                </div>
            </div>

            <div class="bg-white p-6 rounded-[30px] shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-lg transition-all">
                <div class="absolute -right-4 -bottom-4 bg-indigo-50 w-24 h-24 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                <div class="relative z-10">
                    <div class="flex justify-between items-start mb-4">
                        <div class="p-3 bg-indigo-100 text-indigo-600 rounded-2xl"><i class="ph-fill ph-wallet text-xl"></i></div>
                        <span class="text-xs font-black text-slate-300 uppercase tracking-wider">SALARIOS</span>
                    </div>
                    <h3 class="text-3xl font-black text-slate-800">Gs. ${totalPagado.toLocaleString()}</h3>
                    <p class="text-slate-400 text-xs font-bold mt-1">Total Egresado Historico</p>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 fade-in">
            ${miniMetrics}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 fade-in">
            <div class="lg:col-span-2 bg-white p-6 rounded-[30px] shadow-sm border border-slate-100">
                <div class="flex items-start justify-between mb-6 gap-4">
                    <div>
                        <h3 class="font-black text-slate-800 text-lg">Egresos por mes</h3>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Salarios liquidados · ultimos 6 meses</p>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-[9px] font-black text-slate-400 uppercase">Promedio</p>
                        <p class="font-black text-indigo-600 text-sm">Gs. ${promedioMes.toLocaleString()}</p>
                    </div>
                </div>
                <div class="flex items-end justify-between gap-2 sm:gap-3 h-44">${monthlyBars}</div>
            </div>

            <div class="bg-white p-6 rounded-[30px] shadow-sm border border-slate-100">
                <h3 class="font-black text-slate-800 text-lg">Personal por sucursal</h3>
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 mb-5">Colaboradores activos</p>
                ${branchBars}
            </div>
        </div>

        <div class="bg-slate-900 rounded-[40px] p-10 shadow-2xl relative overflow-hidden text-white">
            <div class="absolute top-0 right-0 p-10 opacity-10"><i class="ph-duotone ph-rocket-launch text-9xl"></i></div>
            <h3 class="font-black text-3xl mb-8 relative z-10">Centro de Operaciones</h3>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative z-10">
                <button onclick="navigateTo('rrhh_new', 'Nuevo Funcionario')" class="bg-white/10 backdrop-blur-md border border-white/10 p-6 rounded-3xl hover:bg-blue-600 hover:border-blue-500 transition-all group text-left">
                    <i class="ph-fill ph-user-plus text-3xl mb-3 text-blue-400 group-hover:text-white"></i>
                    <h4 class="font-bold">Alta de Personal</h4>
                    <p class="text-xs text-slate-400 group-hover:text-blue-200 mt-1">Registrar nuevo legajo</p>
                </button>

                <button onclick="navigateTo('vales_new', 'Crear Vale')" class="bg-white/10 backdrop-blur-md border border-white/10 p-6 rounded-3xl hover:bg-amber-500 hover:border-amber-400 transition-all group text-left">
                    <i class="ph-fill ph-ticket text-3xl mb-3 text-amber-400 group-hover:text-white"></i>
                    <h4 class="font-bold">Emitir Vale</h4>
                    <p class="text-xs text-slate-400 group-hover:text-amber-100 mt-1">Anticipo de haberes</p>
                </button>

                <button onclick="navigateTo('salario_pend', 'Pagos Pendientes')" class="bg-white/10 backdrop-blur-md border border-white/10 p-6 rounded-3xl hover:bg-emerald-600 hover:border-emerald-500 transition-all group text-left">
                    <i class="ph-fill ph-money text-3xl mb-3 text-emerald-400 group-hover:text-white"></i>
                    <h4 class="font-bold">Liquidar Sueldos</h4>
                    <p class="text-xs text-slate-400 group-hover:text-emerald-100 mt-1">Planilla mensual</p>
                </button>

                <button onclick="navigateTo('salario_individual', 'Pago Individual')" class="bg-white/10 backdrop-blur-md border border-white/10 p-6 rounded-3xl hover:bg-indigo-600 hover:border-indigo-500 transition-all group text-left">
                    <i class="ph-fill ph-hand-coins text-3xl mb-3 text-indigo-400 group-hover:text-white"></i>
                    <h4 class="font-bold">Pago Individual</h4>
                    <p class="text-xs text-slate-400 group-hover:text-indigo-200 mt-1">Saldar deudas especificas</p>
                </button>
            </div>
        </div>`;
}
function updateDashboardCards() {
    const wSal = document.getElementById('dash-total-pend');
    if (wSal) wSal.innerText = salariesData.filter((s) => s.status === 'Pendiente').length;
    const wEmp = document.getElementById('dash-total-emp');
    if (wEmp) wEmp.innerText = employeesData.filter((e) => e.status !== 'INACTIVO').length;
}

/**
 * FORMULARIO ALTA DE PERSONAL
 */
function viewNewEmployee() {
    // Si hay datos en la DB de sucursales, usamos eso. Si no, usamos el fallback estatico.
    const sourceList = sucursalesData.length > 0 ? sucursalesData.map((s) => s.name) : LISTA_SUCURSALES;
    const optionsHtml = sourceList.map((s) => `<option value="${s}">${s}</option>`).join('');

    return `
        <div class="max-w-5xl mx-auto bg-white rounded-[40px] shadow-xl p-10 fade-in border border-slate-100">
            <div class="flex justify-between items-start mb-10 pb-6 border-b border-slate-50">
                <div>
                    <h3 id="formTitle" class="text-3xl font-black text-slate-800 tracking-tight">Ficha del Colaborador</h3>
                    <p class="text-slate-400 font-medium text-sm mt-1">Complete los datos legales del funcionario.</p>
                </div>
                <button onclick="navigateTo('rrhh_new', 'Nuevo Funcionario')" class="text-slate-400 hover:text-blue-600 text-xs font-black flex items-center gap-2 transition-colors">
                    <i class="ph-bold ph-arrow-counter-clockwise"></i> REINICIAR
                </button>
            </div>

            <form id="empForm" class="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
                <input type="hidden" name="employeeId" id="employeeId">

                <div class="md:col-span-2 bg-slate-50 p-6 rounded-[30px] border border-dashed border-slate-200 flex items-center gap-6 group hover:border-blue-300 transition-colors">
                    <div class="w-24 h-24 bg-white rounded-3xl overflow-hidden shadow-sm flex items-center justify-center relative border-2 border-white group-hover:scale-105 transition-transform">
                        <img id="preview" class="w-full h-full object-cover hidden">
                        <i id="iconPreview" class="ph-duotone ph-camera-plus text-3xl text-slate-300"></i>
                        <input type="file" id="photo" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer">
                    </div>
                    <div>
                        <h5 class="font-black text-slate-700">Fotografia de Perfil</h5>
                        <p class="text-xs text-slate-400 mt-1">Click en el recuadro para subir imagen (JPEG/PNG).</p>
                    </div>
                </div>

                <div class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-800 rounded-[30px] shadow-lg">
                    <div class="space-y-2">
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Estado del Funcionario</label>
                        <div class="relative">
                            <select name="status" onchange="toggleEndDateVisibility(this)" class="w-full bg-slate-700 border border-slate-600 p-4 rounded-2xl focus:bg-slate-600 focus:border-blue-500 outline-none transition-all font-black text-white appearance-none cursor-pointer">
                                <option value="ACTIVO" class="font-bold">ACTIVO EN NOMINA</option>
                                <option value="INACTIVO" class="font-bold text-rose-500">DADO DE BAJA (INACTIVO)</option>
                            </select>
                            <i class="ph-bold ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
                        </div>
                    </div>

                    <div id="endDateContainer" class="space-y-2 hidden animate-fade-in">
                        <label class="text-[10px] font-black text-rose-400 uppercase tracking-widest px-2">Fecha de Baja / Salida</label>
                        <input type="date" name="endDate" class="w-full bg-rose-500/10 border border-rose-500/30 p-4 rounded-2xl focus:bg-slate-700 focus:border-rose-500 outline-none transition-all font-bold text-rose-300">
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Nombre Completo</label>
                    <input type="text" name="fullName" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-slate-700">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-blue-500 uppercase tracking-widest px-2">Nro. de Cedula (DNI)</label>
                    <input type="text" name="dni" required class="w-full bg-blue-50/50 border border-blue-100 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-black text-blue-900">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Fecha de Nacimiento</label>
                        <input type="date" name="dob" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all text-xs font-bold text-slate-600">
                    </div>
                    <div class="space-y-2">
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Fecha de Ingreso</label>
                        <input type="date" name="startDate" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all text-xs font-bold text-slate-600">
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Contacto Directo</label>
                    <input type="tel" name="phone" required placeholder="+595" class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-slate-700">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Direccion de Domicilio</label>
                    <input type="text" name="address" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-slate-700">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-emerald-600 uppercase tracking-widest px-2">Asignacion Salarial Base</label>
                    <input type="number" name="salary" required class="w-full bg-emerald-50/50 border border-emerald-100 p-4 rounded-2xl focus:bg-white focus:border-emerald-500 outline-none transition-all font-black text-emerald-700 text-lg">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Sucursal / Empresa</label>
                    <div class="relative">
                        <select name="branch" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-slate-600 appearance-none">
                            <option value="">-- Seleccione Destino --</option>
                            ${optionsHtml}
                        </select>
                        <i class="ph-bold ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
                    </div>
                </div>

                <div class="md:col-span-2 space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Cargo / Titulo Profesional</label>
                    <input type="text" name="position" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-slate-700">
                </div>

                <div class="md:col-span-2 flex justify-end pt-8 border-t border-slate-50 mt-4">
                    <button type="submit" id="btnSave" class="bg-blue-600 text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-blue-200 hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all flex items-center gap-3">
                        <i class="ph-bold ph-floppy-disk text-xl"></i> PROCESAR FICHA
                    </button>
                </div>
            </form>
        </div>`;
}

function setupEmployeeForm() {
    const form = document.getElementById('empForm');
    const photoInput = document.getElementById('photo');
    const preview = document.getElementById('preview');
    let photoBase64 = '';
    const restoreButton = (btn, html) => {
        btn.disabled = false;
        btn.innerHTML = html;
    };

    const compress = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => {
                const img = new Image();
                img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const width = CONFIG_UI.maxPhotoSize;
                    const scale = width / img.width;
                    canvas.width = width;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.65));
                };
            };
        });
    };

    photoInput.addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            photoBase64 = await compress(e.target.files[0]);
            preview.src = photoBase64;
            preview.classList.remove('hidden');
            document.getElementById('iconPreview').classList.add('hidden');
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSave');
        const oldHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> SINCRONIZANDO...';

        const data = new FormData(form);
        const empId = data.get('employeeId');
        const currentStatus = data.get('status') || 'ACTIVO';
        const startDateValue = data.get('startDate');
        const endDateValue = currentStatus === 'INACTIVO' ? data.get('endDate') : null;
        const startDate = parseDateOnly(startDateValue);
        const endDate = parseDateOnly(endDateValue);

        if (!startDate) {
            showToast('Error', 'La fecha de ingreso es obligatoria y debe ser valida.');
            restoreButton(btn, oldHTML);
            return;
        }

        if (currentStatus === 'INACTIVO' && !endDateValue) {
            showToast('Error', 'Si el funcionario esta inactivo, debe completar la fecha de baja.');
            restoreButton(btn, oldHTML);
            return;
        }

        if (currentStatus === 'INACTIVO' && !endDate) {
            showToast('Error', 'La fecha de baja no tiene un formato valido.');
            restoreButton(btn, oldHTML);
            return;
        }

        if (endDate && endDate < startDate) {
            showToast('Error', 'La fecha de baja no puede ser anterior a la fecha de ingreso.');
            restoreButton(btn, oldHTML);
            return;
        }

        const obj = {
            fullName: data.get('fullName').toUpperCase(),
            dni: data.get('dni'),
            dob: data.get('dob'),
            startDate: startDateValue,
            phone: data.get('phone'),
            address: data.get('address'),
            position: data.get('position').toUpperCase(),
            salary: Number(data.get('salary')),
            branch: data.get('branch'),
            photo: photoBase64 || preview.src || '',
            status: currentStatus,
            endDate: endDateValue || null,
            updatedAt: serverTimestamp(),
        };

        try {
            if (empId) {
                await updateDoc(doc(db, 'employees', empId), obj);
                showToast('Exito', 'Funcionario actualizado.');
            } else {
                obj.createdAt = serverTimestamp();
                await addDoc(collection(db, 'employees'), obj);
                showToast('Exito', 'Nuevo funcionario registrado.');
            }
            navigateTo('rrhh_list', 'Lista de Personal');
        } catch (err) {
            console.error(err);
            showToast('Error', 'Error al conectar con la base de datos.');
            restoreButton(btn, oldHTML);
        }
    });
}

function viewEmployeeList() {
    unlockRRHHModalScroll();
    if (!employeesData.length) {
        return `<div class="flex flex-col items-center justify-center py-40 opacity-40">
                <i class="ph-duotone ph-users-three text-6xl mb-4"></i>
                <p class="font-black text-xl uppercase">No hay colaboradores registrados</p>
                </div>`;
    }

    const sortedEmp = [...employeesData].sort((a, b) => {
        if (a.status === 'INACTIVO' && b.status !== 'INACTIVO') return 1;
        if (a.status !== 'INACTIVO' && b.status === 'INACTIVO') return -1;
        return a.fullName.localeCompare(b.fullName);
    });
    const auditedEmployees = sortedEmp.map((employee) => ({ employee, issues: getEmployeeIntegrityIssues(employee) }));
    const inconsistentEmployees = auditedEmployees.filter((item) => item.issues.length > 0);

    let html = '<div class="fade-in pb-20 space-y-6">';
    if (inconsistentEmployees.length > 0) {
        html += `
            <div class="bg-amber-50 border border-amber-200 rounded-[28px] p-5 shadow-sm">
                <div class="flex items-start gap-3">
                    <div class="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl flex-shrink-0">
                        <i class="ph-fill ph-warning-circle"></i>
                    </div>
                    <div>
                        <h4 class="font-black text-amber-800 text-lg">Auditoria de fichas RRHH</h4>
                        <p class="text-sm text-amber-700 font-medium">
                            Se detectaron ${inconsistentEmployees.length} fichas con fechas o estado inconsistentes. Estan marcadas abajo para que puedas corroborarlas en Firestore.
                        </p>
                    </div>
                </div>
            </div>`;
    }

    html += `
        <div class="bg-white rounded-[32px] shadow-lg shadow-slate-200/50 border border-slate-100 p-5 flex flex-col md:flex-row md:items-center gap-4">
            <div class="relative flex-1">
                <i class="ph-bold ph-magnifying-glass absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-xl pointer-events-none"></i>
                <input type="text" id="personalSearch" placeholder="Buscar personal por nombre, cedula, cargo o sucursal..." autocomplete="off"
                    oninput="filterPersonalList(this.value)"
                    class="w-full bg-slate-50 border-2 border-slate-100 pl-12 pr-4 py-4 rounded-2xl font-bold text-slate-700 outline-none focus:border-blue-500 transition-all">
            </div>
            <div class="flex items-center gap-3 md:border-l md:border-slate-100 md:pl-6 shrink-0">
                <div class="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl"><i class="ph-fill ph-users-three"></i></div>
                <div>
                    <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Lista de Personal</p>
                    <p id="personalCount" class="font-black text-slate-800 text-lg leading-tight">${auditedEmployees.length} colaboradores</p>
                </div>
                ${Export.exportButton('exportEmployeesCsv()')}
            </div>
        </div>`;

    html += '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">';
    auditedEmployees.forEach(({ employee: e, issues }) => {
        const isInactive = e.status === 'INACTIVO';
        const cardStyle = isInactive
            ? 'bg-slate-50 border-slate-200 grayscale-[50%] opacity-80'
            : 'bg-white border-slate-100 hover:-translate-y-1 hover:shadow-2xl';
        const startDateLabel = formatDateDisplay(e.startDate);
        const inactiveEndDateLabel = isInactive ? formatDateDisplay(e.endDate) : '';
        const currentSalary = SalariosModule.getEffectiveSalaryAmountForDate(e, new Date());
        const salaryHistory = SalariosModule.getSalaryHistoryForEmployee(e.id);
        const issueBadges = issues
            .map((issue) => {
                const tone = getIntegrityToneClasses(issue.tone);
                return `<span class="text-[9px] font-black uppercase px-2 py-1 rounded-lg ${tone.badge}">${issue.label}</span>`;
            })
            .join('');
        const issuePanel = issues.length
            ? `
            <div class="mt-4 p-3 rounded-2xl border ${getIntegrityToneClasses(issues[0].tone).panel}">
                <div class="flex flex-wrap gap-2 mb-2">${issueBadges}</div>
                <div class="space-y-1">
                    ${issues.map((issue) => `<p class="text-[11px] font-bold">${issue.detail}</p>`).join('')}
                </div>
            </div>`
            : '';
        const isRRHH = currentUserRole === 'RRHH';

        html += `
            <div data-personal-card data-search="${[e.fullName, e.dni, e.position, e.branch]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .replace(
                    /["'<>&]/g,
                    ' '
                )}" class="rounded-[32px] shadow-lg shadow-slate-200/50 border overflow-hidden group relative transition-all duration-300 ${cardStyle}">
                <div class="absolute top-4 right-4 flex flex-col gap-2 z-20 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                    ${
                        isRRHH
                            ? !isInactive
                                ? `<button onclick="deactivateEmployee('${e.id}', '${e.fullName}')" class="bg-white/90 backdrop-blur text-rose-600 p-2.5 rounded-xl shadow-lg hover:bg-rose-600 hover:text-white transition-all" title="Dar de baja"><i class="ph-bold ph-user-minus"></i></button>`
                                : ''
                            : `
                    <button onclick="editEmployee('${e.id}')" class="bg-white/90 backdrop-blur text-indigo-600 p-2.5 rounded-xl shadow-lg hover:bg-indigo-600 hover:text-white transition-all"><i class="ph-bold ph-pencil-simple"></i></button>
                    ${!isInactive ? `<button onclick="openSalaryIncreaseModal('${e.id}')" class="bg-white/90 backdrop-blur text-emerald-600 p-2.5 rounded-xl shadow-lg hover:bg-emerald-600 hover:text-white transition-all" title="Aumentar salario"><i class="ph-bold ph-arrow-fat-up"></i></button>` : ''}
                    <button onclick="deleteEmployee('${e.id}', '${e.fullName}')" class="bg-white/90 backdrop-blur text-red-500 p-2.5 rounded-xl shadow-lg hover:bg-red-500 hover:text-white transition-all"><i class="ph-bold ph-trash"></i></button>`
                    }
                </div>

                <div class="h-48 bg-slate-100 relative overflow-hidden">
                    ${e.photo ? `<img src="${e.photo}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110">` : '<div class="h-full flex items-center justify-center bg-slate-50"><i class="ph-duotone ph-user text-6xl text-slate-200"></i></div>'}
                    <div class="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent"></div>
                    <div class="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                        <span class="text-[9px] font-black text-white bg-blue-600/90 backdrop-blur px-2 py-1 rounded-lg uppercase tracking-wider shadow-lg">${e.branch}</span>
                        ${isInactive ? `<span class="text-[9px] font-black text-white bg-rose-600/90 backdrop-blur px-2 py-1 rounded-lg uppercase tracking-wider shadow-lg">BAJA: ${e.endDate ? e.endDate.split('-').reverse().join('/') : 'S/F'}</span>` : ''}
                    </div>
                </div>
                
                <div class="p-6">
                    <h4 class="font-black text-slate-800 text-lg leading-tight mb-1 truncate" title="${e.fullName}">${e.fullName}</h4>
                    <p class="text-blue-500 text-[10px] font-black uppercase tracking-[2px] mb-5 truncate">${e.position}</p>
                    <div class="flex flex-wrap gap-2 text-[10px] font-bold mb-4">
                        <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-full">Ingreso: ${startDateLabel}</span>
                        <span class="${isInactive ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'} px-2 py-1 rounded-full">Estado: ${isInactive ? 'INACTIVO' : 'ACTIVO'}</span>
                        ${isInactive ? `<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded-full">Baja: ${inactiveEndDateLabel}</span>` : ''}
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4">
                        <div>
                            <p class="text-[9px] text-slate-400 font-bold uppercase mb-0.5">Identificacion</p>
                            <p class="font-bold text-slate-600 text-xs">${e.dni || '-'}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-[9px] text-slate-400 font-bold uppercase mb-0.5">Salario Base</p>
                            <p class="font-black text-emerald-600 text-xs">Gs. ${parseInt(currentSalary || 0).toLocaleString()}</p>
                            ${salaryHistory.length ? `<p class="text-[9px] font-bold text-blue-500 mt-1">${salaryHistory.length} aumento(s) registrado(s)</p>` : ''}
                        </div>
                    </div>
                    ${issuePanel}
                </div>
            </div>`;
    });
    return (
        html +
        `</div>
        <div id="personalEmpty" class="hidden flex flex-col items-center justify-center py-24 opacity-60 fade-in">
            <i class="ph-duotone ph-user-minus text-5xl text-slate-300 mb-4"></i>
            <p class="font-black text-slate-500 uppercase tracking-widest">Sin resultados</p>
            <p class="text-xs font-bold text-slate-400 mt-1">Verifique el nombre, cedula, cargo o sucursal buscado.</p>
        </div>


        <div id="salaryIncreaseModal" class="hidden fixed inset-0 bg-black/65 z-50 flex items-center justify-center backdrop-blur-sm p-4" onclick="closeSalaryIncreaseModal()">
            <div class="bg-white w-full max-w-2xl rounded-[34px] shadow-2xl overflow-hidden border border-slate-100" style="max-height: 90vh;" onclick="event.stopPropagation()">
                <div class="sticky top-0 bg-white border-b border-slate-100 px-6 py-5 flex items-center justify-between z-10">
                    <div>
                        <h3 class="text-xl font-black text-slate-800">Aumentar salario</h3>
                        <p class="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Historial salarial sin tocar meses anteriores</p>
                    </div>
                    <button type="button" onclick="closeSalaryIncreaseModal()" class="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center">
                        <i class="ph-bold ph-x"></i>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto" style="max-height: calc(90vh - 84px);">
                    <form id="salaryIncreaseForm" class="space-y-5" onsubmit="saveSalaryIncrease(event)">
                        <input type="hidden" name="employeeId">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Funcionario</label>
                                <input type="text" name="employeeName" readonly class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-black text-slate-700">
                            </div>
                            <div>
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Salario actual</label>
                                <input type="text" name="currentSalary" readonly class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-emerald-50 font-black text-emerald-700">
                            </div>
                            <div>
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Nuevo salario</label>
                                <input type="number" name="newSalary" min="0" step="1" required class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-black text-slate-700">
                            </div>
                            <div>
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Vigente desde</label>
                                <input type="date" name="effectiveFrom" required class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700">
                            </div>
                        </div>
                        <div>
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1 block">Observacion / motivo</label>
                            <textarea name="reason" rows="3" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 resize-none" placeholder="Ej: ajuste por antiguedad, cambio de cargo, actualizacion salarial..."></textarea>
                        </div>
                        <div>
                            <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Historial salarial reciente</h4>
                            <div id="salaryIncreaseHistory"></div>
                        </div>
                        <div class="flex gap-3 pt-2">
                            <button type="button" onclick="closeSalaryIncreaseModal()" class="flex-1 bg-slate-100 text-slate-700 py-4 rounded-2xl font-black">Cancelar</button>
                            <button type="submit" id="btnSaveSalaryIncrease" class="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-emerald-700 transition-colors">Guardar aumento</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>`
    );
}

window.filterPersonalList = (value) => {
    const term = String(value || '')
        .trim()
        .toLowerCase();
    const cards = document.querySelectorAll('[data-personal-card]');
    let visible = 0;

    cards.forEach((card) => {
        const haystack = (card.getAttribute('data-search') || '').toLowerCase();
        const match = !term || haystack.includes(term);
        card.classList.toggle('hidden', !match);
        if (match) visible += 1;
    });

    const empty = document.getElementById('personalEmpty');
    if (empty) empty.classList.toggle('hidden', visible > 0);

    const counter = document.getElementById('personalCount');
    if (counter) {
        counter.innerText = term ? `${visible} de ${cards.length} colaboradores` : `${cards.length} colaboradores`;
    }
};

function viewAdminSucursales() {
    let listHtml = '';
    if (sucursalesData.length === 0) {
        listHtml = `<div class="col-span-full text-center py-10 opacity-40 font-bold">No hay sucursales registradas en la base de datos.<br>Anade una sucursal para poder gestionar los horarios de entrada y salida.</div>`;
    } else {
        sucursalesData.forEach((suc) => {
            listHtml += `
            <div class="bg-white p-6 rounded-[25px] border border-slate-100 shadow-sm flex justify-between items-center group hover:shadow-md transition-all">
                <div>
                    <h4 class="font-black text-slate-800 text-lg">${suc.name}</h4>
                    <div class="flex gap-4 mt-2">
                        <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md"><i class="ph-bold ph-clock"></i> Ent: ${suc.entrada || '--:--'}</span>
                        <span class="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-md"><i class="ph-bold ph-clock"></i> Sal: ${suc.salida || '--:--'}</span>
                    </div>
                </div>
                <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="editSucursal('${suc.id}')" class="w-10 h-10 rounded-xl bg-slate-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors"><i class="ph-bold ph-pencil"></i></button>
                    <button onclick="deleteSucursal('${suc.id}', '${suc.name}')" class="w-10 h-10 rounded-xl bg-slate-50 hover:bg-red-100 text-red-600 flex items-center justify-center transition-colors"><i class="ph-bold ph-trash"></i></button>
                </div>
            </div>`;
        });
    }

    return `
    <div class="max-w-5xl mx-auto space-y-8 fade-in pb-20">
        <div class="bg-slate-900 p-10 rounded-[40px] shadow-2xl text-white relative overflow-hidden">
            <i class="ph-duotone ph-buildings absolute -right-10 -bottom-10 text-[200px] opacity-10"></i>
            <h3 class="text-3xl font-black mb-2 relative z-10">Gestion de Sucursales y Horarios</h3>
            <p class="text-slate-400 text-sm font-medium relative z-10">Defina los horarios operativos para el calculo automatico de llegadas tardias.</p>
            
            <form id="sucursalForm" class="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10" onsubmit="saveSucursal(event)">
                <input type="hidden" id="sucId">
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Nombre de Sucursal</label>
                    <input type="text" id="sucName" required class="w-full bg-slate-800 border-2 border-slate-700 p-4 rounded-2xl font-bold text-white outline-none focus:border-blue-500 transition-all" placeholder="Ej: CAFETERIA CHICOLIN">
                </div>
                <div>
                    <label class="text-[10px] font-black text-emerald-400 uppercase tracking-widest px-2 mb-1 block">Horario de Entrada</label>
                    <input type="time" id="sucEntrada" required class="w-full bg-slate-800 border-2 border-slate-700 p-4 rounded-2xl font-bold text-emerald-400 outline-none focus:border-emerald-500 transition-all">
                </div>
                <div>
                    <label class="text-[10px] font-black text-rose-400 uppercase tracking-widest px-2 mb-1 block">Horario de Salida</label>
                    <input type="time" id="sucSalida" required class="w-full bg-slate-800 border-2 border-slate-700 p-4 rounded-2xl font-bold text-rose-400 outline-none focus:border-rose-500 transition-all">
                </div>
                <div class="md:col-span-3 flex justify-end mt-2">
                    <button type="submit" id="btnSaveSuc" class="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black shadow-lg hover:bg-blue-500 transition-all flex items-center gap-2">
                        <i class="ph-bold ph-floppy-disk text-lg"></i> GUARDAR SUCURSAL
                    </button>
                </div>
            </form>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            ${listHtml}
        </div>
    </div>`;
}

window.saveSucursal = async (e) => {
    e.preventDefault();
    const id = document.getElementById('sucId').value;
    const name = document.getElementById('sucName').value.toUpperCase();
    const entrada = document.getElementById('sucEntrada').value;
    const salida = document.getElementById('sucSalida').value;

    const btn = document.getElementById('btnSaveSuc');
    const oldTxt = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'GUARDANDO...';

    try {
        if (id) {
            await updateDoc(doc(db, 'sucursales', id), { name, entrada, salida });
            showToast('Actualizado', 'Sucursal modificada con exito.');
        } else {
            await addDoc(collection(db, 'sucursales'), { name, entrada, salida, createdAt: serverTimestamp() });
            showToast('Guardado', 'Nueva sucursal registrada.');
        }
        document.getElementById('sucursalForm').reset();
        document.getElementById('sucId').value = '';
        btn.innerHTML = '<i class="ph-bold ph-floppy-disk text-lg"></i> GUARDAR SUCURSAL';
    } catch (err) {
        showToast('Error', 'No se pudo guardar la sucursal.');
    } finally {
        btn.disabled = false;
    }
};

window.editSucursal = (id) => {
    const suc = sucursalesData.find((s) => s.id === id);
    if (suc) {
        document.getElementById('sucId').value = suc.id;
        document.getElementById('sucName').value = suc.name;
        document.getElementById('sucEntrada').value = suc.entrada || '';
        document.getElementById('sucSalida').value = suc.salida || '';
        document.getElementById('btnSaveSuc').innerHTML =
            '<i class="ph-bold ph-pencil text-lg"></i> ACTUALIZAR SUCURSAL';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.deleteSucursal = async (id, name) => {
    const confirmado = await uiConfirm({
        title: 'Eliminar sucursal',
        message: `Seguro que desea eliminar la sucursal ${name}?`,
        tone: 'danger',
        confirmText: 'Eliminar',
    });
    if (confirmado) {
        await deleteDoc(doc(db, 'sucursales', id));
        showToast('Eliminado', 'Sucursal borrada del sistema.');
    }
};

// ==========================================
// VISTA: GESTION DE DESCUENTOS ADMINISTRATIVOS
// ==========================================

function viewAdminDescuentos() {
    const grouped = {};
    descuentosData.forEach((d) => {
        if (!grouped[d.employeeId]) grouped[d.employeeId] = [];
        grouped[d.employeeId].push(d);
    });

    let html = `
    <div class="max-w-6xl mx-auto space-y-8 fade-in pb-20">
        <div class="bg-white p-10 rounded-[40px] shadow-2xl border border-red-50">
            <h3 class="text-2xl font-black text-slate-800 mb-6 flex items-center gap-3">
                <div class="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center text-xl"><i class="ph-fill ph-warning-circle"></i></div>
                Registrar Deduccion Extraordinaria
            </h3>
            
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div class="relative">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Funcionario</label>
                    <input type="text" id="adminDescSearch" placeholder="Buscar..." class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold focus:bg-white focus:border-red-400 outline-none" oninput="filterAdminEmployees(this.value)">
                    <div id="adminEmpList" class="hidden absolute w-full bg-white border border-slate-200 rounded-xl shadow-xl mt-1 max-h-40 overflow-y-auto z-50"></div>
                    <input type="hidden" id="adminDescEmpId">
                </div>
        
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Monto a Descontar (Gs)</label>
                    <input type="text" id="adminDescAmount" placeholder="0" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-black text-red-600 text-lg focus:bg-white focus:border-red-400 outline-none" oninput="formatCurrencyInput(this)">
                </div>

                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 block">Tipo de Falta / Motivo</label>
                    <select id="adminDescReason" class="w-full border-2 border-slate-100 p-4 rounded-2xl bg-slate-50 font-bold text-slate-600 focus:bg-white focus:border-red-400 outline-none">
                        <option value="">Seleccione...</option>
                        <option value="FALTANTE DE CAJA">FALTANTE DE CAJA</option>
                        <option value="FALTANTE DE STOCK">FALTANTE DE STOCK</option>
                        <option value="CONSUMISION">CONSUMISION PERSONAL</option>
                        <option value="SANCION">SANCION / MULTA DISCIPLINARIA</option>
                        <option value="DANOS">DANO DE PROPIEDAD</option>
                        <option value="OTROS">OTROS CONCEPTOS</option>
                    </select>
                </div>

                <div>
                    <label class="text-[10px] font-black text-blue-600 uppercase tracking-widest px-2 mb-1 block">Fecha de Imputacion</label>
                    <input type="date" id="adminDescDate" class="w-full border-2 border-blue-100 p-4 rounded-2xl bg-blue-50/40 font-bold text-slate-700 outline-none focus:bg-white focus:border-blue-500">
                </div>
            </div>
            
            <div class="mt-6 flex flex-col md:flex-row gap-4 items-end">
                <button onclick="saveAdminDescuento()" class="bg-red-600 text-white w-full py-4 rounded-2xl font-black shadow-xl shadow-red-200 hover:bg-red-700 transition-all flex items-center justify-center gap-3">
                    <i class="ph-bold ph-check-circle"></i> APLICAR DEDUCCION
                </button>
                ${Export.exportButton('exportDescuentosCsv()')}
            </div>
            <p class="text-[10px] text-slate-400 mt-4 italic text-center">* Los descuentos con fecha manual afectaran la liquidacion de dicho periodo automaticamente.</p>
        </div>

        <h3 class="text-xl font-black text-slate-700 mt-10 px-2 flex items-center gap-2"><i class="ph ph-clock-counter-clockwise"></i> Historial de Descuentos por Funcionario</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">`;

    if (Object.keys(grouped).length === 0) {
        html += `<div class="col-span-full text-center py-20 text-slate-300 font-bold border-2 border-dashed border-slate-200 rounded-[40px]">No hay penalizaciones registradas.</div>`;
    }

    Object.keys(grouped).forEach((empId) => {
        const emp = employeesData.find((e) => e.id === empId);
        const name = emp ? emp.fullName : 'S/N';
        const lista = grouped[empId].sort((a, b) => {
            const da = a.date ? new Date(a.date) : a.createdAt ? a.createdAt.toDate() : new Date();
            const db = b.date ? new Date(b.date) : b.createdAt ? b.createdAt.toDate() : new Date();
            return db - da;
        });

        html += `
            <div class="bg-white p-5 rounded-[25px] border border-slate-100 shadow-sm hover:shadow-lg transition-all cursor-pointer group" onclick="document.getElementById('dhist-${empId}').classList.remove('hidden')">
                <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-red-600 group-hover:scale-110 transition-transform"><i class="ph-fill ph-warning-circle text-2xl"></i></div>
                    <div>
                        <h5 class="font-bold text-slate-700 text-sm">${name}</h5>
                        <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${lista.length} Descuento(s) total</p>
                    </div>
                </div>
            </div>
            
            <div id="dhist-${empId}" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4" onclick="this.classList.add('hidden')">
                <div class="bg-white w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-[40px] p-8 shadow-2xl animate-scale-up border border-slate-200" onclick="event.stopPropagation()">
                    <div class="flex justify-between items-center mb-8">
                        <div>
                            <h3 class="font-black text-2xl text-slate-800">${name}</h3>
                            <p class="text-xs text-slate-400 font-bold">Registro detallado de deducciones</p>
                        </div>
                        <button onclick="document.getElementById('dhist-${empId}').classList.add('hidden')" class="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"><i class="ph-bold ph-x text-lg"></i></button>
                    </div>
                    <div class="space-y-4">
                        ${lista
                            .map((d) => {
                                let fechaFmt = '-';
                                if (d.date) {
                                    const [y, m, day] = d.date.split('-');
                                    fechaFmt = `${day}/${m}/${y}`;
                                } else if (d.createdAt) {
                                    const dateRaw = d.createdAt.toDate().toISOString().split('T')[0];
                                    const [y, m, day] = dateRaw.split('-');
                                    fechaFmt = `${day}/${m}/${y}`;
                                }

                                return `
                            <div class="p-5 bg-slate-50 rounded-[25px] border border-slate-100 flex justify-between items-center group/item hover:bg-white transition-all">
                                <div>
                                    <p class="font-black text-red-600 text-xl">- Gs. ${Number(d.amount).toLocaleString()}</p>
                                    <p class="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-tight">${d.reason}</p>
                                </div>
                                <div class="text-right">
                                    <span class="text-[10px] text-slate-400 block font-black mb-1">${fechaFmt}</span>
                                    <span class="text-[9px] font-black px-3 py-1 rounded-full border bg-white text-slate-500 border-slate-200 uppercase">${d.status || 'Activo'}</span>
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
// UTILIDADES DINAMICAS (WINDOW SCOPE)
// ==========================================

window.filterAdminEmployees = (text) => {
    const list = document.getElementById('adminEmpList');
    const inputId = document.getElementById('adminDescEmpId');
    const inputSearch = document.getElementById('adminDescSearch');

    list.innerHTML = '';
    if (text.length === 0) {
        list.classList.add('hidden');
        return;
    }

    const matches = employeesData.filter((e) => e.fullName.toLowerCase().includes(text.toLowerCase()));

    if (matches.length > 0) {
        list.classList.remove('hidden');
        matches.forEach((e) => {
            const div = document.createElement('div');
            div.className =
                'p-3 hover:bg-red-50 cursor-pointer text-sm font-bold text-slate-700 border-b border-slate-50 last:border-0';
            div.innerText = e.fullName;
            if (e.status === 'INACTIVO') {
                div.innerHTML += ' <span class="text-[9px] text-rose-500 font-black ml-2">(BAJA)</span>';
            }
            div.onclick = () => {
                inputSearch.value = e.fullName;
                inputId.value = e.id;
                list.classList.add('hidden');
            };
            list.appendChild(div);
        });
    } else {
        list.classList.add('hidden');
    }
};

window.formatCurrencyInput = (input) => {
    let val = input.value.replace(/\D/g, '');
    if (val === '') {
        input.value = '';
        return;
    }
    input.value = new Intl.NumberFormat('es-PY').format(val);
};

window.saveAdminDescuento = async () => {
    const empId = document.getElementById('adminDescEmpId').value;
    const rawAmount = document.getElementById('adminDescAmount').value.replace(/\D/g, '');
    const reason = document.getElementById('adminDescReason').value;
    const manualDate = document.getElementById('adminDescDate').value;

    if (!empId) return showToast('Error', 'Seleccione un funcionario de la lista.');
    if (!rawAmount || Number(rawAmount) <= 0) return showToast('Error', 'El monto debe ser mayor a 0.');
    if (!reason) return showToast('Error', 'Defina el motivo del descuento.');

    const finalDate = manualDate || new Date().toISOString().split('T')[0];

    const btn = document.querySelector('button[onclick="saveAdminDescuento()"]');
    const oldText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'PROCESANDO...';

    try {
        await addDoc(collection(db, 'descuentos'), {
            employeeId: empId,
            amount: Number(rawAmount),
            reason: reason,
            date: finalDate,
            createdAt: serverTimestamp(),
            status: 'Aplicado',
        });

        showToast('Registrado', 'Deduccion aplicada correctamente.');

        document.getElementById('adminDescEmpId').value = '';
        document.getElementById('adminDescSearch').value = '';
        document.getElementById('adminDescAmount').value = '';
        document.getElementById('adminDescReason').value = '';
        document.getElementById('adminDescDate').value = '';
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo sincronizar el descuento.');
    } finally {
        btn.disabled = false;
        btn.innerText = oldText;
    }
};

// Exportaciones CSV
window.exportEmployeesCsv = () => {
    const columns = [
        { label: 'Nombre', value: (e) => e.fullName || '' },
        { label: 'CI', value: (e) => e.dni || '' },
        { label: 'Cargo', value: (e) => e.position || '' },
        { label: 'Sucursal', value: (e) => e.branch || '' },
        { label: 'Ingreso', value: (e) => e.startDate || '' },
        { label: 'Estado', value: (e) => e.status || 'ACTIVO' },
        { label: 'Baja', value: (e) => e.endDate || '' },
        { label: 'Salario vigente', value: (e) => SalariosModule.getEffectiveSalaryAmountForDate(e, new Date()) },
        { label: 'Telefono', value: (e) => e.phone || '' },
    ];
    Export.downloadCsv(`personal-${Export.dateStamp()}`, columns, employeesData);
    showToast('Exportado', 'CSV de personal generado.', 'success');
};

window.exportDescuentosCsv = () => {
    const empName = (id) => employeesData.find((e) => e.id === id)?.fullName || id;
    const columns = [
        { label: 'Funcionario', value: (d) => empName(d.employeeId) },
        { label: 'Fecha', value: (d) => d.date || '' },
        { label: 'Motivo', value: (d) => d.reason || '' },
        { label: 'Monto', value: (d) => Number(d.amount) || 0 },
        { label: 'Estado', value: (d) => d.status || '' },
    ];
    Export.downloadCsv(
        `descuentos-${Export.dateStamp()}`,
        columns,
        descuentosData.filter((d) => !d.deleted)
    );
    showToast('Exportado', 'CSV de descuentos generado.', 'success');
};

/**
 * CUMPLEANOS DEL MES
 */
function viewBirthdays() {
    const monthNames = [
        'ENERO',
        'FEBRERO',
        'MARZO',
        'ABRIL',
        'MAYO',
        'JUNIO',
        'JULIO',
        'AGOSTO',
        'SEPTIEMBRE',
        'OCTUBRE',
        'NOVIEMBRE',
        'DICIEMBRE',
    ];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    const birthdayEntries = employeesData
        .filter((emp) => emp.dob && emp.status !== 'INACTIVO')
        .map((emp) => {
            const [, monthRaw, dayRaw] = emp.dob.split('-');
            const month = Number(monthRaw);
            const day = Number(dayRaw);
            if (!month || !day) return null;

            const nextBirthdayYear =
                month < currentMonth || (month === currentMonth && day < currentDay)
                    ? now.getFullYear() + 1
                    : now.getFullYear();
            const nextBirthday = new Date(nextBirthdayYear, month - 1, day);
            const diffDays = Math.round(
                (new Date(nextBirthdayYear, month - 1, day) -
                    new Date(now.getFullYear(), now.getMonth(), now.getDate())) /
                    (1000 * 60 * 60 * 24)
            );

            return {
                ...emp,
                birthMonth: month,
                birthDay: day,
                nextBirthday,
                diffDays,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.nextBirthday - b.nextBirthday);

    const birthdaysThisMonth = birthdayEntries
        .filter((item) => item.birthMonth === currentMonth)
        .sort((a, b) => a.birthDay - b.birthDay);

    const birthdaysToday = birthdayEntries.filter((item) => item.diffDays === 0);
    const birthdaysThisWeek = birthdayEntries.filter((item) => item.diffDays >= 0 && item.diffDays <= 7);
    const nextBirthday = birthdayEntries[0] || null;

    const renderBirthdayCard = (item, mode = 'month') => {
        const accentClass =
            item.diffDays === 0
                ? 'from-amber-400 via-orange-400 to-rose-500'
                : item.diffDays <= 7
                  ? 'from-pink-500 via-rose-500 to-orange-400'
                  : 'from-fuchsia-500 via-pink-500 to-rose-500';
        const badgeText =
            item.diffDays === 0
                ? 'HOY'
                : item.diffDays === 1
                  ? 'MANANA'
                  : item.diffDays > 1 && item.diffDays <= 7
                    ? `EN ${item.diffDays} DIAS`
                    : monthNames[item.birthMonth - 1];
        const subtitle =
            mode === 'upcoming'
                ? `Proximo cumple: ${String(item.birthDay).padStart(2, '0')}/${String(item.birthMonth).padStart(2, '0')}`
                : `Cumple el ${String(item.birthDay).padStart(2, '0')} de ${monthNames[item.birthMonth - 1]}`;

        return `
            <article class="bg-white rounded-[32px] border border-pink-100 shadow-lg overflow-hidden group hover:-translate-y-1 hover:shadow-2xl transition-all">
                <div class="h-2 bg-gradient-to-r ${accentClass}"></div>
                <div class="p-6">
                    <div class="flex items-start justify-between gap-3 mb-5">
                        <span class="text-[10px] font-black uppercase tracking-[2px] px-3 py-1 rounded-full bg-pink-50 text-pink-600">${badgeText}</span>
                        <div class="text-right">
                            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha</p>
                            <p class="text-2xl font-black text-slate-800 leading-none">${String(item.birthDay).padStart(2, '0')}</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-4">
                        <div class="w-20 h-20 rounded-[24px] overflow-hidden shadow-md flex-shrink-0 bg-gradient-to-br from-pink-100 to-rose-100">
                            ${item.photo ? `<img src="${item.photo}" class="w-full h-full object-cover">` : '<div class="h-full flex items-center justify-center"><i class="ph-duotone ph-cake text-pink-400 text-4xl"></i></div>'}
                        </div>
                        <div class="min-w-0">
                            <h4 class="font-black text-slate-800 text-lg leading-tight truncate">${item.fullName}</h4>
                            <p class="text-[10px] font-black uppercase tracking-[2px] text-pink-500 truncate mt-1">${item.position}</p>
                            <p class="text-[11px] font-bold text-slate-500 mt-2 truncate">${subtitle}</p>
                            <p class="text-[11px] font-bold text-slate-400 truncate"><i class="ph ph-storefront"></i> ${item.branch}</p>
                        </div>
                    </div>
                </div>
            </article>`;
    };

    const upcomingGrid = birthdayEntries.length
        ? birthdayEntries
              .slice(0, 6)
              .map((item) => renderBirthdayCard(item, 'upcoming'))
              .join('')
        : `<div class="md:col-span-2 xl:col-span-3 bg-white border border-dashed border-slate-200 rounded-[32px] p-10 text-center text-slate-400 font-bold">No hay cumpleanos cargados para mostrar.</div>`;

    const monthGrid = birthdaysThisMonth.length
        ? birthdaysThisMonth.map((item) => renderBirthdayCard(item, 'month')).join('')
        : `<div class="md:col-span-2 xl:col-span-3 bg-white border border-dashed border-pink-200 rounded-[32px] p-12 text-center">
                <i class="ph-duotone ph-cake text-5xl text-pink-200 mb-4"></i>
                <p class="font-black text-slate-700 text-xl">No hay cumpleanos de activos en ${monthNames[currentMonth - 1]}.</p>
                <p class="text-sm font-bold text-slate-400 mt-2">Cuando se aproxime una celebracion, aparecera aqui ordenada por fecha.</p>
           </div>`;

    return `
        <div class="max-w-7xl mx-auto space-y-8 fade-in pb-20">
            <section class="relative overflow-hidden rounded-[40px] p-10 lg:p-12 text-white bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.28),_transparent_28%),linear-gradient(135deg,_#ef4444_0%,_#ec4899_45%,_#f97316_100%)] shadow-2xl">
                <div class="absolute -right-10 -top-10 w-52 h-52 rounded-full bg-white/10 blur-2xl"></div>
                <div class="absolute right-8 bottom-0 text-[180px] opacity-10 pointer-events-none"><i class="ph-duotone ph-confetti"></i></div>
                <div class="relative z-10 max-w-3xl">
                    <p class="text-[11px] font-black uppercase tracking-[4px] text-white/80">Calendario de celebraciones</p>
                    <h2 class="text-4xl lg:text-5xl font-black tracking-tight mt-3">Cumpleanos del equipo</h2>
                    <p class="mt-4 text-sm lg:text-base font-bold text-white/85">Una vista mas clara para saber quien cumple hoy, esta semana y durante el mes actual, sin perder de vista los proximos aniversarios del equipo.</p>
                </div>
            </section>

            <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div class="bg-white rounded-[28px] border border-slate-100 p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Cumpleanos del mes</p>
                    <p class="text-3xl font-black text-slate-800 mt-2">${birthdaysThisMonth.length}</p>
                    <p class="text-xs font-bold text-slate-500 mt-1">${monthNames[currentMonth - 1]}</p>
                </div>
                <div class="bg-white rounded-[28px] border border-slate-100 p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Celebran hoy</p>
                    <p class="text-3xl font-black text-slate-800 mt-2">${birthdaysToday.length}</p>
                    <p class="text-xs font-bold text-slate-500 mt-1">${birthdaysToday.length ? birthdaysToday.map((item) => item.fullName).join(', ') : 'Sin festejos hoy'}</p>
                </div>
                <div class="bg-white rounded-[28px] border border-slate-100 p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Proximos 7 dias</p>
                    <p class="text-3xl font-black text-slate-800 mt-2">${birthdaysThisWeek.length}</p>
                    <p class="text-xs font-bold text-slate-500 mt-1">${birthdaysThisWeek.length ? 'Equipo a agasajar esta semana' : 'Sin fechas cercanas'}</p>
                </div>
                <div class="bg-white rounded-[28px] border border-slate-100 p-5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Proximo aniversario</p>
                    <p class="text-lg font-black text-slate-800 mt-2">${nextBirthday ? nextBirthday.fullName : 'Sin registros'}</p>
                    <p class="text-xs font-bold text-slate-500 mt-1">${nextBirthday ? `${String(nextBirthday.birthDay).padStart(2, '0')}/${String(nextBirthday.birthMonth).padStart(2, '0')} | ${nextBirthday.branch}` : 'Carga una fecha de nacimiento para verlo aqui'}</p>
                </div>
            </section>

            <section class="space-y-4">
                <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div>
                        <h3 class="text-2xl font-black text-slate-800">Proximos cumpleanos</h3>
                        <p class="text-sm font-bold text-slate-500 mt-1">Ordenados por cercania real para que puedas anticipar saludos, regalos o avisos internos.</p>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    ${upcomingGrid}
                </div>
            </section>

            <section class="space-y-4">
                <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div>
                        <h3 class="text-2xl font-black text-slate-800">Agenda de ${monthNames[currentMonth - 1]}</h3>
                        <p class="text-sm font-bold text-slate-500 mt-1">Solo se muestran funcionarios activos para mantener limpia la agenda actual.</p>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    ${monthGrid}
                </div>
            </section>
        </div>`;
}

const TOAST_STYLES = {
    success: { border: 'border-emerald-500', wrap: 'bg-emerald-50', icon: 'ph-fill ph-check-circle text-emerald-600' },
    error: { border: 'border-rose-500', wrap: 'bg-rose-50', icon: 'ph-fill ph-x-circle text-rose-600' },
    warning: { border: 'border-amber-500', wrap: 'bg-amber-50', icon: 'ph-fill ph-warning-circle text-amber-600' },
    info: { border: 'border-blue-600', wrap: 'bg-blue-50', icon: 'ph-fill ph-info text-blue-600' },
};

// Deduce la severidad segun el titulo del toast.
function inferToastType(title = '') {
    const text = String(title).toLowerCase();
    if (/(error|fallo|no se pudo|invalido|denegad|rechaz)/.test(text)) return 'error';
    if (/(aviso|advertencia|atencion|pendiente)/.test(text)) return 'warning';
    if (/(exito|exitoso|guardad|registrad|actualizad|eliminad|completad|aprobad|exportad|ok)/.test(text))
        return 'success';
    return 'info';
}

function showToast(title, msg, type) {
    const t = document.getElementById('toast');
    if (!t) return;

    const titleEl = document.getElementById('toastTitle');
    const msgEl = document.getElementById('toastMessage');

    titleEl.innerText = title;
    msgEl.innerText = msg;

    const resolvedType = type || inferToastType(title);
    const palette = TOAST_STYLES[resolvedType] || TOAST_STYLES.info;
    const card = document.getElementById('toastCard');
    const iconWrap = document.getElementById('toastIconWrap');
    const icon = document.getElementById('toastIcon');

    if (card) {
        card.className =
            'bg-white border-l-[6px] shadow-2xl rounded-2xl p-4 sm:p-5 flex items-center gap-4 w-[min(92vw,360px)]';
        card.classList.add(palette.border);
    }
    if (iconWrap)
        iconWrap.className = `w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${palette.wrap}`;
    if (icon) icon.className = `${palette.icon} text-xl`;

    t.classList.remove('hidden');
    if (card) {
        card.classList.remove('animate-toast-in');
        void card.offsetWidth;
        card.classList.add('animate-toast-in');
    }

    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        t.classList.add('hidden');
    }, CONFIG_UI.toastDuration);
}

// ==========================================
// VISTA: GESTION DE USUARIOS (ADMIN)
// ==========================================
function viewAdminUsers() {
    if (currentUserRole !== 'ADMIN') return '<div class="p-8 text-center text-red-500 font-bold">Acceso Denegado</div>';

    const isAdmin = currentUserRole === 'ADMIN';
    const visibleUsers = usersData;

    return `
    <div class="max-w-6xl mx-auto space-y-8 fade-in pb-20">
        <div class="bg-white p-6 rounded-[30px] shadow-lg border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
                <h3 class="text-2xl font-black text-slate-800">Gestion de Usuarios</h3>
                <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Creacion y administracion de accesos del sistema</p>
            </div>
            <button onclick="openCreateUserModal()" class="bg-blue-600 hover:bg-blue-700 text-white font-black px-6 py-3.5 rounded-2xl shadow-lg transition-all flex items-center gap-2">
                <i class="ph-bold ph-user-plus text-lg"></i> NUEVO USUARIO
            </button>
        </div>

        <div class="bg-white rounded-[30px] shadow-sm border border-slate-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-slate-100 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th class="p-5">Usuario / Nombre</th>
                            <th class="p-5">Correo</th>
                            <th class="p-5">Rol</th>
                            <th class="p-5 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-xs font-bold text-slate-600">
                        ${
                            visibleUsers.length === 0
                                ? `
                            <tr><td colspan="4" class="p-8 text-center text-slate-400">No hay usuarios adicionales cargados en la base de datos.</td></tr>
                        `
                                : visibleUsers
                                      .map(
                                          (u) => `
                            <tr class="hover:bg-slate-50/50 transition-colors">
                                <td class="p-5 font-black text-slate-800 flex items-center gap-3">
                                    <div class="w-9 h-9 rounded-xl ${u.role === 'RRHH' ? 'bg-indigo-100 text-indigo-600' : 'bg-blue-100 text-blue-600'} flex items-center justify-center font-bold">
                                        <i class="ph-fill ${u.role === 'RRHH' ? 'ph-user-gear' : 'ph-shield-check'}"></i>
                                    </div>
                                    ${u.fullName || u.email.split('@')[0]}
                                </td>
                                <td class="p-5">${u.email}</td>
                                <td class="p-5">
                                    <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase ${u.role === 'RRHH' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}">
                                        ${u.role || 'ADMIN'}
                                    </span>
                                </td>
                                <td class="p-5 text-right space-x-2">
                                    <button onclick="openEditUserModal('${u.id}')" class="p-2 rounded-xl bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 transition-colors">
                                        <i class="ph-bold ph-pencil-simple text-sm"></i>
                                    </button>
                                    <button onclick="deleteUser('${u.id}', '${u.email}')" class="p-2 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 transition-colors">
                                        <i class="ph-bold ph-trash text-sm"></i>
                                    </button>
                                </td>
                            </tr>
                        `
                                      )
                                      .join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- MODAL CREAR USUARIO -->
    <div id="userCreateModal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4">
        <div class="bg-white w-full max-w-md rounded-[30px] p-8 shadow-2xl border border-slate-100 animate-fade-in-up">
            <div class="flex justify-between items-center mb-6">
                <h3 class="font-black text-xl text-slate-800">Crear Nuevo Usuario</h3>
                <button onclick="closeUserCreateModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><i class="ph-bold ph-x"></i></button>
            </div>
            <form id="createUserForm" onsubmit="saveNewUser(event)" class="space-y-4">
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Nombre Completo</label>
                    <input type="text" id="userFullName" required placeholder="Ej: Maria Lopez" class="w-full border-2 border-slate-100 p-3.5 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Correo Electronico</label>
                    <input type="email" id="userEmailInput" required placeholder="usuario@empresa.com" class="w-full border-2 border-slate-100 p-3.5 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Contrasena</label>
                    <input type="password" id="userPasswordInput" required minlength="6" placeholder="******" class="w-full border-2 border-slate-100 p-3.5 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Rol de Acceso</label>
                    <select id="userRoleInput" class="w-full border-2 border-slate-100 p-3.5 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-blue-500">
                        <option value="RRHH">RRHH (Acceso Limitado)</option>
                        ${isAdmin ? '<option value="ADMIN">ADMIN (Panel Completo)</option>' : ''}
                    </select>
                </div>
                <button type="submit" id="btnSubmitUser" class="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-blue-700 transition-all mt-4">CREAR USUARIO</button>
            </form>
        </div>
    </div>

    <!-- MODAL EDITAR USUARIO -->
    <div id="userEditModal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4">
        <div class="bg-white w-full max-w-md rounded-[30px] p-8 shadow-2xl border border-slate-100 animate-fade-in-up">
            <div class="flex justify-between items-center mb-6">
                <h3 class="font-black text-xl text-slate-800">Modificar Usuario</h3>
                <button onclick="closeUserEditModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><i class="ph-bold ph-x"></i></button>
            </div>
            <form id="editUserForm" onsubmit="saveEditUser(event)" class="space-y-4">
                <input type="hidden" id="editUserId">
                <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Nombre Completo</label>
                    <input type="text" id="editUserFullName" required class="w-full border-2 border-slate-100 p-3.5 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-blue-500">
                </div>
                <button type="submit" id="btnSubmitEditUser" class="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-indigo-700 transition-all mt-4">GUARDAR CAMBIOS</button>
            </form>
        </div>
    </div>`;
}

// ==========================================
// VISTA: APROBACION DE PAGOS (ADMIN)
// ==========================================
function viewAdminAprobacionPagos() {
    if (currentUserRole !== 'ADMIN') return '<div class="p-8 text-center text-red-500 font-bold">Acceso Denegado</div>';

    const valesPendientes = valesData
        .filter((v) => v.estadoAprobacion === 'PENDIENTE_RENDICION' && !v.deleted)
        .map((v) => ({ ...v, _coll: 'vales', _type: 'VALE' }));
    const salariesPendientes = salariesData
        .filter((s) => s.estadoAprobacion === 'PENDIENTE_RENDICION' && !s.deleted)
        .map((s) => ({ ...s, _coll: 'salaries', _type: s.type === 'INDIVIDUAL' ? 'ADELANTO / PAGO' : 'LIQUIDACION' }));

    const pendientes = [...valesPendientes, ...salariesPendientes].sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.date || 0);
        const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.date || 0);
        return db - da;
    });

    const totalMonto = pendientes.reduce((acc, p) => acc + Number(p.amount || p.netPay || 0), 0);

    return `
    <div class="max-w-6xl mx-auto space-y-8 fade-in pb-20">
        <div class="bg-white p-6 rounded-[30px] shadow-lg border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
                <h3 class="text-2xl font-black text-slate-800">Aprobacion y Rendicion de Pagos</h3>
                <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Rendicion de cuentas de los pagos emitidos por el equipo de RRHH</p>
            </div>
            <div class="bg-amber-50 border border-amber-200 px-5 py-3 rounded-2xl flex items-center gap-3">
                <i class="ph-fill ph-clock-counter-clockwise text-amber-500 text-2xl"></i>
                <div>
                    <p class="text-[9px] font-black text-amber-600 uppercase">PENDIENTE DE RENDICION</p>
                    <p class="text-lg font-black text-amber-900">Gs. ${totalMonto.toLocaleString('es-PY')}</p>
                </div>
            </div>
        </div>

        <div class="bg-white rounded-[30px] shadow-sm border border-slate-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-slate-100 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th class="p-5">Fecha / Emisor RRHH</th>
                            <th class="p-5">Funcionario</th>
                            <th class="p-5">Tipo / Concepto</th>
                            <th class="p-5">Monto (Gs.)</th>
                            <th class="p-5 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-xs font-bold text-slate-600">
                        ${
                            pendientes.length === 0
                                ? `
                            <tr><td colspan="5" class="p-10 text-center text-slate-400">No hay pagos ni vales pendientes de rendición.</td></tr>
                        `
                                : pendientes
                                      .map((p) => {
                                          const emp = employeesData.find((e) => e.id === p.employeeId);
                                          const name = p.employeeName || (emp ? emp.fullName : 'S/N');
                                          const amount = Number(p.amount || p.netPay || 0);
                                          const emisor = p.creadoPorEmail || p.createdBy || 'Usuario RRHH';
                                          const dateStr = p.createdAt?.toDate
                                              ? p.createdAt.toDate().toLocaleString('es-PY')
                                              : p.date || 'Reciente';
                                          return `
                                <tr class="hover:bg-slate-50/50 transition-colors">
                                    <td class="p-5">
                                        <div class="font-black text-slate-800">${dateStr}</div>
                                        <div class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded inline-block mt-1">${emisor}</div>
                                    </td>
                                    <td class="p-5 font-black text-slate-700">${name}</td>
                                    <td class="p-5">
                                        <span class="px-2 py-1 rounded text-[10px] font-black uppercase bg-amber-100 text-amber-700">${p._type}</span>
                                        <div class="text-[10px] text-slate-400 mt-1">${p.reason || p.details || '---'}</div>
                                    </td>
                                    <td class="p-5 font-black text-slate-900 text-sm">Gs. ${amount.toLocaleString('es-PY')}</td>
                                    <td class="p-5 text-right space-x-2">
                                        <button onclick="reimprimirTicketRendicion('${p._coll}', '${p.id}')" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-blue-100 text-slate-700 font-black text-[11px] transition-colors">
                                            <i class="ph-bold ph-printer"></i> Ticket
                                        </button>
                                        <button onclick="aprobarRendicionPago('${p._coll}', '${p.id}')" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] transition-colors shadow-sm">
                                            <i class="ph-bold ph-check"></i> Rendir / Aprobar
                                        </button>
                                    </td>
                                </tr>
                            `;
                                      })
                                      .join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    </div>`;
}

// HANDLERS GLOBALES PARA USUARIOS Y RENDICION DE PAGOS
window.openCreateUserModal = () => {
    document.getElementById('userCreateModal')?.classList.remove('hidden');
};
window.closeUserCreateModal = () => {
    document.getElementById('userCreateModal')?.classList.add('hidden');
};
window.openEditUserModal = (id) => {
    const u = usersData.find((x) => x.id === id);
    if (!u) return;
    document.getElementById('editUserId').value = u.id;
    document.getElementById('editUserFullName').value = u.fullName || '';
    document.getElementById('userEditModal')?.classList.remove('hidden');
};
window.closeUserEditModal = () => {
    document.getElementById('userEditModal')?.classList.add('hidden');
};

window.saveNewUser = async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('userFullName').value.trim();
    const email = document.getElementById('userEmailInput').value.trim();
    const password = document.getElementById('userPasswordInput').value;
    const role = document.getElementById('userRoleInput').value;
    const btn = document.getElementById('btnSubmitUser');

    btn.disabled = true;
    btn.innerText = 'CREANDO...';
    try {
        await createUser({ email, password, fullName, role });
        showToast('Exito', `Usuario ${email} creado con rol ${role}`);
        window.closeUserCreateModal();
        document.getElementById('createUserForm').reset();
    } catch (err) {
        console.error(err);
        showToast('Error', err.message || 'No se pudo crear el usuario');
    } finally {
        btn.disabled = false;
        btn.innerText = 'CREAR USUARIO';
    }
};

window.saveEditUser = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editUserId').value;
    const fullName = document.getElementById('editUserFullName').value.trim();
    const btn = document.getElementById('btnSubmitEditUser');

    btn.disabled = true;
    btn.innerText = 'GUARDANDO...';
    try {
        const patch = { fullName, updatedAt: serverTimestamp() };
        await updateDoc(doc(db, 'users', id), patch);
        showToast('Exito', 'Usuario modificado correctamente');
        window.closeUserEditModal();
    } catch (err) {
        console.error(err);
        showToast('Error', 'Error al actualizar usuario');
    } finally {
        btn.disabled = false;
        btn.innerText = 'GUARDAR CAMBIOS';
    }
};

window.deleteUser = async (id, email) => {
    const confirmado = await uiConfirm({
        title: 'Eliminar usuario',
        message: `Eliminar usuario ${email}?`,
        tone: 'danger',
        confirmText: 'Eliminar',
    });
    if (!confirmado) return;
    try {
        await deleteDoc(doc(db, 'users', id));
        showToast('Eliminado', 'Usuario removido');
    } catch (err) {
        showToast('Error', 'No se pudo eliminar');
    }
};

window.aprobarRendicionPago = async (collName, docId) => {
    try {
        await updateDoc(doc(db, collName, docId), {
            estadoAprobacion: 'APROBADO',
            aprobadoPorAdmin: auth.currentUser?.email || 'Admin',
            fechaAprobacion: serverTimestamp(),
        });
        showToast('Exito', 'Rendicion aprobada por Administracion');
    } catch (err) {
        console.error(err);
        showToast('Error', 'No se pudo aprobar la rendicion');
    }
};

window.reimprimirTicketRendicion = (collName, docId) => {
    let item;
    if (collName === 'vales') item = valesData.find((v) => v.id === docId);
    else item = salariesData.find((s) => s.id === docId);
    if (!item) return;

    const emp = employeesData.find((e) => e.id === item.employeeId);
    printTicket({
        sucursal: item.employeeBranch || emp?.branch || 'MATRIZ',
        employeeName: item.employeeName || emp?.fullName || '',
        employeePosition: item.employeePosition || emp?.position || '',
        paymentCode: item.paymentCode || 'RENDICION',
        type:
            collName === 'vales'
                ? 'VALE / ADELANTO'
                : item.type === 'INDIVIDUAL'
                  ? 'ADELANTO / PAGO'
                  : 'LIQUIDACION DE SUELDO',
        detail: item.reason || item.details || '',
        amount: Number(item.amount || item.netPay || 0),
        doubleTicket: true,
    }).catch((err) => console.error(err));
};
