import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

export function initComisionesGlobalListeners(toastCb) {}

export function setupCreateComisionLogic(toastCb) {
    const form = document.getElementById('comForm');
    if(!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const empId = document.getElementById('com-emp').value;
        const amount = Number(document.getElementById('com-amount').value);
        const reason = document.getElementById('com-reason').value;
        if(!empId || amount <= 0) return toastCb("Error", "Datos incompletos");
        await addDoc(collection(db, "comisiones"), { employeeId: empId, amount, reason, status: 'Aprobado', createdAt: serverTimestamp() });
        toastCb("Éxito", "Comisión registrada");
        form.reset();
    });
}

export function getViewCreateComision(employees) {
    return `
        <div class="max-w-xl mx-auto bg-white p-8 rounded-[30px] shadow-lg border border-emerald-50 fade-in">
            <h3 class="font-black text-2xl text-slate-800 mb-6">Registrar Comisión</h3>
            <form id="comForm" class="space-y-4">
                <select id="com-emp" class="w-full p-4 rounded-xl border-2 border-slate-100 font-bold text-slate-600 bg-slate-50">
                    <option value="">Seleccione...</option>
                    ${employees.map(e => `<option value="${e.id}">${e.fullName}</option>`).join('')}
                </select>
                <input type="number" id="com-amount" placeholder="Monto (Gs)" class="w-full p-4 rounded-xl border-2 border-slate-100 font-black text-slate-600 bg-slate-50">
                <input type="text" id="com-reason" placeholder="Motivo" class="w-full p-4 rounded-xl border-2 border-slate-100 font-bold text-slate-600 bg-slate-50">
                <button class="w-full bg-emerald-500 text-white font-black py-4 rounded-xl shadow-lg shadow-emerald-200">REGISTRAR</button>
            </form>
        </div>`;
}

export function getViewListComisiones(comisiones) {
    if(!comisiones.length) return '<div class="text-center p-10 opacity-50 font-bold">SIN COMISIONES</div>';
    let html = '<div class="grid gap-4 fade-in">';
    comisiones.forEach(c => {
        html += `<div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center">
            <div><p class="font-black text-slate-700">Gs. ${c.amount.toLocaleString()}</p><p class="text-xs text-slate-400">${c.reason}</p></div>
            <span class="px-3 py-1 rounded-lg text-[10px] font-black uppercase ${c.status==='Pagado'?'bg-indigo-100 text-indigo-600':'bg-emerald-100 text-emerald-600'}">${c.status}</span>
        </div>`;
    });
    return html + '</div>';
}