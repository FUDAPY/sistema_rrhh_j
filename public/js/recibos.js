// js/recibos.js

export function printSalaryReceipt(paymentData) {
    // 1. Configuración de datos
    const today = new Date().toLocaleDateString('es-PY');
    const period = `${paymentData.month}/${new Date().getFullYear()}`;
    const fmt = (n) => parseInt(n).toLocaleString('es-PY');

    // Formatear fecha de ingreso si existe
    let ingresoStr = '-';
    if(paymentData.employeeStartDate) {
        // Intentamos convertir si viene como string YYYY-MM-DD
        const [y, m, d] = paymentData.employeeStartDate.split('-');
        if(d && m && y) ingresoStr = `${d}/${m}/${y}`;
        else ingresoStr = paymentData.employeeStartDate;
    }

    // 2. Diseño del Recibo
    const getReceiptHTML = (copyType) => `
        <div class="receipt-box">
            <div class="header">
                <div class="company-info">
                    <h1>LINGROUP S.A.</h1>
                    <p><strong>RUC: 80084570-6</strong></p>
                    <p>Liquidación de Salario</p>
                </div>
                <div class="date-info">
                    <p><strong>Periodo:</strong> ${period}</p>
                    <p><strong>Fecha Pago:</strong> ${today}</p>
                    <p class="copy-label">${copyType}</p>
                </div>
            </div>

            <div class="employee-info">
                <p><strong>Funcionario:</strong> ${paymentData.employeeName}</p>
                <div style="display: flex; justify-content: space-between;">
                    <span><strong>C.I. Nro:</strong> ${paymentData.employeeCI || '-'}</span>
                    <span><strong>Fecha Ingreso:</strong> ${ingresoStr}</span>
                </div>
            </div>

            <table class="details-table">
                <thead>
                    <tr>
                        <th>Concepto</th>
                        <th class="text-right">Haberes (+)</th>
                        <th class="text-right">Descuentos (-)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Sueldo Base</td>
                        <td class="text-right">${fmt(paymentData.baseSalary)}</td>
                        <td></td>
                    </tr>
                    ${paymentData.totalBonuses > 0 ? `
                    <tr>
                        <td>Comisiones / Bonos</td>
                        <td class="text-right">${fmt(paymentData.totalBonuses)}</td>
                        <td></td>
                    </tr>` : ''}
                    ${paymentData.totalDiscounts > 0 ? `
                    <tr>
                        <td>Anticipos / Vales</td>
                        <td></td>
                        <td class="text-right">${fmt(paymentData.totalDiscounts)}</td>
                    </tr>` : ''}
                    <tr style="height: 30px;"><td></td><td></td><td></td></tr>
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td>NETO A COBRAR</td>
                        <td colspan="2" class="text-right">Gs. ${fmt(paymentData.netPay)}</td>
                    </tr>
                </tfoot>
            </table>

            <div class="signatures">
                <div class="sig-block">
                    <div class="line"></div>
                    <p>Firma de la Empresa</p>
                </div>
                <div class="sig-block">
                    <div class="line"></div>
                    <p>Firma del Funcionario</p>
                    <p class="small">Recibí conforme</p>
                </div>
            </div>
        </div>
    `;

    // 3. Armado de la Página
    const fullPageHTML = `
        <html>
        <head>
            <title>Recibo_${paymentData.employeeName}</title>
            <style>
                body { font-family: 'Courier New', Courier, monospace; padding: 20px; max-width: 800px; margin: 0 auto; }
                .receipt-box { border: 2px solid #000; padding: 20px; margin-bottom: 20px; }
                .header { display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                .company-info h1 { margin: 0; font-size: 18px; }
                .company-info p { margin: 2px 0; font-size: 12px; }
                .date-info { text-align: right; font-size: 12px; }
                .copy-label { font-weight: bold; text-transform: uppercase; border: 1px solid #000; padding: 2px 5px; display: inline-block; margin-top: 5px; }
                .employee-info { margin-bottom: 15px; font-size: 14px; }
                .details-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
                .details-table th { border-bottom: 1px solid #000; text-align: left; padding: 5px; }
                .details-table td { padding: 5px; }
                .text-right { text-align: right; }
                .total-row { font-weight: bold; font-size: 16px; border-top: 2px solid #000; }
                .total-row td { padding-top: 10px; }
                .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
                .sig-block { width: 40%; text-align: center; font-size: 12px; }
                .line { border-top: 1px solid #000; margin-bottom: 5px; }
                .cut-line { border-top: 2px dashed #999; margin: 30px 0; position: relative; text-align: center; }
                .cut-line::after { content: '✂ Cortar aquí'; background: #fff; padding: 0 10px; position: relative; top: -10px; color: #666; font-size: 12px; }
                @media print {
                    @page { margin: 0.5cm; size: A4; }
                    body { -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            ${getReceiptHTML('Original: Archivo RRHH')}
            <div class="cut-line"></div>
            ${getReceiptHTML('Duplicado: Funcionario')}
            <script>window.onload = function() { window.print(); }</script>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank', 'width=900,height=800');
    printWindow.document.write(fullPageHTML);
    printWindow.document.close();
}