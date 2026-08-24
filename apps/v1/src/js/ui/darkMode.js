// ========== SISTEMA DE MODO OSCURO ==========
// Aplicar modo oscuro inmediatamente al cargar la página (antes de renderizar)

(function() {
  // Ejecutar inmediatamente para aplicar clase al html y body antes de renderizar
  const modoOscuroGuardado = localStorage.getItem('modoOscuro');
  if (modoOscuroGuardado === 'true') {
    // Agregar clase dark-mode a HTML para evitar bordes blancos en iOS
    if (document.documentElement) {
      document.documentElement.classList.add('dark-mode');
    }
    if (document.body) {
      document.body.classList.add('dark-mode');
    }
  }
})();

// También escuchar el evento DOMContentLoaded como fallback
document.addEventListener('DOMContentLoaded', function() {
  const modoOscuroGuardado = localStorage.getItem('modoOscuro');
  if (modoOscuroGuardado === 'true') {
    document.documentElement.classList.add('dark-mode');
    document.body.classList.add('dark-mode');
  }
}, false);
