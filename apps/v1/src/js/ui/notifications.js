/**
 * notifications.js - Sistema de notificaciones con Bootstrap Toasts
 * Proporciona feedback visual al usuario mediante toasts
 */

/**
 * Muestra una notificación toast
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

    // Convertir saltos de línea a <br> para el mensaje
    const mensajeHTML = mensaje.replace(/\n/g, '<br>');

    // Crear el HTML del toast
    const toastHTML = `
        <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="${duracion}">
            <div class="toast-header ${cfg.bgClass} ${cfg.textClass}">
                <strong class="me-auto">
                    <span class="me-2">${cfg.icon}</span>${titulo}
                </strong>
                <button type="button" class="btn-close ${cfg.textClass === 'text-white' ? 'btn-close-white' : ''}" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${mensajeHTML}
            </div>
        </div>
    `;

    // Insertar el toast en el contenedor
    toastContainer.insertAdjacentHTML('beforeend', toastHTML);

    // Obtener el elemento del toast
    const toastElement = document.getElementById(toastId);

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
 * Sobrescribir alert() nativo para usar toasts Bootstrap
 * Mantiene una referencia al alert() original por si se necesita
 */
window.alertOriginal = window.alert;

window.alert = (mensaje) => {
    // Determinar el tipo de notificación basado en el mensaje
    let tipo = 'info';
    let titulo = 'Notificación';

    if (mensaje.includes('✅') || mensaje.includes('exitosa') || mensaje.includes('exitosamente') || mensaje.includes('guardad')) {
        tipo = 'success';
        titulo = 'Éxito';
    } else if (mensaje.includes('❌') || mensaje.includes('Error') || mensaje.includes('error')) {
        tipo = 'error';
        titulo = 'Error';
    } else if (mensaje.includes('⚠️') || mensaje.includes('Advertencia') || mensaje.includes('advertencia')) {
        tipo = 'warning';
        titulo = 'Advertencia';
    }

    // Limpiar emojis del título si ya están en el mensaje
    const mensajeLimpio = mensaje.replace(/^(✅|❌|⚠️|ℹ️)\s*/, '');

    // Mostrar como toast
    mostrarNotificacion(tipo, titulo, mensajeLimpio, 5000);
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
    // Opciones por defecto
    const config = {
        btnConfirmText: opciones.btnConfirmText || 'Confirmar',
        btnConfirmClass: opciones.btnConfirmClass || 'btn-danger',
        btnCancelText: opciones.btnCancelText || 'Cancelar',
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
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
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
        btnCancel.addEventListener('click', () => {
            btnCancel.blur();
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
