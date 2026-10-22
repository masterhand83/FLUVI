/**
 * analizadorMetricas.js
 * Módulo para integrar el analizador de métricas Python con la interfaz web usando Pyodide
 */

let pyodideInstance = null;
let pyodideInitialized = false;
let currentFileContent = null;
let currentFileType = 'csv'; // 'csv' o 'json'
let currentImagenes = null;
let pyodideInitialization = null;
let analysisGeneration = 0;
let analysisQueue = Promise.resolve();

function analyzerText(key, params) {
  return typeof tr === 'function' ? tr(key, params) : key;
}

function analyzerNotify(severity, key, params) {
  const notify = window.fluviNotify;
  if (notify && typeof notify[severity] === 'function') {
    notify[severity](key, params);
    return;
  }
  if (typeof window.alert === 'function') {
    window.alert(analyzerText(key, params));
  }
}

function flattenAnalyzerMessages(source, prefix) {
  const messages = {};
  const visit = (value, path) => {
    for (const [key, entry] of Object.entries(value ?? {})) {
      const nextPath = `${path}.${key}`;
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        visit(entry, nextPath);
      } else if (typeof entry === 'string') {
        messages[nextPath] = entry;
      }
    }
  };
  visit(source, prefix);
  return messages;
}

function analyzerMessagesForPyodide() {
  const resources = window.FLUVI_LOCALE_RESOURCES;
  if (!resources) return null;
  const messages = {};
  for (const [language, namespaces] of Object.entries(resources)) {
    const python = namespaces?.translation?.analyzer?.python;
    if (!python) continue;
    messages[language] = flattenAnalyzerMessages(
      python,
      'analyzer.python',
    );
  }
  return Object.keys(messages).length > 0 ? messages : null;
}

function setAnalyzerProgress(percent) {
  const bar = document.getElementById('progressBarPython');
  bar.style.width = `${percent}%`;
  bar.setAttribute('aria-valuenow', String(percent));
}

function hideAnalyzerStatus() {
  const estado = document.getElementById('estadoCargaPython');
  estado.style.display = 'none';
  estado.classList.remove('alert-danger');
  estado.classList.add('alert-info');
  estado.setAttribute('role', 'status');
  const spinner = estado.querySelector('.spinner-border');
  if (spinner) spinner.hidden = false;
}

function setAnalyzerStatus(kind, key, params) {
  const estado = document.getElementById('estadoCargaPython');
  estado.style.display = 'block';
  estado.classList.remove('alert-info', 'alert-danger');
  estado.classList.add(kind === 'error' ? 'alert-danger' : 'alert-info');
  estado.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const spinner = estado.querySelector('.spinner-border');
  if (spinner) spinner.hidden = kind === 'error';
  document.getElementById('mensajeEstadoPython').textContent =
    analyzerText(key, params);
}

function analyzerErrorReason(error) {
  const message = String(error?.message || error || '').trim();
  if (!message) return '';
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1) || message;
  return last.replace(/^[\w.]*(?:Error|Exception):\s*/, '') || last;
}

function limpiarResultadosAnalisis() {
  currentImagenes = null;
  document.getElementById('resultadosAnalisis').style.display = 'none';
  for (const id of ['imgAnalisisTemporal', 'imgDiagramaFundamental', 'imgDistribuciones']) {
    document.getElementById(id).src = '';
  }
  document.getElementById('btnDescargarImagenActual').disabled = true;
  document.getElementById('btnDescargarTodasImagenes').disabled = true;
}

function resetearAnalizadorMetricas() {
  analysisGeneration++;
  currentFileContent = null;
  currentFileType = 'csv';
  limpiarResultadosAnalisis();
  document.getElementById('inputCSVAnalizador').value = '';
  document.getElementById('nombreArchivoCSV').textContent = analyzerText('analyzer.modal.noFile');
  hideAnalyzerStatus();
  document.getElementById('mensajeEstadoPython').textContent = analyzerText('analyzer.modal.initializing');
  setAnalyzerProgress(0);
  for (const tab of document.querySelectorAll('#tabsImagenes [role="tab"]')) {
    const active = tab.id === 'tab-temporal';
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of document.querySelectorAll('#tabsImagenesContent .tab-pane')) {
    const active = panel.id === 'img-temporal';
    panel.classList.toggle('active', active);
    panel.classList.toggle('show', active);
  }
}

/**
 * Inicializa Pyodide (Python en el navegador)
 */
async function inicializarPyodide() {
  if (pyodideInitialized) {
    return pyodideInstance;
  }

  if (pyodideInitialization) return pyodideInitialization;
  pyodideInitialization = (async () => {
    // Cargar la versión de Pyodide fijada por la aplicación.
    const instance = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
    });

    // Instalar paquetes esenciales
    await instance.loadPackage(['numpy', 'pandas', 'matplotlib', 'scipy', 'scikit-learn']);

    // Intentar instalar seaborn, pero continuar si falla
    try {
      await instance.loadPackage('seaborn');
      console.log('✅ Seaborn instalado correctamente');
    } catch (error) {
      console.warn('⚠️ Seaborn no disponible, continuando sin él:', error);
      // No es crítico, el script funcionará sin seaborn
    }

    // Cargar el script del analizador
    const response = await fetch('src/python/analizador.py');
    if (!response.ok) throw new Error(analyzerText('analyzer.modal.errors.runtimeLoadFailed'));

    // Compartir los mensajes de Python del catálogo activo. Si no están
    // disponibles, el analizador conserva su respaldo en español.
    const analyzerMessages = analyzerMessagesForPyodide();
    if (analyzerMessages && instance.globals && typeof instance.globals.set === 'function') {
      instance.globals.set(
        'FLUVI_ANALYZER_MESSAGES_JSON',
        JSON.stringify(analyzerMessages),
      );
    }

    const analizadorScript = await response.text();

    // Ejecutar el script en Pyodide
    await instance.runPythonAsync(analizadorScript);
    pyodideInstance = instance;
    pyodideInitialized = true;

    console.log('✅ Pyodide inicializado correctamente');
    return pyodideInstance;

  })();
  try {
    return await pyodideInitialization;
  } finally {
    pyodideInitialization = null;
  }
}

/**
 * Carga un archivo CSV o JSON para análisis
 */
async function cargarArchivoParaAnalisis(event) {
  const file = event.target.files[0];
  if (!file) return;
  // Permitir seleccionar de nuevo el mismo archivo después de un error.
  event.target.value = '';
  const generation = ++analysisGeneration;
  currentFileContent = null;
  limpiarResultadosAnalisis();
  hideAnalyzerStatus();
  setAnalyzerProgress(0);
  document.getElementById('nombreArchivoCSV').textContent = analyzerText('analyzer.modal.noFile');

  // Determinar tipo de archivo por extensión
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'csv') {
    currentFileType = 'csv';
  } else if (extension === 'json') {
    currentFileType = 'json';
  } else {
    analyzerNotify('error', 'analyzer.modal.errors.unsupportedFormat');
    return;
  }

  // Actualizar nombre del archivo
  const iconoArchivo = currentFileType === 'json' ? '📋' : '📄';
  document.getElementById('nombreArchivoCSV').textContent = `${iconoArchivo} ${file.name}`;
  const type = currentFileType;

  try {
    // Leer el contenido del archivo
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (generation !== analysisGeneration) return;
      currentFileContent = e.target.result;

      // Ejecutar análisis automáticamente
      await ejecutarAnalisis({ content: e.target.result, type, generation });
    };
    reader.onerror = () => {
      if (generation !== analysisGeneration) return;
      setAnalyzerStatus('error', 'analyzer.modal.errors.readFailed');
      analyzerNotify('error', 'analyzer.modal.errors.readFailed');
    };
    reader.readAsText(file);

  } catch (error) {
    if (generation !== analysisGeneration) return;
    console.error('❌ Error al cargar archivo:', error);
    setAnalyzerStatus('error', 'analyzer.modal.errors.readFailed');
    analyzerNotify('error', 'analyzer.modal.errors.readFailed');
  }
}

// Mantener compatibilidad con código anterior
async function cargarCSVParaAnalisis(event) {
  return cargarArchivoParaAnalisis(event);
}

/**
 * Ejecuta el análisis del archivo (CSV o JSON) usando Python
 */
async function ejecutarAnalisis(job = null) {
  const { content, type, generation } = job || {
    content: currentFileContent, type: currentFileType, generation: ++analysisGeneration
  };
  if (!content) {
    setAnalyzerStatus('error', 'analyzer.modal.errors.emptyFile');
    analyzerNotify('error', 'analyzer.modal.errors.emptyFile');
    return;
  }

  try {
    limpiarResultadosAnalisis();
    // Mostrar estado de carga
    setAnalyzerStatus('info', 'analyzer.modal.status.processing', {
      format: type.toUpperCase(),
    });
    setAnalyzerProgress(20);

    // Inicializar Pyodide si no está inicializado
    if (!pyodideInitialized) {
      await inicializarPyodide();
    }
    if (generation !== analysisGeneration) return;

    setAnalyzerProgress(40);
    setAnalyzerStatus('info', 'analyzer.modal.status.analyzing');

    setAnalyzerProgress(60);
    setAnalyzerStatus('info', 'analyzer.modal.status.generating');

    // Escapar el contenido para Python
    const contenidoEscapado = content
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');

    // El idioma activo de la sesión se fija al iniciar el análisis; cambiar la
    // preferencia para el próximo inicio no altera esta ejecución.
    const idiomaActivo = window.fluviI18n?.activeLanguage === 'en' ? 'en' : 'es';
    const idiomaPythonLiteral = JSON.stringify(idiomaActivo);

    // Ejecutar el análisis según el tipo de archivo
    let pythonCode;
    if (type === 'json') {
      pythonCode = `
import json

# Parsear el contenido JSON
contenido_json = """${contenidoEscapado}"""
analizador = AnalizadorTraficoFLUVI(contenido_json, tipo='json', idioma=${idiomaPythonLiteral})
resultados = analizador.ejecutar_analisis_completo()
resultados['imagenes']
      `;
    } else {
      pythonCode = `
import io

# Leer el CSV desde el contenido
contenido_csv = """${contenidoEscapado}"""
archivo = io.StringIO(contenido_csv)
analizador = AnalizadorTraficoFLUVI(archivo, tipo='csv', idioma=${idiomaPythonLiteral})
resultados = analizador.ejecutar_analisis_completo()
resultados['imagenes']
      `;
    }

    // Pyodide comparte globals: nunca ejecutar dos análisis simultáneamente.
    const pending = analysisQueue.then(async () => {
      if (generation !== analysisGeneration) return null;
      return pyodideInstance.runPythonAsync(pythonCode);
    });
    analysisQueue = pending.catch(() => {});
    const resultado = await pending;
    if (!resultado) return;
    if (generation !== analysisGeneration) {
      resultado.destroy();
      return;
    }

    setAnalyzerProgress(90);
    setAnalyzerStatus('info', 'analyzer.modal.status.rendering');

    // Convertir el resultado de Python a JavaScript
    try {
      currentImagenes = resultado.toJs();
    } finally {
      resultado.destroy();
    }

    // Mostrar las imágenes
    mostrarImagenes(currentImagenes);

    setAnalyzerProgress(100);
    setAnalyzerStatus('info', 'analyzer.modal.status.completed');

    document.getElementById('estadoCargaPython').style.display = 'none';
    document.getElementById('resultadosAnalisis').style.display = 'block';
    document.getElementById('btnDescargarImagenActual').disabled = false;
    document.getElementById('btnDescargarTodasImagenes').disabled = false;

    console.log(`✅ Análisis de ${type.toUpperCase()} completado exitosamente`);

  } catch (error) {
    if (generation !== analysisGeneration) return;
    limpiarResultadosAnalisis();
    console.error('❌ Error durante el análisis:', error);
    setAnalyzerStatus('error', 'analyzer.modal.errors.analysisFailed', {
      reason: analyzerErrorReason(error),
    });
    analyzerNotify('error', 'analyzer.modal.errors.analysisFailed', {
      reason: analyzerErrorReason(error),
    });
  }
}

// Mantener compatibilidad con código anterior
async function ejecutarAnalisisCSV() {
  return ejecutarAnalisis();
}

/**
 * Muestra las imágenes generadas en el modal
 */
function mostrarImagenes(imagenes) {
  // Convertir el Map de Python a objeto JavaScript
  const imagenesObj = {};
  for (const [key, value] of imagenes.entries()) {
    imagenesObj[key] = value;
  }

  // Asignar las imágenes a los elementos img
  document.getElementById('imgAnalisisTemporal').src = imagenesObj.temporal || '';
  document.getElementById('imgDiagramaFundamental').src = imagenesObj.fundamentales || '';
  document.getElementById('imgDistribuciones').src = imagenesObj.distribuciones || '';

  console.log('📊 Imágenes cargadas en el modal');
}

/**
 * Descarga la imagen actualmente visible
 */
function descargarImagenActual() {
  if (!currentImagenes) return;
  // Determinar qué tab está activo
  const tabTemporal = document.getElementById('tab-temporal');
  const tabFundamental = document.getElementById('tab-fundamental');
  const tabDistribuciones = document.getElementById('tab-distribuciones');

  let imgSrc = '';
  let nombreArchivo = '';

  if (tabTemporal.classList.contains('active')) {
    imgSrc = document.getElementById('imgAnalisisTemporal').src;
    nombreArchivo = 'analisis_temporal.png';
  } else if (tabFundamental.classList.contains('active')) {
    imgSrc = document.getElementById('imgDiagramaFundamental').src;
    nombreArchivo = 'diagrama_fundamental.png';
  } else if (tabDistribuciones.classList.contains('active')) {
    imgSrc = document.getElementById('imgDistribuciones').src;
    nombreArchivo = 'distribuciones_correlaciones.png';
  }

  if (imgSrc) {
    descargarImagenBase64(imgSrc, nombreArchivo);
  }
}

/**
 * Descarga todas las imágenes en un ZIP
 */
async function descargarTodasImagenes() {
  if (!currentImagenes) {
    analyzerNotify('warning', 'notifications.analyzer.noImages');
    return;
  }
  const generation = analysisGeneration;
  const imagenes = currentImagenes;

  // Usar JSZip para crear el archivo ZIP
  // Nota: Necesitarás incluir la librería JSZip en tu HTML
  if (typeof JSZip === 'undefined') {
    // Si no está disponible JSZip, descargar una por una
    analyzerNotify('info', 'notifications.analyzer.zipUnavailable');
    descargarTodasImagenesSeparadas();
    return;
  }

  try {
    const zip = new JSZip();
    const folder = zip.folder("analisis_metricas");

    // Convertir las imágenes base64 a blobs
    const imagenesObj = {};
    for (const [key, value] of imagenes.entries()) {
      imagenesObj[key] = value;
    }

    // Agregar cada imagen al ZIP
    const imgTemporal = await fetch(imagenesObj.temporal).then(r => r.blob());
    folder.file('analisis_temporal.png', imgTemporal);

    const imgFundamental = await fetch(imagenesObj.fundamentales).then(r => r.blob());
    folder.file('diagrama_fundamental.png', imgFundamental);

    const imgDistribuciones = await fetch(imagenesObj.distribuciones).then(r => r.blob());
    folder.file('distribuciones_correlaciones.png', imgDistribuciones);

    // Generar y descargar el ZIP
    const content = await zip.generateAsync({type: "blob"});
    if (generation !== analysisGeneration) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'analisis_metricas.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);

    console.log('✅ ZIP descargado exitosamente');
  } catch (error) {
    if (generation !== analysisGeneration) return;
    console.error('❌ Error al crear ZIP:', error);
    analyzerNotify('error', 'notifications.analyzer.zipFailed');
    descargarTodasImagenesSeparadas();
  }
}

/**
 * Descarga todas las imágenes por separado (fallback)
 */
function descargarTodasImagenesSeparadas() {
  const generation = analysisGeneration;
  descargarImagenBase64(document.getElementById('imgAnalisisTemporal').src, 'analisis_temporal.png');
  setTimeout(() => {
    if (generation !== analysisGeneration) return;
    descargarImagenBase64(document.getElementById('imgDiagramaFundamental').src, 'diagrama_fundamental.png');
  }, 500);
  setTimeout(() => {
    if (generation !== analysisGeneration) return;
    descargarImagenBase64(document.getElementById('imgDistribuciones').src, 'distribuciones_correlaciones.png');
  }, 1000);
}

/**
 * Descarga una imagen en base64
 */
function descargarImagenBase64(base64Data, nombreArchivo) {
  const link = document.createElement('a');
  link.href = base64Data;
  link.download = nombreArchivo;
  link.click();
  console.log(`✅ Descargada: ${nombreArchivo}`);
}

/**
 * Inicializa los event listeners
 */
function inicializarAnalizadorMetricas() {
  const modalElement = document.getElementById('modalAnalizadorMetricas');
  resetearAnalizadorMetricas();
  modalElement.addEventListener('hide.bs.modal', () => { analysisGeneration++; });
  modalElement.addEventListener('hidden.bs.modal', resetearAnalizadorMetricas);
  // Botón para abrir el modal
  document.getElementById('btnAnalizarMetricas').addEventListener('click', () => {
    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
  });

  // Botones de descarga
  document.getElementById('btnDescargarImagenActual').addEventListener('click', descargarImagenActual);
  document.getElementById('btnDescargarTodasImagenes').addEventListener('click', descargarTodasImagenes);

  console.log('✅ Analizador de Métricas inicializado');
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarAnalizadorMetricas);
} else {
  inicializarAnalizadorMetricas();
}
