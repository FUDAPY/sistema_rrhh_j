// public/js/desempeno.js
import { collection, addDoc, serverTimestamp, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

let _toast = null;

// ==========================================
// 1. LISTENERS GLOBALES
// ==========================================
export function initDesempenoListeners(toastCb) {
    _toast = toastCb;
    window.deleteEvaluacion = async (id) => {
        if(!confirm("¿Eliminar esta evaluación?")) return;
        try {
            await deleteDoc(doc(db, "evaluaciones", id));
            if(_toast) _toast("Eliminado", "Evaluación borrada del historial.");
        } catch(e) { console.error(e); }
    };
}

// ==========================================
// 2. LÓGICA DE REGISTRO
// ==========================================
export function setupCreateDesempenoLogic(toastCb) {
    const form = document.getElementById('evalForm');
    if(!form) return;

    // Actualizar visualmente el número del slider
    const rangeInput = document.getElementById('eval-score');
    const scoreDisplay = document.getElementById('score-val');
    
    if(rangeInput && scoreDisplay) {
        rangeInput.addEventListener('input', (e) => {
            const val = e.target.value;
            scoreDisplay.innerText = val;
            // Cambiar color según nota
            scoreDisplay.className = `text-4xl font-black ${val < 5 ? 'text-red-500' : val < 8 ? 'text-yellow-500' : 'text-emerald-500'}`;
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const empId = document.getElementById('eval-emp').value;
        const score = Number(document.getElementById('eval-score').value);
        const feedback = document.getElementById('eval-feedback').value;
        const period = document.getElementById('eval-period').value; // Ej: "2024-03"

        if(!empId || !feedback) return toastCb("Error", "Complete todos los campos");

        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Guardando...';

        try {
            await addDoc(collection(db, "evaluaciones"), {
                employeeId: empId,
                score: score,
                feedback: feedback,
                period: period,
                createdAt: serverTimestamp()
            });
            toastCb("Éxito", "Evaluación registrada");
            form.reset();
            // Reset visual score
            if(scoreDisplay) { scoreDisplay.innerText = "5"; scoreDisplay.className = "text-4xl font-black text-yellow-500"; }
            if(rangeInput) rangeInput.value = 5;
        } catch (error) {
            console.error(error);
            toastCb("Error", "No se pudo guardar");
        } finally {
            btn.disabled = false; btn.innerHTML = '<i class="ph-bold ph-star"></i> GUARDAR EVALUACIÓN';
        }
    });
}

// ==========================================
// 3. VISTA: FORMULARIO
// ==========================================
export function getViewCreateDesempeno(employees) {
    return `
        <div class="max-w-3xl mx-auto bg-white p-10 rounded-[40px] shadow-xl border border-orange-50 fade-in">
            <div class="flex items-center gap-4 mb-8">
                <div class="w-14 h-14 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center text-3xl">
                    <i class="ph-fill ph-chart-line-up"></i>
                </div>
                <div>
                    <h3 class="text-2xl font-black text-slate-800">Nueva Evaluación</h3>
                    <p class="text-orange-500 font-bold text-xs uppercase tracking-widest">Medición de Desempeño</p>
                </div>
            </div>

            <form id="evalForm" class="grid grid-cols-1 gap-8">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Colaborador</label>
                        <div class="relative">
                            <select id="eval-emp" required class="w-full border-2 border-slate-50 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-orange-400 appearance-none">
                                <option value="">Seleccione...</option>
                                ${employees.map(e => `<option value="${e.id}">${e.fullName}</option>`).join('')}
                            </select>
                            <i class="ph-bold ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
                        </div>
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Periodo / Mes</label>
                        <input type="month" id="eval-period" required class="w-full border-2 border-slate-50 p-4 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-orange-400">
                    </div>
                </div>

                <div class="bg-slate-50 p-8 rounded-[30px] border border-slate-100 text-center">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 block">Puntaje General (1 al 10)</label>
                    <div class="flex items-center justify-center gap-4 mb-4">
                        <span id="score-val" class="text-4xl font-black text-yellow-500">5</span>
                        <span class="text-slate-300 font-bold text-xl">/ 10</span>
                    </div>
                    <input type="range" id="eval-score" min="1" max="10" value="5" class="w-full h-3 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-500">
                    <div class="flex justify-between text-[10px] font-bold text-slate-400 mt-2 px-1">
                        <span>BAJO</span>
                        <span>REGULAR</span>
                        <span>EXCELENTE</span>
                    </div>
                </div>

                <div>
                     <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Feedback / Comentarios</label>
                     <textarea id="eval-feedback" rows="4" required placeholder="Describa fortalezas y áreas de mejora..." class="w-full border-2 border-slate-50 p-4 rounded-2xl bg-slate-50 font-medium text-slate-600 outline-none focus:border-orange-400 resize-none"></textarea>
                </div>

                <div class="pt-2">
                    <button type="submit" class="w-full bg-orange-500 text-white py-4 rounded-2xl font-black shadow-xl shadow-orange-200 hover:bg-orange-600 hover:scale-[1.02] active:scale-95 transition-all flex justify-center items-center gap-3">
                        <i class="ph-bold ph-star text-xl"></i> GUARDAR EVALUACIÓN
                    </button>
                </div>
            </form>
        </div>`;
}

// ==========================================
// 4. VISTA: LISTADO
// ==========================================
export function getViewListDesempeno(evaluaciones, employees) {
    if(!evaluaciones.length) return '<div class="text-center p-20 text-slate-300 font-bold">NO HAY EVALUACIONES</div>';

    let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-6 fade-in">';
    
    evaluaciones.forEach(ev => {
        const emp = employees.find(e => e.id === ev.employeeId);
        const empName = emp ? emp.fullName : 'Ex-Colaborador';
        const empPhoto = emp ? emp.photo : null;
        
        // Color según nota
        let colorClass = ev.score < 5 ? 'bg-red-500' : ev.score < 8 ? 'bg-yellow-500' : 'bg-emerald-500';
        let bgClass = ev.score < 5 ? 'bg-red-50 border-red-100' : ev.score < 8 ? 'bg-yellow-50 border-yellow-100' : 'bg-emerald-50 border-emerald-100';

        html += `
            <div class="bg-white p-6 rounded-[30px] shadow-lg border border-slate-100 relative group hover:-translate-y-1 transition-all">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center gap-4">
                         <div class="w-14 h-14 rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 flex-shrink-0">
                             ${empPhoto ? `<img src="${empPhoto}" class="w-full h-full object-cover">` : '<i class="ph ph-user p-4 text-slate-300 text-2xl"></i>'}
                        </div>
                        <div>
                            <h4 class="font-black text-slate-800 leading-tight">${empName}</h4>
                            <p class="text-xs font-bold text-slate-400 mt-0.5 capitalize">${ev.period || 'Sin fecha'}</p>
                        </div>
                    </div>
                    <div class="flex flex-col items-end">
                        <div class="${colorClass} text-white w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shadow-md">
                            ${ev.score}
                        </div>
                    </div>
                </div>

                <div class="w-full bg-slate-100 rounded-full h-2 mb-4 overflow-hidden">
                    <div class="${colorClass} h-2 rounded-full" style="width: ${ev.score * 10}%"></div>
                </div>

                <div class="${bgClass} p-4 rounded-2xl text-sm font-medium text-slate-600 mb-4 relative">
                    <i class="ph-fill ph-quotes text-2xl absolute -top-2 -left-2 opacity-20"></i>
                    "${ev.feedback}"
                </div>

                <button onclick="deleteEvaluacion('${ev.id}')" class="w-full py-2 text-[10px] font-black text-red-300 hover:text-red-500 uppercase tracking-widest transition-colors">
                    Eliminar Reporte
                </button>
            </div>`;
    });

    return html + '</div>';
}