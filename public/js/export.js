// public/js/export.js
// Exportacion a CSV (separador ";" y BOM UTF-8 para Excel).

function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    text = text.replace(/"/g, '""');
    if (/[",;\n\r]/.test(text)) text = `"${text}"`;
    return text;
}

// columns: [{ label, value: (row) => any }]
export function toCsv(columns, rows = []) {
    const header = columns.map((col) => csvCell(col.label)).join(';');
    const body = rows
        .map((row) => columns.map((col) => csvCell(typeof col.value === 'function' ? col.value(row) : row[col.value])).join(';'))
        .join('\r\n');
    return `${header}\r\n${body}`;
}

export function downloadCsv(filename, columns, rows = []) {
    const csv = toCsv(columns, rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Marca de tiempo para el nombre del archivo: 2026-09-10
export function dateStamp(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

// Formatea un valor de fecha (Timestamp del backend, Date o string YYYY-MM-DD)
export function toDateString(value) {
    if (!value) return '';
    if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
    return '';
}

// Boton de exportacion reutilizable (HTML)
export function exportButton(onclick, label = 'EXPORTAR CSV') {
    return `<button type="button" onclick="${onclick}" class="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-black text-[11px] uppercase tracking-wider px-4 py-3 rounded-2xl shadow-sm transition-colors">
        <i class="ph-bold ph-download-simple text-base"></i> ${label}
    </button>`;
}
