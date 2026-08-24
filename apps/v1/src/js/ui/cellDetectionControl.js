/**
 * cellDetectionControl.js - Control de detección de celdas en hover
 * Permite activar/desactivar la detección de celdas para optimizar rendimiento
 */

// Variable global para controlar si la detección de celdas está habilitada
window.cellDetectionEnabled = localStorage.getItem('cellDetectionEnabled') === 'true';

// Configurar el switch cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  const switchCellDetection = document.getElementById('switchCellDetection');
  const labelCellDetection = document.getElementById('labelCellDetection');

  if (!switchCellDetection) {
    console.warn('⚠️ Switch de detección de celdas no encontrado en el DOM');
    return;
  }

  // Establecer estado inicial del switch
  switchCellDetection.checked = window.cellDetectionEnabled;

  // Actualizar label según el estado
  function updateLabel(enabled) {
    if (enabled) {
      labelCellDetection.innerHTML = '🔢 Activador de Celdas (Activo)';
    } else {
      labelCellDetection.innerHTML = '🔢 Activador de Celdas (Desactivado)';
    }
  }

  updateLabel(window.cellDetectionEnabled);

  // Event listener para el switch
  switchCellDetection.addEventListener('change', function() {
    const enabled = this.checked;
    localStorage.setItem('cellDetectionEnabled', enabled);
    window.cellDetectionEnabled = enabled;

    updateLabel(enabled);

    console.log(`🔢 Detección de celdas en hover: ${enabled ? 'ACTIVADA' : 'DESACTIVADA'}`);

    if (enabled) {
      console.log('💡 El hover ahora mostrará: NOMBRE_CALLE : NUMERO_CELDA');
    } else {
      console.log('⚡ Rendimiento optimizado - El hover solo mostrará: NOMBRE_CALLE');
    }
  });

  // Inicializar tooltips de Bootstrap si están disponibles
  if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }
});

console.log('✓ cellDetectionControl.js cargado');
