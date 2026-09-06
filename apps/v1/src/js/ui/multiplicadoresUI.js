// ========== SISTEMA DE CONFIGURACIÓN DE MULTIPLICADORES POR HORA ==========

// Variable global para trackear el día seleccionado
let diaSeleccionado = 1; // Por defecto Lunes

/**
 * Genera dinámicamente los 24 sliders para configurar multiplicadores
 * Los divide en dos columnas: 0-11 y 12-23
 * @param {number} dia - Día de la semana (0-6)
 */
function generarSlidersMultiplicadores(dia = null) {
  if (dia === null) dia = diaSeleccionado;

  const columna1 = document.getElementById('slidersColumna1');
  const columna2 = document.getElementById('slidersColumna2');

  if (!columna1 || !columna2) {
    console.error('❌ No se encontraron los contenedores de sliders');
    return;
  }

  // Limpiar contenedores
  columna1.innerHTML = '';
  columna2.innerHTML = '';

  // Obtener multiplicadores del día específico
  const multiplicadores = window.obtenerPerfilDia(dia);

  // Generar los 24 sliders
  for (let hora = 0; hora < 24; hora++) {
    // Usar ?? en lugar de || para permitir el valor 0
    const valorActual = multiplicadores[hora] ?? 1.0;
    const contenedor = hora < 12 ? columna1 : columna2;

    // Crear el HTML del slider
    const rangoHora = `${String(hora).padStart(2, '0')}:00-${String(hora).padStart(2, '0')}:59`;
    const sliderHTML = `
      <div class="mb-3 pb-2 border-bottom">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <label class="form-label mb-0 fw-bold" style="font-size: 0.9rem;" title="Controla el rango ${rangoHora}">
            ${String(hora).padStart(2, '0')}:00
          </label>
          <span class="badge bg-primary" id="valor-mult-${hora}" style="min-width: 50px;">
            ${valorActual.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          class="form-range slider-multiplicador"
          id="slider-mult-${hora}"
          data-hora="${hora}"
          min="0"
          max="3"
          step="0.1"
          value="${valorActual}"
          oninput="actualizarValorSlider(${hora}, this.value)"
          title="Controla el rango ${rangoHora}"
        >
        <div class="d-flex justify-content-between small text-muted" style="font-size: 0.7rem;">
          <span>0.0</span>
          <span>1.5</span>
          <span>3.0</span>
        </div>
      </div>
    `;

    contenedor.insertAdjacentHTML('beforeend', sliderHTML);
  }

  console.log('✅ 24 sliders de multiplicadores generados');
}

/**
 * Actualiza el valor mostrado del slider en tiempo real
 * @param {number} hora - Hora del día (0-23)
 * @param {number} valor - Nuevo valor del multiplicador
 */
function actualizarValorSlider(hora, valor) {
  const badge = document.getElementById(`valor-mult-${hora}`);
  if (badge) {
    const valorNum = parseFloat(valor);
    badge.textContent = valorNum.toFixed(2);

    // Cambiar color del badge según el valor
    badge.className = 'badge';
    if (valorNum < 0.5) {
      badge.classList.add('bg-secondary');
    } else if (valorNum < 1.0) {
      badge.classList.add('bg-info');
    } else if (valorNum < 1.5) {
      badge.classList.add('bg-primary');
    } else if (valorNum < 2.0) {
      badge.classList.add('bg-warning', 'text-dark');
    } else {
      badge.classList.add('bg-danger');
    }
  }
}

/**
 * Lee los valores actuales de todos los sliders y devuelve un array
 * @returns {Array<number>} Array de 24 multiplicadores
 */
function leerValoresSliders() {
  const valores = [];
  for (let hora = 0; hora < 24; hora++) {
    const slider = document.getElementById(`slider-mult-${hora}`);
    if (slider) {
      valores.push(parseFloat(slider.value));
    } else {
      valores.push(1.0); // Valor por defecto si no existe el slider
    }
  }
  return valores;
}

/**
 * Actualiza los sliders con nuevos valores
 * @param {Array<number>} valores - Array de 24 valores
 */
function actualizarSliders(valores) {
  if (!Array.isArray(valores) || valores.length !== 24) {
    console.error('❌ Error: Se requiere un array de 24 valores');
    return;
  }

  for (let hora = 0; hora < 24; hora++) {
    const slider = document.getElementById(`slider-mult-${hora}`);
    if (slider) {
      slider.value = valores[hora];
      actualizarValorSlider(hora, valores[hora]);
    }
  }
}

/**
 * Cambia el día seleccionado y recarga los sliders
 * @param {string|number} dia - Día de la semana (0-6)
 */
function cambiarDiaMultiplicador(dia) {
  diaSeleccionado = parseInt(dia);
  generarSlidersMultiplicadores(diaSeleccionado);
  console.log(`📅 Día cambiado a: ${window.NOMBRES_DIAS[diaSeleccionado]}`);
}

/**
 * Aplica un preset predefinido de multiplicadores al día actual
 * @param {string} preset - Nombre del preset: 'laboral', 'finSemana', 'constante', 'nocturno'
 */
function aplicarPresetMultiplicadores(preset) {
  let valores;

  switch (preset) {
    case 'laboral':
      // Día laboral con picos en mañana (7-9) y tarde (18-20)
      valores = [
        0.2, 0.2, 0.2, 0.2, 0.2, 0.3,  // 00-05: Madrugada
        0.5, 1.5, 1.8, 1.3, 0.8, 0.8,  // 06-11: Pico mañana
        1.0, 1.2, 1.1, 0.9, 0.8, 1.2,  // 12-17: Mediodía y tarde
        1.7, 1.6, 1.3, 0.7, 0.5, 0.3   // 18-23: Pico tarde
      ];
      break;

    case 'finSemana':
      // Fin de semana más relajado, pico en tarde
      valores = [
        0.3, 0.3, 0.3, 0.3, 0.3, 0.3,  // 00-05
        0.3, 0.3, 0.4, 0.5, 0.8, 0.9,  // 06-11
        1.0, 1.2, 1.3, 1.3, 1.2, 1.1,  // 12-17: Pico tarde
        1.0, 0.9, 0.7, 0.6, 0.5, 0.4   // 18-23
      ];
      break;

    case 'constante':
      // Tráfico constante todo el día
      valores = Array(24).fill(1.0);
      break;

    case 'nocturno':
      // Patrón nocturno: alto en noche, bajo en día
      valores = [
        1.5, 1.5, 1.3, 1.0, 0.8, 0.5,  // 00-05: Alto nocturno
        0.3, 0.2, 0.2, 0.3, 0.4, 0.5,  // 06-11: Muy bajo
        0.6, 0.7, 0.8, 0.9, 1.0, 1.2,  // 12-17: Aumentando
        1.4, 1.6, 1.8, 1.8, 1.7, 1.6   // 18-23: Subiendo al pico nocturno
      ];
      break;

    default:
      console.error(`❌ Preset desconocido: ${preset}`);
      return;
  }

  actualizarSliders(valores);
  console.log(`✅ Preset "${preset}" aplicado a ${window.NOMBRES_DIAS[diaSeleccionado]}`);
}

/**
 * Copia los valores del día actual a todos los demás días
 */
function copiarATodosDias() {
  const valoresActuales = leerValoresSliders();

  if (confirm(`¿Deseas copiar los valores de ${window.NOMBRES_DIAS[diaSeleccionado]} a TODOS los días de la semana?`)) {
    const exito = window.actualizarMultiplicadoresTodosDias(valoresActuales);
    if (exito) {
      alert(`✅ Valores copiados a todos los días de la semana exitosamente.`);
      console.log('✅ Valores copiados a todos los días');
    } else {
      alert('❌ Error al copiar valores. Revisa la consola.');
    }
  }
}

/**
 * Confirma y restaura los multiplicadores por defecto
 */
function confirmarRestaurarDefault() {
  const opciones = [
    'Solo este día (' + window.NOMBRES_DIAS[diaSeleccionado] + ')',
    'Todos los días de la semana',
    'Cancelar'
  ];

  const respuesta = prompt(
    `¿Qué deseas restaurar a valores por defecto?\n\n` +
    `1 - ${opciones[0]}\n` +
    `2 - ${opciones[1]}\n` +
    `3 - ${opciones[2]}\n\n` +
    `Escribe el número de tu opción:`,
    '1'
  );

  if (respuesta === '1') {
    window.restaurarMultiplicadoresDefault(diaSeleccionado);
    generarSlidersMultiplicadores(diaSeleccionado);
    alert(`✅ Multiplicadores de ${window.NOMBRES_DIAS[diaSeleccionado]} restaurados.`);
  } else if (respuesta === '2') {
    window.restaurarMultiplicadoresDefault(null);
    generarSlidersMultiplicadores(diaSeleccionado);
    alert('✅ Multiplicadores de todos los días restaurados.');
  }
}

/**
 * Maneja el clic en el botón "Actualizar Multiplicadores"
 */
function confirmarActualizacionMultiplicadores() {
  const valores = leerValoresSliders();

  // Validar valores
  for (let i = 0; i < valores.length; i++) {
    if (isNaN(valores[i]) || valores[i] < 0 || valores[i] > 3) {
      alert(`❌ Error: Valor inválido en hora ${i}: ${valores[i]}`);
      return;
    }
  }

  // Actualizar los multiplicadores en el sistema para el día seleccionado
  const exito = window.actualizarMultiplicadoresDia(diaSeleccionado, valores);

  if (exito) {
    // Notificar al usuario
    console.log(`✅ Multiplicadores de ${window.NOMBRES_DIAS[diaSeleccionado]} actualizados exitosamente`);
    console.log('📊 Valores guardados:', valores);

    // Invalidar caché para aplicar cambios inmediatamente
    if (window.multiplicadorCache) {
      window.multiplicadorCache.ultimaHora = -1;
      window.multiplicadorCache.ultimoDia = -1;
    }

    // Log para debugging
    console.log('🔍 Verificando valores guardados:', window.obtenerPerfilDia(diaSeleccionado));

    // Cerrar el modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalMultiplicadores'));
    if (modal) {
      modal.hide();
    }

    // Mostrar mensaje de éxito
    alert(`✅ Multiplicadores de ${window.NOMBRES_DIAS[diaSeleccionado]} actualizados exitosamente.\n\nLos nuevos valores se aplicarán en el siguiente paso de simulación.`);
  } else {
    alert('❌ Error al actualizar los multiplicadores. Revisa la consola para más detalles.');
  }
}

// ========== EVENT LISTENERS ==========

document.addEventListener('DOMContentLoaded', () => {
  // Generar sliders cuando se abre el modal
  const modalMultiplicadores = document.getElementById('modalMultiplicadores');
  if (modalMultiplicadores) {
    modalMultiplicadores.addEventListener('show.bs.modal', () => {
      // Inicializar con el día actual de la simulación o Lunes por defecto
      if (window.configuracionTiempo) {
        diaSeleccionado = window.configuracionTiempo.diaActual;
        const selector = document.getElementById('selectDiaSemanaMultiplicador');
        if (selector) {
          selector.value = diaSeleccionado;
        }
      }
      generarSlidersMultiplicadores(diaSeleccionado);
    });
  }

  // Botón de actualizar multiplicadores
  const btnActualizar = document.getElementById('btnActualizarMultiplicadores');
  if (btnActualizar) {
    btnActualizar.addEventListener('click', confirmarActualizacionMultiplicadores);
  }

  console.log('✅ Sistema de configuración de multiplicadores por día inicializado');
});

// ========== EXPONER FUNCIONES AL SCOPE GLOBAL ==========

window.generarSlidersMultiplicadores = generarSlidersMultiplicadores;
window.actualizarValorSlider = actualizarValorSlider;
window.cambiarDiaMultiplicador = cambiarDiaMultiplicador;
window.aplicarPresetMultiplicadores = aplicarPresetMultiplicadores;
window.copiarATodosDias = copiarATodosDias;
window.confirmarRestaurarDefault = confirmarRestaurarDefault;
window.leerValoresSliders = leerValoresSliders;
window.actualizarSliders = actualizarSliders;
window.confirmarActualizacionMultiplicadores = confirmarActualizacionMultiplicadores;
