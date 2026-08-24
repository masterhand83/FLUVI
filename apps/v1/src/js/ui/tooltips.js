// ========== SISTEMA DE TOOLTIPS (Bootstrap) ==========
// Inicializar todos los tooltips cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  // Obtener todos los elementos con data-bs-toggle="tooltip"
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');

  // Inicializar cada tooltip
  const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => {
    return new bootstrap.Tooltip(tooltipTriggerEl, {
      trigger: 'hover focus', // Mostrar al pasar el mouse o enfocar
      delay: { show: 300, hide: 100 } // Pequeño delay para evitar tooltips molestos
    });
  });

  console.log(`✓ ${tooltipList.length} tooltips inicializados correctamente`);
});
