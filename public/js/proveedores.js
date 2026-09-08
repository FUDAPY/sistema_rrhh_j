// public/js/proveedores.js
import { collection, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

let _toast = null;

// ==========================================
// 1. LISTENERS GLOBALES
// ==========================================
export function initProveedoresListeners(toastCb) {
    _toast = toastCb;

    // Función para borrar proveedor
    window.deleteProveedor = async (id, name) => {
        if(!confirm(`¿Estás seguro de eliminar a ${name} de la lista de proveedores?`)) return;
        try {
            await deleteDoc(doc(db, "proveedores", id));
            if(_toast) _toast("Eliminado", "Proveedor borrado correctamente.");
        } catch(e) { console.error(e); }
    };
}

// ==========================================
// 2. LÓGICA DE REGISTRO
// ==========================================
export function setupCreateProveedorLogic(toastCb) {
    const form = document.getElementById('provForm');
    if(!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Obtenemos los datos del formulario
        const nombre = document.getElementById('prov-name').value;
        const ruc = document.getElementById('prov-ruc').value;
        const telefono = document.getElementById('prov-phone').value;
        const categoria = document.getElementById('prov-cat').value;
        const direccion = document.getElementById('prov-address').value;

        if(!nombre || !ruc) return toastCb("Error", "El nombre y RUC son obligatorios");

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Guardando...';

        try {
            await addDoc(collection(db, "proveedores"), {
                name: nombre,
                ruc: ruc,
                phone: telefono,
                category: categoria,
                address: direccion,
                createdAt: serverTimestamp()
            });
            toastCb("Éxito", "Proveedor registrado correctamente");
            form.reset();
        } catch (error) {
            console.error(error);
            toastCb("Error", "No se pudo registrar el proveedor");
        } finally {
            btn.disabled = false; btn.innerHTML = originalText;
        }
    });
}

// ==========================================
// 3. VISTA: FORMULARIO DE REGISTRO
// ==========================================
export function getViewCreateProveedor() {
    return `
        <div class="max-w-4xl mx-auto bg-white p-10 rounded-[40px] shadow-xl border border-slate-100 fade-in">
            <div class="flex items-center gap-4 mb-8 border-b border-slate-50 pb-6">
                <div class="w-16 h-16 bg-purple-100 text-purple-600 rounded-3xl flex items-center justify-center text-3xl shadow-sm">
                    <i class="ph-fill ph-truck"></i>
                </div>
                <div>
                    <h3 class="text-3xl font-black text-slate-800 tracking-tight">Alta de Proveedor</h3>
                    <p class="text-purple-500 font-bold text-xs uppercase tracking-widest mt-1">Gestión de Compras y Servicios</p>
                </div>
            </div>

            <form id="provForm" class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Razón Social / Nombre</label>
                    <input type="text" id="prov-name" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-purple-500 outline-none transition-all font-bold text-slate-700" placeholder="Ej: Distribuidora del Este S.A.">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">RUC / Documento</label>
                    <input type="text" id="prov-ruc" required class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-purple-500 outline-none transition-all font-bold text-slate-700" placeholder="80012345-6">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Teléfono de Pedidos</label>
                    <input type="tel" id="prov-phone" class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-purple-500 outline-none transition-all font-bold text-slate-700">
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Rubro / Categoría</label>
                    <select id="prov-cat" class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-purple-500 outline-none transition-all font-bold text-slate-600 appearance-none">
                        <option value="Insumos">Insumos Varios</option>
                        <option value="Alimentos">Alimentos y Bebidas</option>
                        <option value="Limpieza">Limpieza y Mantenimiento</option>
                        <option value="Tecnologia">Tecnología y Equipos</option>
                        <option value="Servicios">Servicios Profesionales</option>
                        <option value="Otros">Otros</option>
                    </select>
                </div>

                <div class="md:col-span-2 space-y-2">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Dirección / Ubicación</label>
                    <input type="text" id="prov-address" class="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl focus:bg-white focus:border-purple-500 outline-none transition-all font-bold text-slate-700">
                </div>

                <div class="md:col-span-2 pt-6">
                    <button type="submit" class="w-full bg-purple-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-purple-200 hover:bg-purple-700 hover:scale-[1.02] active:scale-95 transition-all flex justify-center items-center gap-3">
                        <i class="ph-bold ph-floppy-disk text-xl"></i> GUARDAR PROVEEDOR
                    </button>
                </div>
            </form>
        </div>`;
}

// ==========================================
// 4. VISTA: LISTADO DE PROVEEDORES
// ==========================================
export function getViewListProveedores(proveedores) {
    if(!proveedores || !proveedores.length) return '<div class="flex flex-col items-center justify-center py-40 opacity-40"><i class="ph-duotone ph-truck text-6xl mb-4"></i><p class="font-black text-xl">NO HAY PROVEEDORES</p></div>';

    let html = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 fade-in pb-20">`;

    proveedores.forEach(p => {
        html += `
            <div class="bg-white p-6 rounded-[30px] shadow-lg border border-slate-100 group hover:shadow-2xl transition-all relative">
                
                <div class="flex justify-between items-start mb-4">
                    <div class="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                        <i class="ph-fill ph-storefront text-xl"></i>
                    </div>
                    <span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider">${p.category}</span>
                </div>

                <h4 class="font-black text-slate-800 text-lg leading-tight mb-1 truncate">${p.name}</h4>
                <p class="text-xs font-bold text-slate-400 mb-6">RUC: ${p.ruc}</p>

                <div class="space-y-3 border-t border-slate-50 pt-4">
                    <div class="flex items-center gap-3 text-sm font-medium text-slate-600">
                        <i class="ph-bold ph-phone text-purple-400"></i>
                        <span>${p.phone || 'Sin teléfono'}</span>
                    </div>
                    <div class="flex items-center gap-3 text-sm font-medium text-slate-600">
                        <i class="ph-bold ph-map-pin text-purple-400"></i>
                        <span class="truncate">${p.address || 'Sin dirección'}</span>
                    </div>
                </div>

                <div class="mt-6 flex gap-3">
                    <a href="https://wa.me/${p.phone ? p.phone.replace(/\D/g,'') : ''}" target="_blank" class="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-green-600 transition-colors">
                        <i class="ph-bold ph-whatsapp-logo text-lg"></i> WHATSAPP
                    </a>
                    <button onclick="deleteProveedor('${p.id}', '${p.name}')" class="bg-red-50 text-red-500 p-2.5 rounded-xl hover:bg-red-500 hover:text-white transition-colors">
                        <i class="ph-bold ph-trash text-lg"></i>
                    </button>
                </div>
            </div>`;
    });

    return html + '</div>';
}