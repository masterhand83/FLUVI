// ========== SISTEMA DE CONTROL DE LOGS DE CONSOLA ==========
// Guardar referencias originales de los métodos de console
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
  trace: console.trace,
  table: console.table,
  group: console.group,
  groupEnd: console.groupEnd,
  groupCollapsed: console.groupCollapsed
};

// Filtrar mensajes de Tracking Prevention del navegador
const filterTrackingPrevention = (method) => {
  return function(...args) {
    const message = args[0]?.toString() || '';
    // Silenciar advertencias de Tracking Prevention (Edge/Safari)
    if (message.includes('Tracking Prevention blocked access to storage')) {
      return; // No mostrar estos mensajes
    }
    // Ejecutar el método original para otros mensajes
    originalConsole[method].apply(console, args);
  };
};

// Aplicar filtro siempre (independiente del switch de console)
console.error = filterTrackingPrevention('error');
console.warn = filterTrackingPrevention('warn');

// Función para deshabilitar logs de consola
function disableConsoleLogs() {
  console.log = function() {};
  console.warn = function() {};
  console.error = function() {};
  console.info = function() {};
  console.debug = function() {};
  console.trace = function() {};
  console.table = function() {};
  console.group = function() {};
  console.groupEnd = function() {};
  console.groupCollapsed = function() {};
}

// Función para habilitar logs de consola
function enableConsoleLogs() {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
  console.trace = originalConsole.trace;
  console.table = originalConsole.table;
  console.group = originalConsole.group;
  console.groupEnd = originalConsole.groupEnd;
  console.groupCollapsed = originalConsole.groupCollapsed;
}

// Inicializar: Por defecto los logs están DESHABILITADOS
const consoleLogsEnabled = localStorage.getItem('consoleLogsEnabled') === 'true';
if (!consoleLogsEnabled) {
  disableConsoleLogs();
}

// Configurar el switch cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  const switchConsoleLogs = document.getElementById('switchConsoleLogs');
  const labelConsoleLogs = document.getElementById('labelConsoleLogs');

  // Establecer estado inicial del switch
  switchConsoleLogs.checked = consoleLogsEnabled;

  // Actualizar label según el estado
  function updateLabel(enabled) {
    if (enabled) {
      labelConsoleLogs.innerHTML = '📝 Mostrar Logs en Consola';
      labelConsoleLogs.style.color = '#28a745';
    } else {
      labelConsoleLogs.innerHTML = '🚫 Ocultar Logs en Consola';
      labelConsoleLogs.style.color = '#6c757d';
    }
  }

  updateLabel(consoleLogsEnabled);

  // Event listener para el switch
  switchConsoleLogs.addEventListener('change', function() {
    const enabled = this.checked;
    localStorage.setItem('consoleLogsEnabled', enabled);

    if (enabled) {
      enableConsoleLogs();
      console.log('✅ Logs de consola HABILITADOS');
    } else {
      console.log('🚫 Logs de consola DESHABILITADOS');
      disableConsoleLogs();
    }

    updateLabel(enabled);
  });
});
