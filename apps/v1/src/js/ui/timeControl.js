// ========== CONTROL DE FECHA Y HORA DEL SIMULADOR ==========
document.addEventListener('DOMContentLoaded', function() {
  // Elementos del modal
  const selectDiaSemanaModal = document.getElementById('selectDiaSemanaModal');
  const inputHoraModal = document.getElementById('inputHoraModal');
  const inputMinutosModal = document.getElementById('inputMinutosModal');
  const btnConfirmarTiempo = document.getElementById('btnConfirmarTiempo');
  const previewTiempoSeleccionado = document.getElementById('previewTiempoSeleccionado');
  const tiempoActualDisplay = document.getElementById('tiempoActualDisplay');

  const nombresDias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  // Función para actualizar el display del tiempo actual
  function actualizarDisplayTiempoActual() {
    if (!tiempoActualDisplay) return;

    // Usar directamente la función del sistema de tiempo para máxima sincronización
    if (window.obtenerTimestampVirtual) {
      tiempoActualDisplay.textContent = window.obtenerTimestampVirtual();
    } else if (window.configuracionTiempo) {
      // Fallback manual si la función no está disponible
      const dia = nombresDias[window.configuracionTiempo.diaActual];
      const hora = Math.floor(window.configuracionTiempo.horaActual).toString().padStart(2, '0');
      const minutos = Math.floor(window.configuracionTiempo.minutoActual).toString().padStart(2, '0');
      const segundos = Math.floor(window.configuracionTiempo.segundoActual).toString().padStart(2, '0');
      tiempoActualDisplay.textContent = `${dia} ${hora}:${minutos}:${segundos}`;
    }
  }

  // Función para actualizar los inputs del modal con el tiempo actual del simulador
  function actualizarInputsDesdeSimulador() {
    if (window.configuracionTiempo) {
      selectDiaSemanaModal.value = window.configuracionTiempo.diaActual;
      inputHoraModal.value = Math.floor(window.configuracionTiempo.horaActual);
      inputMinutosModal.value = Math.floor(window.configuracionTiempo.minutoActual);
      actualizarPreview();
    }
  }

  // Función para actualizar la vista previa en el modal
  function actualizarPreview() {
    const dia = nombresDias[parseInt(selectDiaSemanaModal.value)];
    const hora = parseInt(inputHoraModal.value) || 0;
    const minutos = parseInt(inputMinutosModal.value) || 0;
    previewTiempoSeleccionado.textContent = `${dia} ${hora.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
  }

  // Función para validar los valores de entrada
  function validarEntrada() {
    let hora = parseInt(inputHoraModal.value);
    let minutos = parseInt(inputMinutosModal.value);

    // Validar hora (0-23)
    if (isNaN(hora) || hora < 0) {
      hora = 0;
      inputHoraModal.value = 0;
    } else if (hora > 23) {
      hora = 23;
      inputHoraModal.value = 23;
    }

    // Validar minutos (0-59)
    if (isNaN(minutos) || minutos < 0) {
      minutos = 0;
      inputMinutosModal.value = 0;
    } else if (minutos > 59) {
      minutos = 59;
      inputMinutosModal.value = 59;
    }

    actualizarPreview();
    return { hora, minutos };
  }

  // Botón para confirmar y aplicar los cambios de fecha y hora
  btnConfirmarTiempo.addEventListener('click', function() {
    const dia = parseInt(selectDiaSemanaModal.value);
    const { hora, minutos } = validarEntrada();

    if (window.configuracionTiempo) {
      // Actualizar la configuración de tiempo
      window.configuracionTiempo.diaActual = dia;
      window.configuracionTiempo.horaActual = hora;
      window.configuracionTiempo.minutoActual = minutos;
      window.configuracionTiempo.segundoActual = 0;

      // Invalidar cache del multiplicador
      if (window.multiplicadorCache) {
        window.multiplicadorCache.ultimaDia = -1;
        window.multiplicadorCache.ultimaHora = -1;
      }

      // Actualizar la visualización
      if (window.updateSimulationInfo) {
        window.updateSimulationInfo();
      }

      // Actualizar el display del tiempo actual
      actualizarDisplayTiempoActual();

      const nombreDia = nombresDias[dia];
      console.log(`⏰ Tiempo del simulador actualizado: ${nombreDia} ${hora.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:00`);

      // Feedback visual
      const originalText = btnConfirmarTiempo.innerHTML;
      btnConfirmarTiempo.innerHTML = '✅ Aplicado!';
      btnConfirmarTiempo.disabled = true;

      setTimeout(() => {
        btnConfirmarTiempo.innerHTML = originalText;
        btnConfirmarTiempo.disabled = false;

        // Cerrar el modal usando Bootstrap 5
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalTiempoSimulador'));
        if (modal) {
          modal.hide();
        }
      }, 1000);
    } else {
      console.error('❌ No se encontró configuracionTiempo en window');
      alert('Error: El sistema de tiempo no está disponible');
    }
  });

  // Listeners para actualizar la vista previa en tiempo real
  selectDiaSemanaModal.addEventListener('change', actualizarPreview);
  inputHoraModal.addEventListener('input', validarEntrada);
  inputMinutosModal.addEventListener('input', validarEntrada);

  // Permitir aplicar con Enter en los campos de texto
  inputHoraModal.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      btnConfirmarTiempo.click();
    }
  });

  inputMinutosModal.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      btnConfirmarTiempo.click();
    }
  });

  // Actualizar inputs del modal cuando se abre
  const modalElement = document.getElementById('modalTiempoSimulador');
  if (modalElement) {
    modalElement.addEventListener('show.bs.modal', function() {
      actualizarInputsDesdeSimulador();
    });
  }

  // Exponer la función de actualización globalmente para que infoBar.js la llame
  window.actualizarDisplayTiempoSimulador = actualizarDisplayTiempoActual;

  // Sincronizar al cargar la página
  setTimeout(() => {
    actualizarDisplayTiempoActual();
    actualizarInputsDesdeSimulador();
  }, 100);

  console.log('✓ Sistema de control de fecha y hora inicializado');
});
