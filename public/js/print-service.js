// public/js/print-service.js
// Ticket de 80 mm. Por defecto imprime DOS ejemplares:
// "EJEMPLAR ADMINISTRACION" y "EJEMPLAR FUNCIONARIO".
import { auth } from './firebase-config.js';
import logoUrl from '../logo.png';

// Datos fijos de la empresa que deben figurar en el comprobante.
const COMPANY = {
    name: 'LIN GROUP',
    address: 'Av. Camilo Recalde c/ Av. Capitan Miranda',
    city: 'Microcentro de Ciudad del Este',
};

const UNKNOWN = 'SIN REGISTRAR';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pickText(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
}

// Fecha/hora del movimiento. En una reimpresion se respeta la original.
function resolvePaymentDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value && typeof value.toDate === 'function') {
        const parsed = value.toDate();
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
    }
    if (typeof value === 'number' || (typeof value === 'string' && value.trim())) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

// Nombre del funcionario que efectuo el pago (operador de la sesion activa).
function resolvePayerName(explicit) {
    const sessionUser = auth.currentUser;
    const sessionName = pickText(sessionUser?.displayName, sessionUser?.email ? sessionUser.email.split('@')[0] : '');
    return pickText(explicit, sessionName, UNKNOWN);
}

export function printTicket(data = {}) {
    const paymentCode = pickText(data.paymentCode) || 'SIN-CODIGO';
    const employeeName = pickText(data.employeeName, data.fullName, data.name);
    const employeeDni = pickText(data.employeeDni, data.dni, data.ci, data.documento, data.cedula);
    const employeePosition = pickText(data.employeePosition, data.position, data.role);
    const amount = Number(data.amount) || 0;
    const sucursal = pickText(data.sucursal, data.employeeBranch, data.branch) || 'CASA CENTRAL';
    const payerName = resolvePayerName(data.payerName);
    const dateObj = resolvePaymentDate(data.dateTime ?? data.createdAtLocal ?? data.createdAt ?? data.date);
    const dateStr = dateObj.toLocaleDateString('es-PY');
    const timeStr = dateObj.toLocaleTimeString('es-PY');
    const detail = pickText(data.detail);

    const copies = data.doubleTicket === false ? ['EJEMPLAR'] : ['EJEMPLAR ADMINISTRACION', 'EJEMPLAR FUNCIONARIO'];

    const buildCopy = (label) => `
        <section class="copy">
            <div class="ejemplar">${escapeHtml(label)}</div>
            <div class="text-center">
                <img src="${logoUrl}" class="logo" alt="${escapeHtml(COMPANY.name)}" onerror="this.style.display='none'">
                <div class="company">${escapeHtml(COMPANY.name)}</div>
                <div class="title">COMPROBANTE DE PAGO</div>
                <div class="small">${escapeHtml(COMPANY.address)}</div>
                <div class="small">${escapeHtml(COMPANY.city)}</div>
            </div>

            <div class="line"></div>

            <div class="detail-row"><span>FECHA:</span><span>${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span></div>
            <div class="detail-row"><span>CODIGO:</span><span>${escapeHtml(paymentCode)}</span></div>
            <div class="detail-row"><span>SUCURSAL:</span><span>${escapeHtml(sucursal)}</span></div>
            <div class="detail-row"><span>PAGO EFECTUADO POR:</span><span>${escapeHtml(payerName)}</span></div>

            <div class="line"></div>

            <div class="employee-box">
                <div class="employee-label">Funcionario</div>
                <div class="employee-name">${escapeHtml(employeeName || 'SIN DATOS')}</div>
                <div class="employee-role">C.I.: ${escapeHtml(employeeDni || 'S/D')}</div>
                ${employeePosition ? `<div class="employee-role">${escapeHtml(employeePosition)}</div>` : ''}
            </div>

            <div class="line"></div>

            <div class="text-center concept">${escapeHtml(pickText(data.type) || 'PAGO')}</div>
            ${detail ? `<div class="text-center small">(${escapeHtml(detail)})</div>` : ''}

            <div class="line"></div>

            <div class="detail-row total">
                <span>TOTAL:</span>
                <span>Gs. ${amount.toLocaleString('es-PY')}</span>
            </div>

            <div class="line"></div>

            <div class="footer">
                <div class="sign-label">Firma del Funcionario que recibe</div>
                <div class="sign-space"></div>
                <div class="sign-line"></div>
                <div class="sign-name">${escapeHtml(employeeName || '__________________________')}</div>
                <div class="sign-name">C.I.: ${escapeHtml(employeeDni || '____________')}</div>

                <div class="sign-gap"></div>

                <div class="sign-label">Firma del Funcionario que efectuo el pago</div>
                <div class="sign-space"></div>
                <div class="sign-line"></div>
                <div class="sign-name">${escapeHtml(payerName)}</div>
                <div class="sign-note">Ejemplar generado por el Sistema RRHH - LinGroup</div>
            </div>
        </section>
    `;

    const ticketHTML = `
        <html>
        <head>
            <style>
                @page { margin: 0; }
                body {
                    margin: 0;
                    padding: 10px;
                    font-family: 'Courier New', monospace;
                    width: 80mm;
                    font-size: 12px;
                    color: black;
                }
                .copy + .copy { page-break-before: always; border-top: 2px dashed #000; padding-top: 10px; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }
                .small { font-size: 10px; }
                .company { font-size: 14px; font-weight: bold; letter-spacing: 1px; }
                .title { font-size: 15px; font-weight: bold; margin: 6px 0 2px; }
                .line { border-bottom: 1px dashed #000; margin: 5px 0; }
                .logo { width: 60px; height: auto; margin-bottom: 5px; }
                .detail-row { display: flex; justify-content: space-between; margin-bottom: 3px; }
                .concept { font-size: 14px; font-weight: bold; margin: 10px 0; text-transform: uppercase; }
                .employee-box { border: 1px solid #000; padding: 6px; margin: 8px 0; }
                .employee-label { font-size: 10px; font-weight: bold; text-transform: uppercase; }
                .employee-name { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
                .employee-role { font-size: 10px; margin-top: 2px; }
                .total { font-size: 18px; font-weight: bold; margin-top: 5px; }
                .footer { font-size: 10px; margin-top: 15px; text-align: center; }
                .sign-label { font-weight: bold; text-transform: uppercase; font-size: 9px; margin-top: 6px; }
                .sign-space { height: 42px; }
                .sign-line { border-bottom: 1px solid #000; margin: 0 6px; }
                .sign-name { font-size: 10px; font-weight: bold; margin-top: 2px; text-transform: uppercase; }
                .sign-gap { height: 18px; }
                .sign-note { font-size: 9px; margin-top: 8px; }
                .ejemplar { text-align: center; font-weight: bold; font-size: 12px; letter-spacing: 1px; border: 2px solid #000; padding: 2px 0; margin-bottom: 8px; }
            </style>
        </head>
        <body>
            ${copies.map(buildCopy).join('')}
        </body>
        </html>
    `;

    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const cleanup = () => {
            if (iframe.parentNode) document.body.removeChild(iframe);
        };

        try {
            const printWindow = iframe.contentWindow;
            const doc = printWindow.document;

            doc.open();
            doc.write(ticketHTML);
            doc.close();

            const images = Array.from(doc.images || []);
            const waitForAssets = Promise.all(
                images.map((img) => {
                    if (img.complete) return Promise.resolve();
                    return new Promise((assetReady) => {
                        img.onload = assetReady;
                        img.onerror = assetReady;
                    });
                })
            );

            waitForAssets
                .then(() => {
                    setTimeout(() => {
                        try {
                            printWindow.focus();
                            printWindow.print();
                            setTimeout(cleanup, 2000);
                        } catch (error) {
                            console.error('Error de impresion:', error);
                            cleanup();
                        }
                    }, 100);
                    resolve();
                })
                .catch((error) => {
                    console.error('Error cargando recursos de impresion:', error);
                    cleanup();
                    resolve();
                });
        } catch (error) {
            console.error('Error preparando impresion:', error);
            cleanup();
            resolve();
        }
    });
}
