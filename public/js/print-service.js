import { auth } from './firebase-config.js';

export function printTicket(data) {
    const user = auth.currentUser ? auth.currentUser.email : 'Sistema';
    const dateObj = new Date();
    const dateStr = dateObj.toLocaleDateString('es-PY');
    const timeStr = dateObj.toLocaleTimeString('es-PY');
    const paymentCode =
        typeof data.paymentCode === 'string' && data.paymentCode.trim() ? data.paymentCode.trim() : 'SIN-CODIGO';
    const employeeName =
        [data.employeeName, data.fullName, data.name].find((value) => typeof value === 'string' && value.trim()) || '';
    const employeePosition =
        [data.employeePosition, data.position, data.role].find((value) => typeof value === 'string' && value.trim()) ||
        '';
    const amount = Number(data.amount) || 0;
    const ejemplarAdmin = data.doubleTicket ? '<div class="ejemplar">EJEMPLAR ADMINISTRACION</div>' : '';

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
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }
                .title { font-size: 16px; font-weight: bold; margin: 10px 0; }
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
                .ejemplar { text-align: center; font-weight: bold; font-size: 12px; letter-spacing: 1px; border: 2px solid #000; padding: 2px 0; margin-bottom: 8px; }
            </style>
        </head>
        <body>
            ${ejemplarAdmin}
            <div class="text-center">
                <img src="logo.png" class="logo" onerror="this.style.display='none'"><br>
                <div class="title">COMPROBANTE DE PAGO</div>
                <div>${data.sucursal || 'CASA CENTRAL'}</div>
            </div>

            <div class="line"></div>

            <div class="detail-row"><span>FECHA:</span> <span>${dateStr} ${timeStr}</span></div>
            <div class="detail-row"><span>CODIGO:</span> <span>${paymentCode}</span></div>
            <div class="detail-row"><span>OPERADOR:</span> <span>${user.split('@')[0]}</span></div>

            <div class="line"></div>

            <div class="employee-box">
                <div class="employee-label">Funcionario Pagado</div>
                <div class="employee-name">${employeeName}</div>
                <div class="employee-role">${employeePosition}</div>
            </div>

            <div class="line"></div>

            <div class="text-center concept">${data.type}</div>
            ${data.detail ? `<div class="text-center" style="font-size:11px; margin-bottom:5px;">(${data.detail})</div>` : ''}

            <div class="line"></div>

            <div class="detail-row total">
                <span>TOTAL:</span>
                <span>Gs. ${amount.toLocaleString('es-PY')}</span>
            </div>

            <div class="line"></div>

            <div class="footer">
                <p>Firma del Funcionario</p>
                <br><br>
                __________________________
                <br>
                Documento de uso interno
            </div>

            ${
                data.doubleTicket
                    ? `
                <div style="page-break-before: always; margin-top: 20px; border-top: 2px dashed #000; padding-top: 15px;">
                    <div class="ejemplar">EJEMPLAR FUNCIONARIO</div>
                    <div class="text-center">
                        <img src="logo.png" class="logo" onerror="this.style.display='none'"><br>
                        <div class="title">COMPROBANTE DE PAGO</div>
                        <div>${data.sucursal || 'CASA CENTRAL'}</div>
                    </div>
                    <div class="line"></div>
                    <div class="detail-row"><span>FECHA:</span> <span>${dateStr} ${timeStr}</span></div>
                    <div class="detail-row"><span>CODIGO:</span> <span>${paymentCode}</span></div>
                    <div class="detail-row"><span>OPERADOR:</span> <span>${user.split('@')[0]}</span></div>
                    <div class="line"></div>
                    <div class="employee-box">
                        <div class="employee-label">Funcionario Pagado</div>
                        <div class="employee-name">${employeeName}</div>
                        <div class="employee-role">${employeePosition}</div>
                    </div>
                    <div class="line"></div>
                    <div class="text-center concept">${data.type}</div>
                    ${data.detail ? `<div class="text-center" style="font-size:11px; margin-bottom:5px;">(${data.detail})</div>` : ''}
                    <div class="line"></div>
                    <div class="detail-row total">
                        <span>TOTAL:</span>
                        <span>Gs. ${amount.toLocaleString('es-PY')}</span>
                    </div>
                    <div class="line"></div>
                    <div class="footer">
                        <p>Firma y Sello de Administracion</p>
                        <br><br>
                        __________________________
                        <br>
                        Ejemplar para el Funcionario - Guarde este comprobante
                    </div>
                </div>
            `
                    : ''
            }
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

        const finish = () => {
            cleanup();
            resolve();
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
