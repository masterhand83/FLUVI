// ========== SISTEMA DE CARGA ==========
(function() {
  const loadingScreen = document.getElementById('loadingScreen');
  const progressFill = document.getElementById('progressFill');
  const loadingStatus = document.getElementById('loadingStatus');

  let progress = 0;
  const statusMessages = [
    'Inicializando recursos...',
    'Cargando librerías...',
    'Preparando canvas...',
    'Generando calles...',
    'Calculando intersecciones...',
    'Creando conexiones...',
    'Iniciando simulación...',
    'Listo!'
  ];

  let messageIndex = 0;

  // Simular progreso de carga
  const progressInterval = setInterval(() => {
    progress += Math.random() * 15;

    if (progress >= 100) {
      progress = 100;
      clearInterval(progressInterval);
    }

    progressFill.style.width = progress + '%';

    // Cambiar mensaje según progreso
    const newMessageIndex = Math.floor((progress / 100) * statusMessages.length);
    if (newMessageIndex !== messageIndex && newMessageIndex < statusMessages.length) {
      messageIndex = newMessageIndex;
      loadingStatus.textContent = statusMessages[messageIndex];
    }
  }, 200);

  // Función para actualizar el estado de carga
  window.updateLoadingStatus = function(message) {
    loadingStatus.textContent = message;
  };

  // Función para ocultar la pantalla de carga
  window.hideLoadingScreen = function() {
    clearInterval(progressInterval);
    progressFill.style.width = '100%';
    loadingStatus.textContent = 'Listo!';

    setTimeout(() => {
      loadingScreen.classList.add('fade-out');
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 500);
    }, 500);
  };

  // Ocultar pantalla cuando todo esté cargado
  window.addEventListener('load', async () => {
    console.log('🚀 Evento window.load disparado');
    // Esperar un mínimo de 2 segundos para que se vean las instrucciones
    setTimeout(async () => {
      console.log('⏰ Timeout de 2 segundos completado');
      // Verificar que los scripts principales estén cargados
      console.log('🔍 Verificando iniciarSimulacion:', typeof iniciarSimulacion);
      console.log('🔍 Verificando inicializarMotorGrafico:', typeof inicializarMotorGrafico);
      console.log('🔍 window.USE_PIXI:', window.USE_PIXI);
      if (typeof iniciarSimulacion !== 'undefined') {
        // Inicializar motor gráfico PixiJS solo si está habilitado
        if (window.USE_PIXI && typeof inicializarMotorGrafico !== 'undefined') {
          try {
            updateLoadingStatus('Inicializando motor gráfico...');
            await inicializarMotorGrafico();
            updateLoadingStatus('¡Listo!');
          } catch (error) {
            console.error('❌ Error inicializando motor gráfico:', error);
            alert('Error inicializando PixiJS. Revisa la consola para más detalles.');
          }
        } else if (!window.USE_PIXI) {
          console.log('ℹ️ PixiJS deshabilitado, usando Canvas 2D nativo');
        }

        // Inicializar módulo de escenarios
        if (typeof inicializarEscenarios !== 'undefined') {
          updateLoadingStatus('Inicializando escenarios...');
          inicializarEscenarios();
        }

        // Inicializar gestión de escenarios
        if (typeof inicializarGestionEscenarios !== 'undefined') {
          updateLoadingStatus('Inicializando gestión de escenarios...');
          inicializarGestionEscenarios();
        }

        // Inicializar calles excluidas por defecto en métricas
        if (typeof window.inicializarCallesExcluidasPorDefecto !== 'undefined') {
          updateLoadingStatus('Configurando métricas...');
          window.inicializarCallesExcluidasPorDefecto();
        }

        hideLoadingScreen();
      } else {
        // Esperar un poco más si no está listo
        setTimeout(hideLoadingScreen, 1000);
      }
    }, 2000);
  });

  // Backup: ocultar después de 15 segundos máximo
  setTimeout(() => {
    if (loadingScreen && !loadingScreen.classList.contains('fade-out')) {
      console.warn('Forzando cierre de pantalla de carga');
      hideLoadingScreen();
    }
  }, 15000);
})();
