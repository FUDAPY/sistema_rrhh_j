// public/js/vales-public.js
import { 
    collection, 
    addDoc, 
    getDocs, 
    query, 
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// IMPORTAMOS LA BASE DE DATOS CENTRALIZADA
import { db } from "./firebase-config.js"; 

// Variables de estado
let employeesList = [];
let currentSalary = 0;
let maxLimit = 0;

// Referencias al DOM
const selectEmp = document.getElementById('employeeSelect');
const limitInfo = document.getElementById('limitInfo');
const maxDisplay = document.getElementById('maxAmountDisplay');
const inputAmount = document.getElementById('amount');
const form = document.getElementById('publicValeForm');
const btnSubmit = document.getElementById('btnSubmit');
const successMsg = document.getElementById('successMessage');

// 1. CARGA DE EMPLEADOS AL INICIAR
async function loadEmployees() {
    try {
        const q = query(collection(db, "employees"), orderBy("fullName"));
        const snapshot = await getDocs(q);
        
        if(selectEmp) {
            selectEmp.innerHTML = '<option value="">-- Selecciona tu nombre --</option>';
            snapshot.forEach(doc => {
                const data = doc.data();
                employeesList.push({ 
                    id: doc.id,
                    fullName: data.fullName || '',
                    branch: data.branch || '',
                    position: data.position || '',
                    salary: Number(data.salary) || 0 
                });
                
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.innerText = data.fullName;
                selectEmp.appendChild(opt);
            });
        }
    } catch (error) {
        console.error("Error cargando empleados:", error);
        if(selectEmp) selectEmp.innerHTML = '<option value="">Error de conexión</option>';
    }
}

// 2. DETECCIÓN DE CAMBIO DE EMPLEADO
if(selectEmp) {
    selectEmp.addEventListener('change', (e) => {
        const empId = e.target.value;
        const emp = employeesList.find(e => e.id === empId);

        if (emp) {
            currentSalary = emp.salary;
            maxLimit = currentSalary * 0.40; // Regla del 40%
            
            if(maxDisplay) maxDisplay.innerText = `Gs. ${maxLimit.toLocaleString()}`;
            
            if(limitInfo) {
                limitInfo.classList.remove('hidden');
                limitInfo.classList.add('fade-in');
            }
            
            validateAmount(); // Validar si ya escribió algo
        } else {
            if(limitInfo) limitInfo.classList.add('hidden');
            currentSalary = 0;
            maxLimit = 0;
        }
    });
}

// 3. VALIDACIÓN EN TIEMPO REAL
if(inputAmount) {
    inputAmount.addEventListener('input', validateAmount);
}

function validateAmount() {
    if(!inputAmount || !btnSubmit) return;
    const val = Number(inputAmount.value);
    
    // Si hay un límite definido y se supera
    if (val > maxLimit && maxLimit > 0) {
        inputAmount.classList.add('border-red-500', 'text-red-600', 'bg-red-50');
        inputAmount.classList.remove('border-slate-100', 'text-slate-700');
        
        btnSubmit.disabled = true;
        btnSubmit.classList.add('opacity-50', 'cursor-not-allowed');
        btnSubmit.innerHTML = `<i class="ph-bold ph-warning"></i> SUPERA EL LÍMITE (Gs. ${maxLimit.toLocaleString()})`;
    } else {
        inputAmount.classList.remove('border-red-500', 'text-red-600', 'bg-red-50');
        inputAmount.classList.add('border-slate-100', 'text-slate-700');
        
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
        btnSubmit.innerHTML = `<i class="ph-bold ph-paper-plane-right text-xl"></i> ENVIAR SOLICITUD`;
    }
}

// 4. ENVÍO DEL FORMULARIO
if(form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const empId = selectEmp.value;
        const amount = Number(inputAmount.value);
        const reason = document.getElementById('reason').value;
        const selectedEmployee = employeesList.find(e => e.id === empId);

        // Validaciones finales
        if (!empId || amount <= 0 || !reason) return alert("Por favor complete todos los campos.");
        if (amount > maxLimit) return alert("El monto supera el 40% de su salario.");
        if (!selectedEmployee || !selectedEmployee.fullName) return alert("No se pudo resolver el funcionario seleccionado.");

        // UI de carga
        const originalBtnHTML = btnSubmit.innerHTML;
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="ph ph-spinner animate-spin text-xl"></i> Procesando...';

        try {
            // *** PUNTO CLAVE *** // Usamos new Date() para asegurar que el vale tenga fecha legible inmediatamente
            // y no dependa de la sincronización del servidor para aparecer en el admin.
            await addDoc(collection(db, "vales"), {
                employeeId: empId,
                amount: amount,
                requestedAmount: amount,
                reason: reason,
                status: 'Pendiente', 
                employeeName: selectedEmployee.fullName || '',
                employeeNameUpper: selectedEmployee.fullName ? selectedEmployee.fullName.toUpperCase() : '',
                employeeBranch: selectedEmployee.branch || '',
                employeePosition: selectedEmployee.position || '',
                createdAt: new Date(),
                createdAtLocal: new Date().toISOString()
            });

            // Ocultar form y mostrar éxito
            form.classList.add('hidden');
            if(successMsg) {
                successMsg.classList.remove('hidden');
                successMsg.classList.add('fade-in');
            }

        } catch (error) {
            console.error("Error al enviar vale:", error);
            alert("Hubo un error al enviar la solicitud. Intente nuevamente.");
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnHTML;
        }
    });
}

// Iniciar
loadEmployees();
