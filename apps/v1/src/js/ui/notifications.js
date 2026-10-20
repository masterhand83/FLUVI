/**
 * notifications.js - Sistema de notificaciones con Bootstrap Toasts
 * Proporciona feedback visual al usuario mediante toasts.
 *
 * Las rutas migradas usan `fluviNotify` con claves de catálogo y una severidad
 * explícita. Las funciones heredadas siguen funcionando para llamadas que aún
 * no se han migrado.
 */

function notificationTitle(tipo) {
    switch (tipo) {
        case 'success':
            return tr('notifications.title.success');
        case 'error':
            return tr('notifications.title.error');
        case 'warning':
            return tr('notifications.title.warning');
        default:
            return tr('notifications.title.info');
    }
}

/**
 * Muestra una notificación toast.
 * El título y el mensaje se asignan como texto, nunca como HTML: los nombres y
 * números interpolados se conservan literalmente y no pueden inyectar marcado.
 * @param {string} tipo - Tipo de notificación: 'success', 'error', 'warning', 'info'
 * @param {string} titulo - Título de la notificación
 * @param {string} mensaje - Mensaje descriptivo
 * @param {number} duracion - Duración en milisegundos (por defecto 5000)
 */
function mostrarNotificacion(tipo, titulo, mensaje, duracion = 5000) {
    // Obtener o crear el contenedor de toasts
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '11000';
        document.body.appendChild(toastContainer);
    }

    // Configuración de iconos y colores según el tipo
    const config = {
        success: {
            icon: '✅',
            bgClass: 'bg-success',
            textClass: 'text-white'
        },
        error: {
            icon: '❌',
            bgClass: 'bg-danger',
            textClass: 'text-white'
        },
        warning: {
            icon: '⚠️',
            bgClass: 'bg-warning',
            textClass: 'text-dark'
        },
        info: {
            icon: 'ℹ️',
            bgClass: 'bg-info',
            textClass: 'text-white'
        }
    };

    const cfg = config[tipo] || config.info;

    // Crear ID único para el toast
    const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const toastElement = document.createElement('div');
    toastElement.id = toastId;
    toastElement.className = 'toast';
    toastElement.setAttribute('role', 'alert');
    toastElement.setAttribute('aria-live', 'assertive');
    toastElement.setAttribute('aria-atomic', 'true');
    toastElement.dataset.bsDelay = String(duracion);

    const header = document.createElement('div');
    header.className = `toast-header ${cfg.bgClass} ${cfg.textClass}`;

    const title = document.createElement('strong');
    title.className = 'me-auto';
    const icon = document.createElement('span');
    icon.className = 'me-2';
    icon.textContent = cfg.icon;
    title.append(icon, document.createTextNode(String(titulo)));

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = `btn-close ${cfg.textClass === 'text-white' ? 'btn-close-white' : ''}`;
    closeButton.dataset.bsDismiss = 'toast';
    closeButton.setAttribute('aria-label', tr('common.close'));

    const body = document.createElement('div');
    body.className = 'toast-body';
    body.style.whiteSpace = 'pre-line';
    body.textContent = String(mensaje);

    header.append(title, closeButton);
    toastElement.append(header, body);
    toastContainer.append(toastElement);

    // Inicializar y mostrar el toast con Bootstrap
    const toast = new bootstrap.Toast(toastElement, {
        autohide: true,
        delay: duracion
    });

    toast.show();

    // Eliminar el toast del DOM después de que se oculte
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });

    // Log en consola (si los logs están habilitados)
    if (window.CONSOLE_LOGS_ENABLED) {
        console.log(`📢 Notificación [${tipo}]: ${titulo} - ${mensaje}`);
    }
    return toastElement;
}

/**
 * Funciones de ayuda para tipos específicos de notificaciones
 */
function mostrarExito(titulo, mensaje, duracion) {
    mostrarNotificacion('success', titulo, mensaje, duracion);
}

function mostrarError(titulo, mensaje, duracion) {
    mostrarNotificacion('error', titulo, mensaje, duracion);
}

function mostrarAdvertencia(titulo, mensaje, duracion) {
    mostrarNotificacion('warning', titulo, mensaje, duracion);
}

function mostrarInfo(titulo, mensaje, duracion) {
    mostrarNotificacion('info', titulo, mensaje, duracion);
}

/**
 * Notificaciones migradas: severidad explícita y mensaje desde catálogo.
 */
function keyedNotification(tipo, key, params, duracion) {
    return mostrarNotificacion(tipo, notificationTitle(tipo), tr(key, params), duracion);
}

window.fluviNotify = Object.freeze({
    success: (key, params, duracion) => keyedNotification('success', key, params, duracion),
    error: (key, params, duracion) => keyedNotification('error', key, params, duracion),
    warning: (key, params, duracion) => keyedNotification('warning', key, params, duracion),
    info: (key, params, duracion) => keyedNotification('info', key, params, duracion)
});

/**
 * Sobrescribir alert() nativo para usar toasts Bootstrap
 * Mantiene una referencia al alert() original por si se necesita
 */
window.alertOriginal = window.alert;

window.alert = (mensaje) => {
    // Determinar el tipo de notificación basado en el mensaje
    let tipo = 'info';

    if (mensaje.includes('✅') || mensaje.includes('exitosa') || mensaje.includes('exitosamente') || mensaje.includes('guardad')) {
        tipo = 'success';
    } else if (mensaje.includes('❌') || mensaje.includes('Error') || mensaje.includes('error')) {
        tipo = 'error';
    } else if (mensaje.includes('⚠️') || mensaje.includes('Advertencia') || mensaje.includes('advertencia')) {
        tipo = 'warning';
    }

    // Limpiar emojis del título si ya están en el mensaje
    const mensajeLimpio = mensaje.replace(/^(✅|❌|⚠️|ℹ️)\s*/, '');

    // Mostrar como toast
    mostrarNotificacion(tipo, notificationTitle(tipo), mensajeLimpio, 5000);
};

/**
 * Muestra un modal de confirmación con Bootstrap
 * @param {string} titulo - Título del modal
 * @param {string} mensaje - Mensaje de confirmación
 * @param {Function} onConfirm - Callback a ejecutar si el usuario confirma
 * @param {Function} onCancel - Callback opcional a ejecutar si el usuario cancela
 * @param {Object} opciones - Opciones adicionales { btnConfirmText, btnConfirmClass, btnCancelText }
 */
function mostrarConfirmacion(titulo, mensaje, onConfirm, onCancel = null, opciones = {}) {
    // Opciones por defecto, traducidas al idioma de la sesión activa
    const config = {
        btnConfirmText: opciones.btnConfirmText || tr('common.confirm'),
        btnConfirmClass: opciones.btnConfirmClass || 'btn-danger',
        btnCancelText: opciones.btnCancelText || tr('common.cancel'),
        btnCancelClass: opciones.btnCancelClass || 'btn-secondary'
    };

    // Crear ID único para el modal
    const modalId = `modal-confirm-${Date.now()}`;

    // Crear el HTML del modal
    const modalHTML = `
        <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Label" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="${modalId}Label">${titulo}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${tr('common.close')}"></button>
                    </div>
                    <div class="modal-body">
                        ${mensaje}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn ${config.btnCancelClass}" data-bs-dismiss="modal">
                            ${config.btnCancelText}
                        </button>
                        <button type="button" class="btn ${config.btnConfirmClass}" id="${modalId}-confirm">
                            ${config.btnConfirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Insertar el modal en el body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Obtener el elemento del modal
    const modalElement = document.getElementById(modalId);
    const btnConfirm = document.getElementById(`${modalId}-confirm`);
    const btnCancel = modalElement.querySelector('[data-bs-dismiss="modal"]');

    // Inicializar el modal de Bootstrap
    const modal = new bootstrap.Modal(modalElement, {
        backdrop: 'static', // No cerrar al hacer clic fuera
        keyboard: true // Permitir cerrar con ESC
    });

    // Event listener para el botón de cancelar (quitar foco antes de cerrar)
    if (btnCancel) {
        btnCancel.addEventListener('click', (event) => {
            event.preventDefault();
            btnCancel.blur();
            modal.hide();
        });
    }

    // Variable para rastrear si se confirmó
    let wasConfirmed = false;

    // Event listener para el botón de confirmar
    btnConfirm.addEventListener('click', () => {
        wasConfirmed = true;
        btnConfirm.disabled = true; // Deshabilitar para evitar múltiples clics

        // Quitar el foco del botón antes de cerrar
        btnConfirm.blur();

        modal.hide();

        // Ejecutar callback después de un pequeño delay para evitar problemas de enfoque
        setTimeout(() => {
            if (onConfirm && typeof onConfirm === 'function') {
                onConfirm();
            }
        }, 150);
    });

    // Event listener para cuando se oculte el modal
    modalElement.addEventListener('hidden.bs.modal', () => {
        // Si se cerró sin confirmar, ejecutar callback de cancelar
        if (!wasConfirmed && onCancel && typeof onCancel === 'function') {
            onCancel();
        }

        // Eliminar el modal del DOM después de que Bootstrap termine el proceso
        setTimeout(() => {
            // Destruir la instancia del modal
            modal.dispose();
            // Eliminar el elemento del DOM
            modalElement.remove();
            // Limpiar el backdrop si quedó alguno
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }
            // Restaurar scroll del body
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }, 200);
    });

    // Mostrar el modal
    modal.show();
}

// Exponer funciones globalmente
window.mostrarNotificacion = mostrarNotificacion;
window.mostrarExito = mostrarExito;
window.mostrarError = mostrarError;
window.mostrarAdvertencia = mostrarAdvertencia;
window.mostrarInfo = mostrarInfo;
window.mostrarConfirmacion = mostrarConfirmacion;

console.log('✅ Sistema de notificaciones cargado (alert() sobrescrito con toasts Bootstrap)');
