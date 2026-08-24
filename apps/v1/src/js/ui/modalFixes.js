// ========== FIX PARA WARNING DE ARIA-HIDDEN EN MODALES ==========
document.addEventListener('DOMContentLoaded', function() {
  // Obtener todos los modales
  const modals = document.querySelectorAll('.modal');

  modals.forEach(modal => {
    // Antes de que el modal se oculte, remover el foco de cualquier elemento dentro del modal
    modal.addEventListener('hide.bs.modal', function(event) {
      // Buscar el elemento que tiene el foco actualmente en todo el documento
      const activeElement = document.activeElement;

      // Verificar si el elemento con foco está dentro del modal o es el modal mismo
      if (activeElement && (modal.contains(activeElement) || activeElement === modal)) {
        // Remover el foco del elemento
        activeElement.blur();

        // Asegurar que el foco vuelva al body como respaldo
        setTimeout(() => {
          if (document.body && typeof document.body.focus === 'function') {
            document.body.focus();
          }
        }, 0);
      }

      // Remover explícitamente el atributo tabindex del modal durante el cierre
      modal.removeAttribute('tabindex');
    });

    // Cuando el modal se cierra completamente, restaurar el tabindex
    modal.addEventListener('hidden.bs.modal', function(event) {
      // Restaurar el tabindex después de que el modal se haya cerrado completamente
      modal.setAttribute('tabindex', '-1');
    });

    // Opcional: Cuando el modal se muestre, enfocar el botón de cerrar o el primer input
    modal.addEventListener('shown.bs.modal', function(event) {
      // Buscar el primer input o textarea que no esté deshabilitado
      const firstInput = modal.querySelector('input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])');

      if (firstInput) {
        // Pequeño delay para asegurar que el modal esté completamente renderizado
        setTimeout(() => firstInput.focus(), 100);
      }
    });
  });

  console.log(`✓ ${modals.length} modales configurados para evitar warning de aria-hidden`);
});
