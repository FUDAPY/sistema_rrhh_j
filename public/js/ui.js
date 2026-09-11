// public/js/ui.js
// Toasts y modales propios (reemplazan alert/confirm/prompt).

const TONES = {
    info: { accent: 'border-blue-600', chip: 'bg-blue-50 text-blue-600', icon: 'ph-info', button: 'bg-blue-600 hover:bg-blue-700' },
    success: { accent: 'border-emerald-500', chip: 'bg-emerald-50 text-emerald-600', icon: 'ph-check-circle', button: 'bg-emerald-600 hover:bg-emerald-700' },
    warning: { accent: 'border-amber-500', chip: 'bg-amber-50 text-amber-600', icon: 'ph-warning-circle', button: 'bg-amber-600 hover:bg-amber-700' },
    danger: { accent: 'border-rose-500', chip: 'bg-rose-50 text-rose-600', icon: 'ph-warning', button: 'bg-rose-600 hover:bg-rose-700' },
};

function toneOf(type) {
    return TONES[type] || TONES.info;
}

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Toast
let toastHost = null;

function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.id = 'uiToastHost';
    toastHost.className = 'fixed top-6 right-4 sm:right-6 z-[200] flex flex-col gap-3 items-end';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
    return toastHost;
}

export function uiToast(message, type = 'info', title = '') {
    const host = ensureToastHost();
    const tone = toneOf(type);
    const el = document.createElement('div');
    el.className = `bg-white border-l-[6px] ${tone.accent} shadow-2xl rounded-2xl p-4 flex items-center gap-3 w-[min(92vw,360px)] animate-toast-in`;
    el.innerHTML = `
        <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone.chip}"><i class="ph-fill ph-${tone.icon} text-lg"></i></div>
        <div class="min-w-0">
            ${title ? `<p class="font-black text-slate-800 text-xs uppercase tracking-wide truncate">${escapeHtml(title)}</p>` : ''}
            <p class="text-[11px] text-slate-500 font-bold break-words whitespace-pre-line">${escapeHtml(message)}</p>
        </div>`;
    host.appendChild(el);
    setTimeout(() => {
        el.style.transition = 'opacity .25s ease, transform .25s ease';
        el.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => el.remove(), 280);
    }, 4200);
}

// Modal
function openModal({ tone = 'info', title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', withCancel = true, input = null, inputType = 'text' }) {
    return new Promise((resolve) => {
        const palette = toneOf(tone);
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4';
        overlay.innerHTML = `
            <div class="bg-white w-full max-w-md rounded-[28px] shadow-2xl border border-slate-100 overflow-hidden animate-fade-in-up" role="dialog" aria-modal="true">
                <div class="p-6 flex items-start gap-4">
                    <div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-xl ${palette.chip}"><i class="ph-fill ph-${palette.icon}"></i></div>
                    <div class="min-w-0 flex-1">
                        <h3 class="font-black text-slate-800 text-lg leading-tight">${escapeHtml(title)}</h3>
                        ${message ? `<p class="text-sm text-slate-500 font-medium mt-1 whitespace-pre-line">${escapeHtml(message)}</p>` : ''}
                        ${input ? `<input id="uiModalInput" type="${inputType}" class="mt-4 w-full border-2 border-slate-100 p-3.5 rounded-2xl bg-slate-50 font-bold text-slate-700 outline-none focus:border-blue-500">` : ''}
                    </div>
                </div>
                <div class="px-6 pb-6 flex gap-3">
                    ${withCancel ? `<button data-role="cancel" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3.5 rounded-2xl transition-colors">${escapeHtml(cancelText)}</button>` : ''}
                    <button data-role="confirm" class="${palette.button} flex-1 text-white font-black py-3.5 rounded-2xl shadow-lg transition-colors">${escapeHtml(confirmText)}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const inputEl = overlay.querySelector('#uiModalInput');
        const confirmBtn = overlay.querySelector('[data-role="confirm"]');
        if (inputEl) {
            inputEl.value = input.value ?? '';
            setTimeout(() => {
                inputEl.focus();
                inputEl.select?.();
            }, 30);
        } else {
            setTimeout(() => confirmBtn?.focus(), 30);
        }

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') close(null);
            else if (event.key === 'Enter' && input && document.activeElement === inputEl) close(inputEl.value);
        };

        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(null);
        });
        overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', () => close(null));
        confirmBtn?.addEventListener('click', () => close(input ? inputEl.value : true));
    });
}

// API
export async function uiConfirm(options = {}) {
    const result = await openModal({
        tone: options.tone || 'danger',
        title: options.title || 'Confirmar accion',
        message: options.message,
        confirmText: options.confirmText || 'Confirmar',
        cancelText: options.cancelText || 'Cancelar',
        withCancel: true,
        input: options.input || null,
        inputType: options.inputType,
    });
    return result === true;
}

export async function uiPrompt(options = {}) {
    const result = await openModal({
        tone: options.tone || 'info',
        title: options.title || 'Ingrese un valor',
        message: options.message,
        confirmText: options.confirmText || 'Aceptar',
        cancelText: options.cancelText || 'Cancelar',
        withCancel: true,
        input: { value: options.defaultValue ?? '' },
        inputType: options.inputType || 'text',
    });
    return typeof result === 'string' ? result : null;
}

export async function uiAlert(options = {}) {
    const opts = typeof options === 'string' ? { message: options } : options;
    await openModal({
        tone: opts.tone || 'info',
        title: opts.title || 'Aviso',
        message: opts.message,
        confirmText: opts.confirmText || 'Entendido',
        withCancel: false,
    });
}

