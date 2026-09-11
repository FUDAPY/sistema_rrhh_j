// public/js/auth-guard.js
// Exige sesion y rol antes de inicializar una pagina.

import { auth, onAuthStateChanged } from "./auth.js";
import { db, collection, getDocs } from "./db.js";

function showDenied(message) {
    document.body.innerHTML = `
        <div style="font-family:Inter,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;padding:24px;">
            <div style="background:#fff;border-radius:28px;padding:40px;max-width:420px;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,.35);">
                <div style="font-size:48px;">&#128274;</div>
                <h1 style="font-size:20px;font-weight:900;color:#0f172a;margin:16px 0 8px;">Acceso restringido</h1>
                <p style="color:#64748b;font-size:14px;font-weight:600;margin:0 0 24px;">${message}</p>
                <a href="index.html" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:800;padding:14px 28px;border-radius:16px;">Ir al inicio de sesion</a>
            </div>
        </div>`;
}

export function requireAuth({ roles = null, loginUrl = "index.html" } = {}) {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                window.location.href = loginUrl;
                reject(new Error("No autenticado"));
                return;
            }

            if (!roles) {
                resolve({ user, role: null });
                return;
            }

            try {
                const snapshot = await getDocs(collection(db, "users"));
                const email = (user.email || "").toLowerCase();
                const record = snapshot.docs
                    .map((d) => d.data())
                    .find((u) => (u.email || "").toLowerCase() === email);
                const role = record ? record.role : null;

                if (!role || !roles.includes(role)) {
                    showDenied("Tu usuario no tiene permisos para acceder a esta pagina. Contacta al administrador.");
                    reject(new Error("Sin permisos"));
                    return;
                }

                resolve({ user, role });
            } catch (error) {
                console.error("Error validando permisos:", error);
                showDenied("No se pudo validar tu acceso. Intenta nuevamente.");
                reject(error);
            }
        });
    });
}
