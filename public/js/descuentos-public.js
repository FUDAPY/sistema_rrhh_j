import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// Elementos
const searchInput = document.getElementById('searchEmp');
const empList = document.getElementById('empList');
const selectedIdInput = document.getElementById('selectedEmpId');
const amountInput = document.getElementById('amountDisplay');
const dateInput = document.getElementById('descDate'); // Nuevo elemento
const form = document.getElementById('publicDescForm');
const btnSubmit = document.getElementById('btnSubmit');

let employees = []; 

// --- NUEVO: PONER FECHA DE HOY POR DEFECTO ---
function setDefaultDate() {
    const now = new Date();
    const day = ("0" + now.getDate()).slice(-2);
    const month = ("0" + (now.getMonth() + 1)).slice(-2);
    const today = now.getFullYear() + "-" + month + "-" + day;
    if (dateInput) dateInput.value = today;
}

// 1. CARGAR EMPLEADOS
async function loadEmployees() {
    try {
        const q = query(collection(db, "employees"), orderBy("fullName"));
        const snapshot = await getDocs(q);
        employees = [];
        snapshot.forEach(doc => {
            employees.push({ id: doc.id, name: doc.data().fullName });
        });
    } catch (error) {
        console.error("Error loading employees", error);
    }
}

// 2. BUSCADOR INTELIGENTE
searchInput.addEventListener('input', (e) => {
    const text = e.target.value.toLowerCase();
    empList.innerHTML = '';
    
    if (text.length === 0) {
        empList.classList.add('hidden');
        return;
    }

    const matches = employees.filter(emp => emp.name.toLowerCase().includes(text));

    if (matches.length > 0) {
        empList.classList.remove('hidden');
        matches.forEach(emp => {
            const div = document.createElement('div');
            div.className = "p-3 hover:bg-red-50 cursor-pointer text-sm font-bold text-slate-700 border-b border-slate-50 last:border-0";
            div.innerText = emp.name;
            div.onclick = () => {
                searchInput.value = emp.name;
                selectedIdInput.value = emp.id;
                empList.classList.add('hidden');
            };
            empList.appendChild(div);
        });
    } else {
        empList.classList.add('hidden');
    }
});

document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !empList.contains(e.target)) {
        empList.classList.add('hidden');
    }
});

// 3. FORMATO DE MILES
amountInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    value = new Intl.NumberFormat('es-PY').format(value);
    if(value === '0') value = '';
    e.target.value = value;
});

// 4. GUARDAR
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const empId = selectedIdInput.value;
    const reason = document.getElementById('reasonType').value;
    const selectedDate = dateInput.value; // Capturamos la fecha del calendario
    const rawAmount = amountInput.value.replace(/\./g, ''); 
    const amount = Number(rawAmount);

    if (!empId) return alert("Selecciona un funcionario de la lista.");
    if (!amount || amount <= 0) return alert("Ingresa un monto válido.");
    if (!selectedDate) return alert("Selecciona una fecha válida.");

    const originalBtn = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Guardando...";

    try {
        await addDoc(collection(db, "descuentos"), {
            employeeId: empId,
            amount: amount,
            reason: reason,
            date: selectedDate, // Guardamos la fecha elegida (YYYY-MM-DD)
            status: 'Aplicado',
            createdAt: serverTimestamp() // Fecha real de cuando se creó el registro
        });

        form.classList.add('hidden');
        document.getElementById('successMessage').classList.remove('hidden');

    } catch (error) {
        console.error("Error:", error);
        alert("Error al guardar.");
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtn;
    }
});

// Iniciar
loadEmployees();
setDefaultDate();