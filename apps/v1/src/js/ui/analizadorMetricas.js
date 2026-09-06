/**
 * analizadorMetricas.js
 * Módulo para integrar el analizador de métricas Python con la interfaz web usando Pyodide
 */

let pyodideInstance = null;
let pyodideInitialized = false;
let currentFileContent = null;
let currentFileType = 'csv'; // 'csv' o 'json'
let currentImagenes = null;

/**
 * Inicializa Pyodide (Python en el navegador)
 */
async function inicializarPyodide() {
  if (pyodideInitialized) {
    return pyodideInstance;
  }

  try {
    // Mostrar estado de carga
    document.getElementById('estadoCargaPython').style.display = 'block';
    document.getElementById('mensajeEstadoPython').textContent = 'Cargando Pyodide...';
    document.getElementById('progressBarPython').style.width = '10%';

    // Cargar Pyodide desde CDN (versión más reciente)
    pyodideInstance = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
    });

    document.getElementById('progressBarPython').style.width = '30%';
    document.getElementById('mensajeEstadoPython').textContent = 'Instalando paquetes Python básicos...';

    // Instalar paquetes esenciales
    await pyodideInstance.loadPackage(['numpy', 'pandas', 'matplotlib', 'scipy', 'scikit-learn']);

    document.getElementById('progressBarPython').style.width = '60%';
    document.getElementById('mensajeEstadoPython').textContent = 'Configurando paquetes adicionales...';

    // Intentar instalar seaborn, pero continuar si falla
    try {
      await pyodideInstance.loadPackage('seaborn');
      console.log('✅ Seaborn instalado correctamente');
    } catch (error) {
      console.warn('⚠️ Seaborn no disponible, continuando sin él:', error);
      // No es crítico, el script funcionará sin seaborn
    }

    document.getElementById('progressBarPython').style.width = '80%';
    document.getElementById('mensajeEstadoPython').textContent = 'Cargando script de análisis...';

    // Cargar el script del analizador
    const response = await fetch('src/python/analizador.py');
    const analizadorScript = await response.text();

    // Ejecutar el script en Pyodide
    await pyodideInstance.runPythonAsync(analizadorScript);

    document.getElementById('progressBarPython').style.width = '100%';
    document.getElementById('mensajeEstadoPython').textContent = '¡Python listo! ✓';

    pyodideInitialized = true;

    // Ocultar barra de progreso después de 1 segundo
    setTimeout(() => {
      document.getElementById('estadoCargaPython').style.display = 'none';
    }, 1000);

    console.log('✅ Pyodide inicializado correctamente');
    return pyodideInstance;

  } catch (error) {
    console.error('❌ Error al inicializar Pyodide:', error);
    document.getElementById('mensajeEstadoPython').textContent = '❌ Error al cargar Python: ' + error.message;
    document.getElementById('estadoCargaPython').classList.remove('alert-info');
    document.getElementById('estadoCargaPython').classList.add('alert-danger');
    throw error;
  }
}

/**
 * Carga un archivo CSV o JSON para análisis
 */
async function cargarArchivoParaAnalisis(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Determinar tipo de archivo por extensión
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'csv') {
    currentFileType = 'csv';
  } else if (extension === 'json') {
    currentFileType = 'json';
  } else {
    alert('⚠️ Formato de archivo no soportado. Use .csv o .json');
    return;
  }

  // Actualizar nombre del archivo
  const iconoArchivo = currentFileType === 'json' ? '📋' : '📄';
  document.getElementById('nombreArchivoCSV').textContent = `${iconoArchivo} ${file.name}`;

  try {
    // Leer el contenido del archivo
    const reader = new FileReader();
    reader.onload = async (e) => {
      currentFileContent = e.target.result;

      // Ejecutar análisis automáticamente
      await ejecutarAnalisis();
    };
    reader.readAsText(file);

  } catch (error) {
    console.error('❌ Error al cargar archivo:', error);
    alert(`Error al cargar el archivo ${currentFileType.toUpperCase()}: ` + error.message);
  }
}

// Mantener compatibilidad con código anterior
async function cargarCSVParaAnalisis(event) {
  return cargarArchivoParaAnalisis(event);
}

/**
 * Ejecuta el análisis del archivo (CSV o JSON) usando Python
 */
async function ejecutarAnalisis() {
  if (!currentFileContent) {
    alert('Por favor, carga un archivo primero.');
    return;
  }

  try {
    // Mostrar estado de carga
    document.getElementById('estadoCargaPython').style.display = 'block';
    document.getElementById('estadoCargaPython').classList.remove('alert-danger');
    document.getElementById('estadoCargaPython').classList.add('alert-info');
    document.getElementById('mensajeEstadoPython').textContent = `Procesando ${currentFileType.toUpperCase()}...`;
    document.getElementById('progressBarPython').style.width = '20%';

    // Inicializar Pyodide si no está inicializado
    if (!pyodideInitialized) {
      await inicializarPyodide();
    }

    document.getElementById('progressBarPython').style.width = '40%';
    document.getElementById('mensajeEstadoPython').textContent = 'Analizando métricas...';

    document.getElementById('progressBarPython').style.width = '60%';
    document.getElementById('mensajeEstadoPython').textContent = 'Generando visualizaciones...';

    // Escapar el contenido para Python
    const contenidoEscapado = currentFileContent
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');

    // Ejecutar el análisis según el tipo de archivo
    let pythonCode;
    if (currentFileType === 'json') {
      pythonCode = `
import json

# Parsear el contenido JSON
contenido_json = """${contenidoEscapado}"""
analizador = AnalizadorTraficoFLUVI(contenido_json, tipo='json')
resultados = analizador.ejecutar_analisis_completo()
resultados['imagenes']
      `;
    } else {
      pythonCode = `
import io

# Leer el CSV desde el contenido
contenido_csv = """${contenidoEscapado}"""
archivo = io.StringIO(contenido_csv)
analizador = AnalizadorTraficoFLUVI(archivo, tipo='csv')
resultados = analizador.ejecutar_analisis_completo()
resultados['imagenes']
      `;
    }

    const resultado = await pyodideInstance.runPythonAsync(pythonCode);

    document.getElementById('progressBarPython').style.width = '90%';
    document.getElementById('mensajeEstadoPython').textContent = 'Renderizando imágenes...';

    // Convertir el resultado de Python a JavaScript
    currentImagenes = resultado.toJs();

    // Mostrar las imágenes
    mostrarImagenes(currentImagenes);

    document.getElementById('progressBarPython').style.width = '100%';
    document.getElementById('mensajeEstadoPython').textContent = '¡Análisis completado! ✓';

    // Ocultar barra de progreso y mostrar resultados
    setTimeout(() => {
      document.getElementById('estadoCargaPython').style.display = 'none';
      document.getElementById('resultadosAnalisis').style.display = 'block';
    }, 1000);

    console.log(`✅ Análisis de ${currentFileType.toUpperCase()} completado exitosamente`);

  } catch (error) {
    console.error('❌ Error durante el análisis:', error);
    document.getElementById('mensajeEstadoPython').textContent = '❌ Error durante el análisis: ' + error.message;
    document.getElementById('estadoCargaPython').classList.remove('alert-info');
    document.getElementById('estadoCargaPython').classList.add('alert-danger');
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
    alert('No hay imágenes para descargar');
    return;
  }

  // Usar JSZip para crear el archivo ZIP
  // Nota: Necesitarás incluir la librería JSZip en tu HTML
  if (typeof JSZip === 'undefined') {
    // Si no está disponible JSZip, descargar una por una
    alert('Descargando imágenes individualmente...');
    descargarImagenBase64(document.getElementById('imgAnalisisTemporal').src, 'analisis_temporal.png');
    setTimeout(() => {
      descargarImagenBase64(document.getElementById('imgDiagramaFundamental').src, 'diagrama_fundamental.png');
    }, 500);
    setTimeout(() => {
      descargarImagenBase64(document.getElementById('imgDistribuciones').src, 'distribuciones_correlaciones.png');
    }, 1000);
    return;
  }

  try {
    const zip = new JSZip();
    const folder = zip.folder("analisis_metricas");

    // Convertir las imágenes base64 a blobs
    const imagenesObj = {};
    for (const [key, value] of currentImagenes.entries()) {
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
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'analisis_metricas.zip';
    link.click();

    console.log('✅ ZIP descargado exitosamente');
  } catch (error) {
    console.error('❌ Error al crear ZIP:', error);
    alert('Error al crear el archivo ZIP. Descargando imágenes individualmente...');
    descargarTodasImagenesSeparadas();
  }
}

/**
 * Descarga todas las imágenes por separado (fallback)
 */
function descargarTodasImagenesSeparadas() {
  descargarImagenBase64(document.getElementById('imgAnalisisTemporal').src, 'analisis_temporal.png');
  setTimeout(() => {
    descargarImagenBase64(document.getElementById('imgDiagramaFundamental').src, 'diagrama_fundamental.png');
  }, 500);
  setTimeout(() => {
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
  // Botón para abrir el modal
  document.getElementById('btnAnalizarMetricas').addEventListener('click', () => {
    const modal = new bootstrap.Modal(document.getElementById('modalAnalizadorMetricas'));
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
