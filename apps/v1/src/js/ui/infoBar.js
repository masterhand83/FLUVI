// ========== SISTEMA DE INFORMACIÓN EN TIEMPO REAL (estilo Golly) ==========
(function() {
  // Tiempo simulado (usado para compatibilidad con sistema anterior)
  let simulatedStartDate = new Date();
  let simulatedCurrentDate = new Date(simulatedStartDate);

  // Referencias a elementos del DOM (se obtienen cuando el DOM esté listo)
  let infoGeneration;
  let infoPopulation;
  let infoTrafficMultiplier;
  let infoSimulatedDateTime;
  let infoTimePerFrame;

  // Contador de generación
  let generationCount = 0;

  // Inicializar referencias al DOM cuando esté listo
  function initDOMReferences() {
    infoGeneration = document.getElementById('infoGeneration');
    infoPopulation = document.getElementById('infoPopulation');
    infoTrafficMultiplier = document.getElementById('infoTrafficMultiplier');
    infoSimulatedDateTime = document.getElementById('infoSimulatedDateTime');
    infoTimePerFrame = document.getElementById('infoTimePerFrame');
  }

  // Calcular tiempo por frame basado en física de la simulación
  function calcularTiempoPorFrame() {
    // Velocidad vehicular: 50 km/h = 13.89 m/s
    const VELOCIDAD_VEHICULO_MS = 13.89; // 50 km/h en m/s
    const DISTANCIA_CELDA_M = 5; // metros por celda

    // Tiempo base físico: 5m / 13.89 m/s ≈ 0.36s
    // Pero necesitamos calibrar para que slider=50 muestre ~0.512s
    // Slider=50 → intervalo≈126ms → factor=126/250=0.504
    // Queremos: 0.504 * TIEMPO_CALIBRADO = 0.512s
    // Entonces: TIEMPO_CALIBRADO = 0.512 / 0.504 ≈ 1.016s
    const TIEMPO_CALIBRADO = 1.016; // Calibrado para que slider=50 → ~0.512s

    let frameTime = TIEMPO_CALIBRADO;

    if (window.intervaloDeseado !== undefined) {
      const MAX_INTERVALO = 250; // ms (definido en trafico.js)
      // Normalizar intervalo: 0 (máx velocidad) a 1 (mín velocidad)
      const factorVelocidad = window.intervaloDeseado / MAX_INTERVALO;
      frameTime = TIEMPO_CALIBRADO * factorVelocidad;
      // Nunca llegar a 0, mínimo 0.001s
      frameTime = Math.max(frameTime, 0.001);
    }

    return frameTime;
  }

  // Función para calcular la población (vehículos en todas las calles)
  // Cuenta todos los vehículos de tipo 1, 2, 3, 4, 5, 6
  function calculatePopulation() {
    if (!window.calles || window.calles.length === 0) return 0;

    let total = 0;
    window.calles.forEach(calle => {
      if (calle.arreglo && Array.isArray(calle.arreglo)) {
        calle.arreglo.forEach(carril => {
          if (Array.isArray(carril)) {
            // Contar todas las celdas con valor >= 1 y <= 6 (todos los tipos de vehículos)
            total += carril.filter(cell => cell >= 1 && cell <= 6).length;
          }
        });
      }
    });
    return total;
  }

  // Función para formatear fecha y hora combinadas
  function formatDateTime(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  // Constantes físicas para el cálculo de tiempo simulado
  const CELL_LENGTH_METERS = 5; // Cada celda representa 5 metros
  // Calibrado empíricamente: slider en 58 ≈ 0.9 segundos de tiempo simulado por frame
  // Cada frame representa el avance de 1 celda (5 metros) en el mundo simulado
  const REAL_TIME_PER_CELL_SECONDS = 0.9; // Tiempo real que tarda un vehículo en avanzar 1 celda (5m)

  // ⚡ OPTIMIZACIÓN: Throttling adaptativo para actualizaciones de info bar
  // Desktop (60 FPS): actualizar cada 10 frames (~6 veces/seg)
  // Mobile (30 FPS): actualizar cada 15 frames (~2 veces/seg)
  const isMobile = window.pixiApp && window.pixiApp.isMobile;
  const INFO_BAR_UPDATE_INTERVAL = isMobile ? 15 : 10;
  let infoBarUpdateCounter = 0;
  let cachedPopulation = 0; // Cache de población

  console.log(`⚡ Info bar actualizándose cada ${INFO_BAR_UPDATE_INTERVAL} frames (${isMobile ? '📱 MÓVIL' : '🖥️ DESKTOP'})`);

  // Función para actualizar la información
  function updateInfo() {
    // Inicializar referencias si aún no están
    if (!infoGeneration) {
      initDOMReferences();
    }

    // Incrementar y actualizar generación (siempre, es muy ligero)
    generationCount++;
    if (infoGeneration) {
      infoGeneration.textContent = generationCount.toLocaleString();
    }

    // ⚡ OPTIMIZACIÓN: Actualizar información costosa solo cada N frames
    infoBarUpdateCounter++;
    const shouldUpdateExpensiveInfo = infoBarUpdateCounter >= INFO_BAR_UPDATE_INTERVAL;

    if (shouldUpdateExpensiveInfo) {
      infoBarUpdateCounter = 0; // Reset counter

      // Mostrar tiempo simulado por frame
      // Calcula cuánto tiempo (en segundos) tarda un vehículo en avanzar 1 celda (5 metros)
      // basado en velocidad de 60 km/h y escalado según el slider de velocidad
      if (infoTimePerFrame) {
        const frameTime = calcularTiempoPorFrame();
        infoTimePerFrame.textContent = frameTime.toFixed(3) + 's';
      }

      // Actualizar población (COSTOSO: itera todas las calles y celdas)
      if (infoPopulation) {
        cachedPopulation = calculatePopulation();
        infoPopulation.textContent = cachedPopulation.toLocaleString();
      }

      // Actualizar multiplicador de tráfico
      if (window.obtenerMultiplicadorTrafico && infoTrafficMultiplier) {
        const multiplicador = window.obtenerMultiplicadorTrafico();
        infoTrafficMultiplier.textContent = multiplicador.toFixed(1) + '×';
      }

      // Actualizar tiempo simulado usando el sistema de tiempo virtual
      // El tiempo virtual se actualiza en trafico.js con avanzarTiempo()
      if (infoSimulatedDateTime) {
        if (window.obtenerTimestampVirtual) {
          infoSimulatedDateTime.textContent = window.obtenerTimestampVirtual();
        } else {
          // Fallback al sistema anterior si el tiempo virtual no está disponible
          const simulatedTimeIncrement = REAL_TIME_PER_CELL_SECONDS * 1000;
          simulatedCurrentDate = new Date(simulatedCurrentDate.getTime() + simulatedTimeIncrement);
          infoSimulatedDateTime.textContent = formatDateTime(simulatedCurrentDate);
        }
      }

      // Sincronizar el display de tiempo en el sidebar (timeControl.js)
      if (window.actualizarDisplayTiempoSimulador) {
        window.actualizarDisplayTiempoSimulador();
      }
    }
  }

  // Función para resetear la información
  function resetInfo() {
    // Inicializar referencias si aún no están
    if (!infoGeneration) {
      initDOMReferences();
    }

    simulatedStartDate = new Date();
    simulatedCurrentDate = new Date(simulatedStartDate);

    // Resetear generación
    generationCount = 0;
    if (infoGeneration) {
      infoGeneration.textContent = '0';
    }

    // Resetear tiempo por frame según velocidad actual
    if (infoTimePerFrame) {
      const frameTime = calcularTiempoPorFrame();
      infoTimePerFrame.textContent = frameTime.toFixed(3) + 's';
    }

    if (infoPopulation) {
      infoPopulation.textContent = '0';
    }

    // Resetear multiplicador de tráfico
    if (window.obtenerMultiplicadorTrafico && infoTrafficMultiplier) {
      const multiplicador = window.obtenerMultiplicadorTrafico();
      infoTrafficMultiplier.textContent = multiplicador.toFixed(1) + '×';
    }

    // Resetear tiempo virtual
    if (window.reiniciarTiempo) {
      window.reiniciarTiempo();
    }

    if (infoSimulatedDateTime) {
      if (window.obtenerTimestampVirtual) {
        infoSimulatedDateTime.textContent = window.obtenerTimestampVirtual();
      } else {
        infoSimulatedDateTime.textContent = formatDateTime(simulatedCurrentDate);
      }
    }

    // Sincronizar el display de tiempo en el sidebar (timeControl.js)
    if (window.actualizarDisplayTiempoSimulador) {
      window.actualizarDisplayTiempoSimulador();
    }
  }

  // Exponer funciones y variables globalmente
  window.updateSimulationInfo = updateInfo;
  window.resetSimulationInfo = resetInfo;

  // Exponer tiempo simulado para el ciclo día/noche
  Object.defineProperty(window, 'simulatedCurrentDate', {
    get: function() { return simulatedCurrentDate; },
    enumerable: true
  });

  // Inicializar con tiempo virtual
  document.addEventListener('DOMContentLoaded', function() {
    // Inicializar referencias al DOM
    initDOMReferences();

    // Inicializar tiempo por frame
    if (infoTimePerFrame) {
      const frameTime = calcularTiempoPorFrame();
      infoTimePerFrame.textContent = frameTime.toFixed(3) + 's';
    }

    // Inicializar multiplicador de tráfico
    if (window.obtenerMultiplicadorTrafico && infoTrafficMultiplier) {
      const multiplicador = window.obtenerMultiplicadorTrafico();
      infoTrafficMultiplier.textContent = multiplicador.toFixed(1) + '×';
    }

    // Inicializar tiempo
    if (infoSimulatedDateTime) {
      if (window.obtenerTimestampVirtual) {
        infoSimulatedDateTime.textContent = window.obtenerTimestampVirtual();
      } else {
        infoSimulatedDateTime.textContent = formatDateTime(simulatedCurrentDate);
      }
    }
    console.log('✓ Sistema de información en tiempo real inicializado');
  });
})();

// ========== DETECCIÓN DE TECLA Z PARA EDICIÓN DE VÉRTICES (MODO TOGGLE) ==========
(function() {
  window.vertexEditMode = false; // Modo toggle: activar/desactivar con Z
  let zKeyDown = false; // Para detectar presiones repetidas

  document.addEventListener('keydown', function(e) {
    if (e.key === 'z' || e.key === 'Z') {
      // Evitar repeticiones si la tecla está siendo mantenida presionada
      if (zKeyDown) return;
      zKeyDown = true;

      // Solo funcionar en modo edición
      if (!window.editorCalles || !window.editorCalles.modoEdicion) return;
      if (!window.calleSeleccionada || !window.calleSeleccionada.vertices) return;

      // TOGGLE: cambiar estado
      window.vertexEditMode = !window.vertexEditMode;

      const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
        ? window.pixiApp.app.view
        : document.getElementById('simuladorCanvas');

      if (window.vertexEditMode) {
        // MODO ACTIVADO
        console.log('🟢 Modo edición de vértices ACTIVADO (presiona Z nuevamente para desactivar)');

        if (canvas) {
          canvas.style.cursor = 'crosshair';
          canvas.classList.add('vertex-edit-active');
        }

        // Mostrar badge indicador
        showVertexEditBadge(true);
        updateVerticesVisualFeedback(true);
      } else {
        // MODO DESACTIVADO
        console.log('🔴 Modo edición de vértices DESACTIVADO');

        if (canvas) {
          canvas.style.cursor = '';
          canvas.classList.remove('vertex-edit-active');
        }

        // Ocultar badge indicador
        showVertexEditBadge(false);
        updateVerticesVisualFeedback(false);
      }
    }
  });

  document.addEventListener('keyup', function(e) {
    if (e.key === 'z' || e.key === 'Z') {
      zKeyDown = false; // Permitir nueva presión
    }
  });

  // Resetear estado si la ventana pierde el foco o se sale del modo edición
  window.addEventListener('blur', function() {
    window.vertexEditMode = false;
    zKeyDown = false;
    showVertexEditBadge(false);
    updateVerticesVisualFeedback(false);
  });

  // Función para actualizar el feedback visual de los vértices
  function updateVerticesVisualFeedback(isActive) {
    if (!window.USE_PIXI || !window.pixiApp || !window.pixiApp.sceneManager) return;

    const calleSeleccionada = window.calleSeleccionada;
    if (!calleSeleccionada) return;

    const verticesContainer = window.pixiApp.sceneManager.verticeSprites.get(calleSeleccionada);
    if (!verticesContainer) return;

    // Actualizar TODOS los vértices (ahora todos son editables)
    verticesContainer.children.forEach((graphics, index) => {
      if (isActive) {
        // Aumentar brillo y tamaño cuando el modo está activo
        graphics.alpha = 1.0;
        graphics.scale.set(1.3);
        graphics.cursor = 'grab';
      } else {
        // Restaurar estado normal
        graphics.alpha = 0.8;
        graphics.scale.set(1.0);
        graphics.cursor = 'pointer';
      }
    });
  }

  // Función para mostrar/ocultar badge indicador del modo de edición de vértices
  function showVertexEditBadge(show) {
    let badge = document.getElementById('vertexEditModeBadge');

    if (show) {
      if (!badge) {
        // Crear badge si no existe
        badge = document.createElement('div');
        badge.id = 'vertexEditModeBadge';
        badge.innerHTML = `
          <span style="font-weight: bold;">🎯 Modo Edición de Vértices</span>
          <br>
          <small>Arrastra los vértices para crear curvas<br>Presiona <kbd>Z</kbd> para desactivar</small>
        `;
        badge.style.cssText = `
          position: fixed;
          top: 80px;
          right: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 10000;
          font-size: 14px;
          text-align: center;
          animation: slideInRight 0.3s ease-out;
          border: 2px solid rgba(255,255,255,0.3);
        `;
        document.body.appendChild(badge);

        // Agregar animación CSS si no existe
        if (!document.getElementById('vertexEditBadgeStyle')) {
          const style = document.createElement('style');
          style.id = 'vertexEditBadgeStyle';
          style.textContent = `
            @keyframes slideInRight {
              from {
                transform: translateX(100%);
                opacity: 0;
              }
              to {
                transform: translateX(0);
                opacity: 1;
              }
            }
            @keyframes slideOutRight {
              from {
                transform: translateX(0);
                opacity: 1;
              }
              to {
                transform: translateX(100%);
                opacity: 0;
              }
            }
            #vertexEditModeBadge kbd {
              background: rgba(255,255,255,0.2);
              padding: 2px 6px;
              border-radius: 3px;
              border: 1px solid rgba(255,255,255,0.3);
              font-family: monospace;
              font-weight: bold;
            }
          `;
          document.head.appendChild(style);
        }
      } else {
        badge.style.display = 'block';
        badge.style.animation = 'slideInRight 0.3s ease-out';
      }
    } else {
      if (badge) {
        badge.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
          if (badge) badge.style.display = 'none';
        }, 300);
      }
    }
  }

  console.log('✓ Sistema de detección de tecla Z (modo toggle) inicializado');
})();
