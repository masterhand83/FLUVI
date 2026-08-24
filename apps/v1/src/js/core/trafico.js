console.log('🚀 trafico.js cargando...');

const canvas = document.getElementById("simuladorCanvas");
const ctx = canvas.getContext("2d");

// Motor Gráfico PixiJS - Se inicializa después
let pixiInitialized = false;
let pixiFirstRender = false; // Flag para renderizar la escena inicial

// Detectar si es un dispositivo móvil
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

// Flag para habilitar/deshabilitar PixiJS (útil para debugging)
// En móviles, usar Canvas 2D por defecto (más confiable y compatible)
// En desktop, usar PixiJS por defecto (mejor rendimiento)
const pixiUserPreference = localStorage.getItem('usePixi');
if (isMobile && pixiUserPreference === null) {
    // Primera vez en móvil: deshabilitar PixiJS automáticamente
    window.USE_PIXI = false;
    console.log(`📱 Móvil detectado: Usando Canvas 2D por defecto`);
} else {
    // Desktop o usuario tiene preferencia guardada
    window.USE_PIXI = pixiUserPreference !== 'false';
}

console.log(`ℹ️ USE_PIXI = ${window.USE_PIXI} (isMobile: ${isMobile})`);

// 📱 OPTIMIZACIÓN MÓVIL: Desactivar funciones avanzadas por defecto
let mostrarConexiones = false; // Variable para controlar visualización de conexiones
let mostrarVertices = false; // Variable para controlar visualización de vértices
let mostrarEtiquetas = isMobile ? false : false; // Desactivado en móviles por defecto
let mostrarContadores = isMobile ? false : false; // Desactivado en móviles por defecto
let colorFondoCanvas = "#c6cbcd"; // Color de fondo del canvas (almacenado para detección automática)

// Exponer variables globales para PixiJS
window.mostrarConexiones = mostrarConexiones;
window.mostrarVertices = mostrarVertices;
window.mostrarEtiquetas = mostrarEtiquetas;
window.mostrarContadores = mostrarContadores;

// 📱 Mensaje informativo en móviles
if (isMobile) {
    console.log('📱 MODO MÓVIL ACTIVADO:');
    console.log('  • FPS limitado a 30 (ahorro de batería)');
    console.log('  • Resolución optimizada (1x)');
    console.log('  • Antialiasing desactivado');
    console.log('  • Funciones visuales avanzadas desactivadas por defecto');
}

// Ajustar tamaño inicial del canvas
function resizeCanvas() {
    const sidebar = document.querySelector('.sidebar');
    const infoBar = document.querySelector('.info-bar');
    const canvasControlBar = document.querySelector('#canvasControlBar');

    // En móviles (<= 768px), el sidebar está oculto por defecto
    const sidebarWidth = window.innerWidth > 1024 ? 390 : 0;

    // Altura del info-bar (si existe)
    const infoBarHeight = infoBar ? infoBar.offsetHeight : 0;

    // Calcular altura del canvas considerando info-bar y control bar
    canvas.width = window.innerWidth - sidebarWidth;
    canvas.height = window.innerHeight - infoBarHeight;

    console.log(`Canvas resized: ${canvas.width}x${canvas.height} (screen: ${window.innerWidth}x${window.innerHeight}, infoBar: ${infoBarHeight})`);
}

resizeCanvas();

// Reglas de tráfico
const reglas = {
    // Reglas para vehículo tipo 1
    "0,0,0": 0, "0,0,1": 0, "0,1,0": 0, "0,1,1": 1, "0,1,2": 1, "0,1,3": 1, "0,1,4": 1, "0,1,5": 1, "0,1,6": 1,
    "1,0,0": 1, "1,0,1": 1, "1,0,2": 1, "1,0,3": 1, "1,0,4": 1, "1,0,5": 1, "1,0,6": 1,
    "1,1,0": 0, "1,1,1": 1, "1,1,2": 1, "1,1,3": 1, "1,1,4": 1, "1,1,5": 1, "1,1,6": 1,
    "2,1,0": 0, "2,1,1": 1, "2,1,2": 1, "2,1,3": 1, "2,1,4": 1, "2,1,5": 1, "2,1,6": 1,
    "3,1,0": 0, "3,1,1": 1, "3,1,2": 1, "3,1,3": 1, "3,1,4": 1, "3,1,5": 1, "3,1,6": 1,
    "4,1,0": 0, "4,1,1": 1, "4,1,2": 1, "4,1,3": 1, "4,1,4": 1, "4,1,5": 1, "4,1,6": 1,
    "5,1,0": 0, "5,1,1": 1, "5,1,2": 1, "5,1,3": 1, "5,1,4": 1, "5,1,5": 1, "5,1,6": 1,
    "6,1,0": 0, "6,1,1": 1, "6,1,2": 1, "6,1,3": 1, "6,1,4": 1, "6,1,5": 1, "6,1,6": 1,

    // Reglas para vehículo tipo 2
    "0,0,2": 0, "0,2,0": 0, "0,2,1": 2, "0,2,2": 2, "0,2,3": 2, "0,2,4": 2, "0,2,5": 2, "0,2,6": 2,
    "1,2,0": 0, "1,2,1": 2, "1,2,2": 2, "1,2,3": 2, "1,2,4": 2, "1,2,5": 2, "1,2,6": 2,
    "2,0,0": 2, "2,0,1": 2, "2,0,2": 2, "2,0,3": 2, "2,0,4": 2, "2,0,5": 2, "2,0,6": 2,
    "2,2,0": 0, "2,2,1": 2, "2,2,2": 2, "2,2,3": 2, "2,2,4": 2, "2,2,5": 2, "2,2,6": 2,
    "0,1,2": 1, "2,1,0": 0, "2,1,1": 1, "2,1,2": 1, "2,1,3": 1, "2,1,4": 1, "2,1,5": 1, "2,1,6": 1,
    "3,2,0": 0, "3,2,1": 2, "3,2,2": 2, "3,2,3": 2, "3,2,4": 2, "3,2,5": 2, "3,2,6": 2,
    "4,2,0": 0, "4,2,1": 2, "4,2,2": 2, "4,2,3": 2, "4,2,4": 2, "4,2,5": 2, "4,2,6": 2,
    "5,2,0": 0, "5,2,1": 2, "5,2,2": 2, "5,2,3": 2, "5,2,4": 2, "5,2,5": 2, "5,2,6": 2,
    "6,2,0": 0, "6,2,1": 2, "6,2,2": 2, "6,2,3": 2, "6,2,4": 2, "6,2,5": 2, "6,2,6": 2,

    // Reglas para vehículo tipo 3
    "0,0,3": 0, "0,3,0": 0, "0,3,1": 3, "0,3,2": 3, "0,3,3": 3, "0,3,4": 3, "0,3,5": 3, "0,3,6": 3,
    "1,3,0": 0, "1,3,1": 3, "1,3,2": 3, "1,3,3": 3, "1,3,4": 3, "1,3,5": 3, "1,3,6": 3,
    "2,3,0": 0, "2,3,1": 3, "2,3,2": 3, "2,3,3": 3, "2,3,4": 3, "2,3,5": 3, "2,3,6": 3,
    "3,0,0": 3, "3,0,1": 3, "3,0,2": 3, "3,0,3": 3, "3,0,4": 3, "3,0,5": 3, "3,0,6": 3,
    "3,3,0": 0, "3,3,1": 3, "3,3,2": 3, "3,3,3": 3, "3,3,4": 3, "3,3,5": 3, "3,3,6": 3,
    "0,1,3": 1, "3,1,0": 0, "3,1,1": 1, "3,1,2": 1, "3,1,3": 1, "3,1,4": 1, "3,1,5": 1, "3,1,6": 1,
    "0,2,3": 2, "3,2,0": 0, "3,2,1": 2, "3,2,2": 2, "3,2,3": 2, "3,2,4": 2, "3,2,5": 2, "3,2,6": 2,
    "4,3,0": 0, "4,3,1": 3, "4,3,2": 3, "4,3,3": 3, "4,3,4": 3, "4,3,5": 3, "4,3,6": 3,
    "5,3,0": 0, "5,3,1": 3, "5,3,2": 3, "5,3,3": 3, "5,3,4": 3, "5,3,5": 3, "5,3,6": 3,
    "6,3,0": 0, "6,3,1": 3, "6,3,2": 3, "6,3,3": 3, "6,3,4": 3, "6,3,5": 3, "6,3,6": 3,

    // Reglas para vehículo tipo 4
    "0,0,4": 0, "0,4,0": 0, "0,4,1": 4, "0,4,2": 4, "0,4,3": 4, "0,4,4": 4, "0,4,5": 4, "0,4,6": 4,
    "1,4,0": 0, "1,4,1": 4, "1,4,2": 4, "1,4,3": 4, "1,4,4": 4, "1,4,5": 4, "1,4,6": 4,
    "2,4,0": 0, "2,4,1": 4, "2,4,2": 4, "2,4,3": 4, "2,4,4": 4, "2,4,5": 4, "2,4,6": 4,
    "3,4,0": 0, "3,4,1": 4, "3,4,2": 4, "3,4,3": 4, "3,4,4": 4, "3,4,5": 4, "3,4,6": 4,
    "4,0,0": 4, "4,0,1": 4, "4,0,2": 4, "4,0,3": 4, "4,0,4": 4, "4,0,5": 4, "4,0,6": 4,
    "4,4,0": 0, "4,4,1": 4, "4,4,2": 4, "4,4,3": 4, "4,4,4": 4, "4,4,5": 4, "4,4,6": 4,
    "0,1,4": 1, "4,1,0": 0, "4,1,1": 1, "4,1,2": 1, "4,1,3": 1, "4,1,4": 1, "4,1,5": 1, "4,1,6": 1,
    "0,2,4": 2, "4,2,0": 0, "4,2,1": 2, "4,2,2": 2, "4,2,3": 2, "4,2,4": 2, "4,2,5": 2, "4,2,6": 2,
    "0,3,4": 3, "4,3,0": 0, "4,3,1": 3, "4,3,2": 3, "4,3,3": 3, "4,3,4": 3, "4,3,5": 3, "4,3,6": 3,
    "5,4,0": 0, "5,4,1": 4, "5,4,2": 4, "5,4,3": 4, "5,4,4": 4, "5,4,5": 4, "5,4,6": 4,
    "6,4,0": 0, "6,4,1": 4, "6,4,2": 4, "6,4,3": 4, "6,4,4": 4, "6,4,5": 4, "6,4,6": 4,

    // Reglas para vehículo tipo 5
    "0,0,5": 0, "0,5,0": 0, "0,5,1": 5, "0,5,2": 5, "0,5,3": 5, "0,5,4": 5, "0,5,5": 5, "0,5,6": 5,
    "1,5,0": 0, "1,5,1": 5, "1,5,2": 5, "1,5,3": 5, "1,5,4": 5, "1,5,5": 5, "1,5,6": 5,
    "2,5,0": 0, "2,5,1": 5, "2,5,2": 5, "2,5,3": 5, "2,5,4": 5, "2,5,5": 5, "2,5,6": 5,
    "3,5,0": 0, "3,5,1": 5, "3,5,2": 5, "3,5,3": 5, "3,5,4": 5, "3,5,5": 5, "3,5,6": 5,
    "4,5,0": 0, "4,5,1": 5, "4,5,2": 5, "4,5,3": 5, "4,5,4": 5, "4,5,5": 5, "4,5,6": 5,
    "5,0,0": 5, "5,0,1": 5, "5,0,2": 5, "5,0,3": 5, "5,0,4": 5, "5,0,5": 5, "5,0,6": 5,
    "5,5,0": 0, "5,5,1": 5, "5,5,2": 5, "5,5,3": 5, "5,5,4": 5, "5,5,5": 5, "5,5,6": 5,
    "0,1,5": 1, "5,1,0": 0, "5,1,1": 1, "5,1,2": 1, "5,1,3": 1, "5,1,4": 1, "5,1,5": 1, "5,1,6": 1,
    "0,2,5": 2, "5,2,0": 0, "5,2,1": 2, "5,2,2": 2, "5,2,3": 2, "5,2,4": 2, "5,2,5": 2, "5,2,6": 2,
    "0,3,5": 3, "5,3,0": 0, "5,3,1": 3, "5,3,2": 3, "5,3,3": 3, "5,3,4": 3, "5,3,5": 3, "5,3,6": 3,
    "0,4,5": 4, "5,4,0": 0, "5,4,1": 4, "5,4,2": 4, "5,4,3": 4, "5,4,4": 4, "5,4,5": 4, "5,4,6": 4,
    "6,5,0": 0, "6,5,1": 5, "6,5,2": 5, "6,5,3": 5, "6,5,4": 5, "6,5,5": 5, "6,5,6": 5,

    // Reglas para vehículo tipo 6
    "0,0,6": 0, "0,6,0": 0, "0,6,1": 6, "0,6,2": 6, "0,6,3": 6, "0,6,4": 6, "0,6,5": 6, "0,6,6": 6,
    "1,6,0": 0, "1,6,1": 6, "1,6,2": 6, "1,6,3": 6, "1,6,4": 6, "1,6,5": 6, "1,6,6": 6,
    "2,6,0": 0, "2,6,1": 6, "2,6,2": 6, "2,6,3": 6, "2,6,4": 6, "2,6,5": 6, "2,6,6": 6,
    "3,6,0": 0, "3,6,1": 6, "3,6,2": 6, "3,6,3": 6, "3,6,4": 6, "3,6,5": 6, "3,6,6": 6,
    "4,6,0": 0, "4,6,1": 6, "4,6,2": 6, "4,6,3": 6, "4,6,4": 6, "4,6,5": 6, "4,6,6": 6,
    "5,6,0": 0, "5,6,1": 6, "5,6,2": 6, "5,6,3": 6, "5,6,4": 6, "5,6,5": 6, "5,6,6": 6,
    "6,0,0": 6, "6,0,1": 6, "6,0,2": 6, "6,0,3": 6, "6,0,4": 6, "6,0,5": 6, "6,0,6": 6,
    "6,6,0": 0, "6,6,1": 6, "6,6,2": 6, "6,6,3": 6, "6,6,4": 6, "6,6,5": 6, "6,6,6": 6,
    "0,1,6": 1, "6,1,0": 0, "6,1,1": 1, "6,1,2": 1, "6,1,3": 1, "6,1,4": 1, "6,1,5": 1, "6,1,6": 1,
    "0,2,6": 2, "6,2,0": 0, "6,2,1": 2, "6,2,2": 2, "6,2,3": 2, "6,2,4": 2, "6,2,5": 2, "6,2,6": 2,
    "0,3,6": 3, "6,3,0": 0, "6,3,1": 3, "6,3,2": 3, "6,3,3": 3, "6,3,4": 3, "6,3,5": 3, "6,3,6": 3,
    "0,4,6": 4, "6,4,0": 0, "6,4,1": 4, "6,4,2": 4, "6,4,3": 4, "6,4,4": 4, "6,4,5": 4, "6,4,6": 4,
    "0,5,6": 5, "6,5,0": 0, "6,5,1": 5, "6,5,2": 5, "6,5,3": 5, "6,5,4": 5, "6,5,5": 5, "6,5,6": 5,

    // Reglas para bloqueo (valor 7) - El centro 7 siempre permanece 7 (inmóvil)
    "0,7,0": 7, "0,7,1": 7, "0,7,2": 7, "0,7,3": 7, "0,7,4": 7, "0,7,5": 7, "0,7,6": 7, "0,7,7": 7,
    "1,7,0": 7, "1,7,1": 7, "1,7,2": 7, "1,7,3": 7, "1,7,4": 7, "1,7,5": 7, "1,7,6": 7, "1,7,7": 7,
    "2,7,0": 7, "2,7,1": 7, "2,7,2": 7, "2,7,3": 7, "2,7,4": 7, "2,7,5": 7, "2,7,6": 7, "2,7,7": 7,
    "3,7,0": 7, "3,7,1": 7, "3,7,2": 7, "3,7,3": 7, "3,7,4": 7, "3,7,5": 7, "3,7,6": 7, "3,7,7": 7,
    "4,7,0": 7, "4,7,1": 7, "4,7,2": 7, "4,7,3": 7, "4,7,4": 7, "4,7,5": 7, "4,7,6": 7, "4,7,7": 7,
    "5,7,0": 7, "5,7,1": 7, "5,7,2": 7, "5,7,3": 7, "5,7,4": 7, "5,7,5": 7, "5,7,6": 7, "5,7,7": 7,
    "6,7,0": 7, "6,7,1": 7, "6,7,2": 7, "6,7,3": 7, "6,7,4": 7, "6,7,5": 7, "6,7,6": 7, "6,7,7": 7,
    "7,7,0": 7, "7,7,1": 7, "7,7,2": 7, "7,7,3": 7, "7,7,4": 7, "7,7,5": 7, "7,7,6": 7, "7,7,7": 7,

    // Reglas cuando un vehículo (centro) encuentra bloqueo (derecha=7) - NO puede avanzar, se mantiene
    "0,1,7": 1, "0,2,7": 2, "0,3,7": 3, "0,4,7": 4, "0,5,7": 5, "0,6,7": 6,
    "1,1,7": 1, "1,2,7": 2, "1,3,7": 3, "1,4,7": 4, "1,5,7": 5, "1,6,7": 6,
    "2,1,7": 1, "2,2,7": 2, "2,3,7": 3, "2,4,7": 4, "2,5,7": 5, "2,6,7": 6,
    "3,1,7": 1, "3,2,7": 2, "3,3,7": 3, "3,4,7": 4, "3,5,7": 5, "3,6,7": 6,
    "4,1,7": 1, "4,2,7": 2, "4,3,7": 3, "4,4,7": 4, "4,5,7": 5, "4,6,7": 6,
    "5,1,7": 1, "5,2,7": 2, "5,3,7": 3, "5,4,7": 4, "5,5,7": 5, "5,6,7": 6,
    "6,1,7": 1, "6,2,7": 2, "6,3,7": 3, "6,4,7": 4, "6,5,7": 5, "6,6,7": 6,
    "7,1,7": 1, "7,2,7": 2, "7,3,7": 3, "7,4,7": 4, "7,5,7": 5, "7,6,7": 6,
    "7,1,0": 0, "7,2,0": 0, "7,3,0": 0, "7,4,0": 0, "7,5,0": 0, "7,6,0": 0,

    // Reglas cuando el centro es 0 (vacío) y derecha es 7 (bloqueo) - permanece vacío
    "0,0,7": 0, "1,0,7": 1, "2,0,7": 2, "3,0,7": 3, "4,0,7": 4, "5,0,7": 5, "6,0,7": 6, "7,0,7": 0
};

// Tipos de conexión
const TIPOS_CONEXION = {
    LINEAL: "lineal",
    INCORPORACION: "incorporacion",
    PROBABILISTICA: "probabilistica"
};

// AGREGAR: Tipos de arreglos
const TIPOS = {
    GENERADOR: "generador",
    CONEXION: "conexion",
    DEVORADOR: "devorador"
};

// Variables para el modificador de calles
const selectCalle = document.getElementById("selectCalle");
const inputProbabilidadGeneracion = document.getElementById("inputProbabilidadGeneracion");
const inputProbabilidadSalto = document.getElementById("inputProbabilidadSalto");
const btnActualizarCalle = document.getElementById("btnActualizarCalle");

let animationId; // Variable para guardar el ID de la animación
let tiempoAnterior = 0;
let intervaloDeseado = 125; // Intervalo en milisegundos (125ms = ~8 frames por segundo)

let isPaused = false;
const minVelocidadSlider = 1;
const maxVelocidadSlider = 100;
const maxIntervalo = 250;  // 250ms = 4 veces más rápido que antes (era 1000ms)
const minIntervalo = 0;    // 0ms = velocidad máxima (1 frame sin delay)

// Configuración
let calles = [];
let conexiones = [];
const celda_tamano = 5;
let escala = 1;
let offsetX = 0, offsetY = 0;
let isDragging = false, startX, startY;
let hasDragged = false;
const DRAG_THRESHOLD = 5; // Píxeles mínimos de movimiento para considerar un drag real
let dragStartMouseX = 0, dragStartMouseY = 0; // Posición inicial del mouse para medir distancia
let lastTouchX, lastTouchY;
// Variables para zoom con pinch (pellizco)
let initialPinchDistance = 0;
let lastPinchDistance = 0;
let isPinching = false;
let calleSeleccionada = null; // Variable para almacenar la calle seleccionada

// Variables para arrastre de calles con SHIFT
let isDraggingStreet = false;
let draggedStreet = null;
let dragStreetStartX = 0;
let dragStreetStartY = 0;
let dragStreetInitialX = 0;
let dragStreetInitialY = 0;
let probabilidadGeneracionGeneral = 0.5;

// Variables globales expuestas para el editor
window.calles = calles;
window.conexiones = conexiones; // IMPORTANTE: Exponer para que constructor.js pueda acceder
window.calleSeleccionada = null;
window.isPaused = false;
window.escala = escala;
window.offsetX = offsetX;
window.offsetY = offsetY;
window.celda_tamano = celda_tamano;
window.renderizarCanvas = renderizarCanvas;
window.modoSeleccion = "configuracion"; // Para diferenciar entre "configuracion" y "constructor"

// Cargar las imágenes de los 6 tipos de carros
const carroImgs = [];
for (let i = 1; i <= 6; i++) {
    const img = new Image();
    img.src = i === 1 ? "assets/images/vehicles/carro.png" : `assets/images/vehicles/carro${i}.png`;
    carroImgs.push(img);
}

// Función para obtener la imagen según el tipo de vehículo
function obtenerImagenVehiculo(tipo) {
    const indice = tipo - 1; // tipo 1 = índice 0, tipo 6 = índice 5
    if (indice >= 0 && indice < carroImgs.length) {
        return carroImgs[indice];
    }
    return carroImgs[0]; // Fallback a carro.png
}

// Mantener compatibilidad con código antiguo
const carroImg = carroImgs[0];

// Cargar la imagen del carretera
const carreteraImg = new Image();
carreteraImg.src = "assets/images/roads/carretera.png";

// Cargar la imagen del cono
const conoImg = new Image();
conoImg.src = "assets/images/objects/cono.png";

// Cargar la imagen de ESCOM
const escomImg = new Image();
escomImg.src = "assets/images/buildings/ESCOM.png";

// Cargar la imagen de CIC
const cicImg = new Image();
cicImg.src = "assets/images/buildings/CIC.png";

// Cargar la imagen del Planetario
const planetarioImg = new Image();
planetarioImg.src = "assets/images/buildings/planetario.png";

// Cargar la imagen de Torres Lindavista
const torresLindavistaImg = new Image();
torresLindavistaImg.src = "assets/images/buildings/torres_lindavista.png";

// Cargar la imagen de Alberca
const albercaImg = new Image();
albercaImg.src = "assets/images/buildings/ALBERCA.png";

// Cargar la imagen de CFIE
const cfieImg = new Image();
cfieImg.src = "assets/images/buildings/C.F.I.E.png";

// Cargar la imagen de Campo Burros Blancos
const campoBurrosImg = new Image();
campoBurrosImg.src = "assets/images/buildings/CAMPO BURROS BLANCOS ESTADIO WILFRIDO MASSIEU.png";

// Cargar la imagen de Establo de Burros
const establoBurrosImg = new Image();
establoBurrosImg.src = "assets/images/buildings/establo de burros.png";

// Cargar la imagen de Centro Cultural JTB
const centroCulturalImg = new Image();
centroCulturalImg.src = "assets/images/buildings/CENTRO CULTURAL JTB.png";

// Cargar la imagen de Dirección General
const direccionGeneralImg = new Image();
direccionGeneralImg.src = "assets/images/buildings/Dirección General.png";

// Cargar la imagen de Edificio Inteligente
const edificioInteligenteImg = new Image();
edificioInteligenteImg.src = "assets/images/buildings/EDIFICIO INTELIGENTE.png";

// Cargar la imagen de ESIME ESIQIE ESFM
const esimeImg = new Image();
esimeImg.src = "assets/images/buildings/ESIME ESIQIE ESFM ETC.png";

// Cargar la imagen de Estadio Americano
const estadioAmericanoImg = new Image();
estadioAmericanoImg.src = "assets/images/buildings/ESTADIO AMERICANO.png";

// Cargar la imagen de Estadio Americano Minis (usar la misma imagen que Estadio Americano)
const estadioMinisImg = new Image();
estadioMinisImg.src = "assets/images/buildings/ESTADIO AMERICANO.png";

// Cargar la imagen de Campo Beisbol
const campoBeisbolImg = new Image();
campoBeisbolImg.src = "assets/images/buildings/campo beisbol.png";

// Cargar la imagen de Campo ESCOM
const campoEscomImg = new Image();
campoEscomImg.src = "assets/images/buildings/campo escom.png";

// Cargar la imagen de Ciclovía
const cicloviaImg = new Image();
cicloviaImg.src = "assets/images/buildings/ciclovia.png";

// Mapeo de labels a imágenes (definido globalmente para eficiencia)
const buildingImageMap = {
    "CONO": conoImg,
    "ESCOM": escomImg,
    "CIC": cicImg,
    "PLANETARIO": planetarioImg,
    "PLAZA TORRES LINDAVISTA": torresLindavistaImg,
    "Alberca": albercaImg,
    "C.F.I.E": cfieImg,
    "CAMPO BURROS BLANCOS": campoBurrosImg,
    "ESTABLO DE BURROS": establoBurrosImg,
    "CENTRO CULTURAL JTB": centroCulturalImg,
    "DIRECCIÓN GENERAL": direccionGeneralImg,
    "EDIFICIO INTELIGENTE": edificioInteligenteImg,
    "ESTADIO AMERICANO": estadioAmericanoImg,
    // Edificios ESIME - todos usan la misma imagen
    "ESIME": esimeImg,
    "ESIME Edificio 2": esimeImg,
    "ESIME Edificio 3": esimeImg,
    "ESIME Edificio 4": esimeImg,
    "ESIME Edificio 5": esimeImg,
    "ESFM": esimeImg,
    "ESIQIE Edificio 7": esimeImg,
    "ESIQIE Edificio 8": esimeImg,
    "ESIQUIE": esimeImg,
    "ESIA": esimeImg,
    // Edificios administrativos que usan imagen de CIC
    "POI-IPN": cicImg,
    "OIC-IPN": cicImg,
    "SAD-IPN": cicImg,
    "SIIS-IPN": cicImg,
    "SECADEMICA-IPN": cicImg,
    // Campos deportivos
    "BEISBOL": campoBeisbolImg,
    "CAMPO ESCOM": campoEscomImg,
    "ciclovía": cicloviaImg
};

// ========== ÁREAS DE FONDO (RENDERIZADAS CON PIXI.GRAPHICS) ==========
// Estas áreas se renderizan DEBAJO de todos los edificios y calles
// OPTIMIZADO: Convierte Graphics a textura estática (Sprite) y se renderiza UNA SOLA VEZ
// Cada área puede ser un polígono (vertices: [{x, y}, ...]) o rectángulo (x, y, width, height)
const backgroundAreas = [
    {
        label: "Área IPN/Politécnico",
        // Polígono con 8 vértices que define el área del Politécnico
        vertices: [
           { x: 848, y: 1089 },   // Vértice 1 (arriba izquierda)
           { x: 917, y: 765 },  // Vértice 2 (arriba derecha)
           { x: 1395, y: 847 },  // Vértice 2 (arriba derecha)
           { x: 1418, y: 552 },  // Vértice 2 (arriba derecha)
            { x: 1873, y: 352 },  // Vértice 2 (arriba derecha)
            { x: 2401, y: 895 }, // Vértice 3 (derecha arriba)
            { x: 2405, y: 1027 }, // Vértice 4 (derecha abajo)
            { x: 2763, y: 1091 }, // Vértice 5 (abajo derecha)
            { x: 2594, y: 2008 },  // Vértice 6 (abajo izquierda)
            { x: 1816, y: 1810 },  // Vértice 7 (izquierda abajo)
            //{ x: 1847, y: 364 },  // Vértice 7 (izquierda abajo)
            { x: 981, y: 1455 }    // Vértice 8 (izquierda arriba)
        ],
        color: "#ffffffff",  // Beige claro (color de referencia visual del IPN)
        alpha: 0.25,       // 25% de opacidad (semi-transparente)
        showBorder: true,  // Mostrar borde para delimitar el área
        showLabel: false   // No mostrar label (solo es referencia visual)
    }
];

// ========== LISTA DE EDIFICIOS COMPLETA (DESDE TRAFICO.TXT) ==========
const edificios = [

    // ========== ZONA SUPERIOR IZQUIERDA (cerca de Av. Miguel Othon de Mendizabal) ==========

     // Ciclovía
    { x: 1642, y: 1126, width: 500, height: 600, angle: 6, color: "#8B4513", label: "ciclovía" },

    // Torres
    { x: 1239, y: 701, width: 250, height: 120, color: "#29293aff", angle: 334, label: "PLAZA TORRES LINDAVISTA" },

    // ESCOM
    { x: 1030, y: 887, width: 95, height: 160, color: "#0047a3ff", angle: 350, label: "ESCOM" },
    
    // ESTACIONAMIENTO ESCOM
    { x: 1149, y: 893, width: 180, height: 90, color: "#29293aff", angle: 260, label: "ESTACIONAMIENTO ESCOM", imagen: "estacionamiento" },
    
    // CIC
    { x: 1002, y: 1020, width: 90, height: 90, color: "#0047a3ff", angle: 350, label: "CIC" },

    // ESTACIONAMIENTO CIC
    { x: 916, y: 997, width: 200, height: 90, color: "#29293aff", angle: 260, label: "ESTACIONAMIENTO CIC", imagen: "estacionamiento" },

    // CIDETEC (Centro de Investigación y Desarrollo Tecnológico) - Abajo del CIC
    { x: 1096, y: 1049, width: 90, height: 80, color: "#0047a3ff", angle: 350, label: "CIDETEC", imagen: "cidetec" },

    // CENDI (Centro de Desarrollo Infantil) - Abajo del CIC
    { x: 978, y: 1118, width: 80, height: 80, color: "#0047a3ff", angle: 350, label: "CENDI", imagen: "cic" },


    { x: 1343, y: 866, width: 80, height: 50, color: "#0047a3ff", angle: 170, label: "ESTABLO DE BURROS" },
    
     { x: 1239, y: 908, width: 180, height: 100, color: "#164916ff", angle: 260, label: "CAMPO ESCOM" },

    { x: 1995.393855899274, y: 1096.8181821738842, width: 154, height: 270, color: "#164916ff", angle: 168.0117148460054, label: "CAMPO BURROS BLANCOS" }, //9:16

    // Campo de Tiro con Arco
    { x: 1573, y: 1114, width: 100, height: 80, color: "#164916ff", angle: 78.13398190908356, label: "CAMPO TIRO CON ARCO", imagen: "campo tiro con arco" },

    // Campo de Beisbol
    { x: 1974, y: 1273, width: 160, height: 80, color: "#29293aff", angle: 350, label: "ESTACIONAMIENTO", imagen: "estacionamiento" },
    { x: 1963, y: 1413, width: 150, height: 200, color: "#164916ff", angle: 350, label: "BEISBOL" },
    { x: 1923, y: 1548, width: 160, height: 80, color: "#29293aff", angle: 350, label: "ESTACIONAMIENTO", imagen: "estacionamiento" },
 
    
    { x: 1688, y: 1662, width: 140, height: 140, color: "#0047a3ff", angle: 350, label: "C.F.I.E" },

    // ENCB (Escuela Nacional de Ciencias Biológicas)
    { x: 1392, y: 1529, width: 100, height: 80, color: "#0047a3ff", angle: 350, label: "ENCB", imagen: "cic" },

    // UPIEM (Unidad Profesional Interdisciplinaria en Ingeniería y Tecnologías Avanzadas)
    { x: 1597.7574987652351, y: 1560.6969323672001, width: 100, height: 80, color: "#0047a3ff", angle: 73.49923484301729, label: "UPIEM", imagen: "cic" },

    // CONO
    { x: 1937, y: 905, width: 45, height: 45, color: "#0d0e10ff", angle: 352, label: "CONO" },


    // ========== ZONA CENTRAL (entre Luis Enrique Erro y Miguel Anda y Barredo) ==========
    // Estadio Americano
    { x: 1750, y: 1060, width: 240, height: 170, color: "#164916ff", angle: 260, label: "ESTADIO AMERICANO" },
    
    // Alberca
     { x: 2136, y: 1497, width: 110, height: 110, color: "#4169E1", angle: 259, label: "Alberca" },
    
    // Gimnasio
    { x: 1918, y: 1648, width: 90, height: 90, color: "#8b4513", angle: 33, label: "GIMNASIO", imagen: "gimnasio" },

   

    // PLANETARIO
    { x: 1876, y: 1740, width: 100, height: 100, color: "#4b0000ff", angle: 350, label: "PLANETARIO" },
    
    // CENLEX
    { x: 2050, y: 1689, width: 70, height: 45, color: "#8b4513", angle: 350, label: "CENLEX", imagen: "cenlex" },

    { x: 1605, y: 540, width: 70, height: 70, color: "#29293aff", angle: 350, label: "OIC-IPN" },
    { x: 1456, y: 605, width: 70, height: 70, color: "#8b7355", angle: 350, label: "POI-IPN" },
    { x: 1756, y: 466, width: 70, height: 70, color: "#29293aff", angle: 350, label: "SAD-IPN" },
    { x: 1734, y: 600, width: 90, height: 90, color: "#8b7355", angle: 350, label: "DIRECCIÓN GENERAL" },
    { x: 1819, y: 810, width: 70, height: 70, color: "#8b7355", angle: 350, label: "SIIS-IPN" },
    { x: 1444, y: 746, width: 70, height: 70, color: "#8b7355", angle: 350, label: "EDIFICIO INTELIGENTE" },
    { x: 1623, y: 760, width: 70, height: 70, color: "#8b7355", angle: 350, label: "SECADEMICA-IPN" },
    


    // ========== ZONA DERECHA (entre Av. IPN) ==========
  
    { x: 2398, y: 1083, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESFM" },
    { x: 2386, y: 1150, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIQIE Edificio 8" },
    { x: 2376, y: 1209, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIQIE Edificio 7" },
    { x: 2367, y: 1270, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIQUIE" },
    { x: 2352, y: 1343, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIME Edificio 5" },
    { x: 2344, y: 1413, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIME Edificio 4" },
    { x: 2331, y: 1488, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIME Edificio 3" },
    { x: 2319, y: 1562, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIME Edificio 2" },
    { x: 2306, y: 1632, width: 70, height: 70, color: "#4b0000ff", angle: 350, label: "ESIME" },
    { x: 2584, y: 1370, width: 90, height: 90, color: "#57126fff", angle: 296, label: "EST", imagen: "est" },
    { x: 2551, y: 1537, width: 140, height: 70, color: "#29293aff", angle: 75, label: "ESTACIONAMIENTO", imagen: "estacionamiento" }, 
    
    // Edificio Z (vertical largo)
    { x: 2216, y: 897, width: 100, height: 100, color: "#4b0000ff", angle: 350, label: "ESIA" },
    
    // Centro Cultural JTB
    { x: 2306, y: 1754, width: 90, height: 60, color: "#8b4513", angle: 350, label: "CENTRO CULTURAL JTB" },

    // BIBLIOTECA (cerca del Centro Cultural JTB)
    { x: 2504, y: 1793, width: 90, height: 70, color: "#0047a3ff", angle: 258, label: "BIBLIOTECA", imagen: "cic" },

    { x: 2399, y: 1904, width: 200, height: 50, color: "#29293aff", angle: 350, label: "ESTACIONAMIENTO", imagen: "estacionamiento" },
];

// Obtener el contexto del minimapa
const minimapaCanvas = document.getElementById("minimapa");
const minimapaCtx = minimapaCanvas.getContext("2d");

// Función auxiliar para calcular parámetros del minimapa (usado por dibujo y detección)
function calcularParametrosMinimapa() {
    // Obtener el tamaño real del elemento HTML del minimapa (definido por CSS responsivo)
    const rect = minimapaCanvas.getBoundingClientRect();
    const minimapaAncho = rect.width;
    const minimapaAlto = rect.height;

    // Calcular la escala del minimapa dinámicamente para que todo el contenido quepa
    const viewport = calcularViewportVisible();

    // Determinar los límites del mundo (todas las calles)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    calles.forEach(calle => {
        const puntos = [
            { x: calle.x, y: calle.y },
            { x: calle.x + calle.tamano * celda_tamano * Math.cos(-calle.angulo * Math.PI / 180),
              y: calle.y + calle.tamano * celda_tamano * Math.sin(-calle.angulo * Math.PI / 180) }
        ];
        puntos.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });
    });

    // Agregar margen
    const margen = 200;
    minX -= margen;
    minY -= margen;
    maxX += margen;
    maxY += margen;

    const mundoAncho = maxX - minX;
    const mundoAlto = maxY - minY;

    // Calcular escala para que quepa todo el contenido con margen
    const minimapaEscala = Math.min(
        (minimapaAncho * 0.8) / mundoAncho,
        (minimapaAlto * 0.8) / mundoAlto
    );

    // Centrar el mundo en el minimapa
    const centroMundoX = (minX + maxX) / 2;
    const centroMundoY = (minY + maxY) / 2;
    const minimapaOffsetX = minimapaAncho / 2 - centroMundoX * minimapaEscala;
    const minimapaOffsetY = minimapaAlto / 2 - centroMundoY * minimapaEscala;

    return {
        minimapaAncho,
        minimapaAlto,
        minimapaEscala,
        minimapaOffsetX,
        minimapaOffsetY,
        viewport
    };
}

// Función para dibujar el minimapa (con los cambios anteriores)
function dibujarMinimapa() {
    const params = calcularParametrosMinimapa();
    const { minimapaAncho, minimapaAlto, minimapaEscala, minimapaOffsetX, minimapaOffsetY, viewport } = params;

    // DEBUG: Log para verificar valores del viewport (comentado para evitar spam en consola)
    // if (Math.random() < 0.01) {
    //     console.log('🗺️ Minimapa Debug:', {
    //         escala: window.escala?.toFixed(2),
    //         viewportAncho: viewport.ancho?.toFixed(0),
    //         viewportAlto: viewport.alto?.toFixed(0),
    //         rectAncho: (viewport.ancho * minimapaEscala)?.toFixed(1),
    //         rectAlto: (viewport.alto * minimapaEscala)?.toFixed(1)
    //     });
    // }

    // Ajustar la resolución interna del canvas para que coincida con su tamaño en pantalla
    // Usar devicePixelRatio para mantener calidad en pantallas de alta densidad
    const dpr = window.devicePixelRatio || 1;

    // Solo redimensionar si cambió el tamaño (para evitar reset constante)
    if (minimapaCanvas.width !== minimapaAncho * dpr || minimapaCanvas.height !== minimapaAlto * dpr) {
        minimapaCanvas.width = minimapaAncho * dpr;
        minimapaCanvas.height = minimapaAlto * dpr;
    }

    // Resetear transformaciones y escalar el contexto para compensar el devicePixelRatio
    minimapaCtx.setTransform(1, 0, 0, 1, 0, 0);
    minimapaCtx.scale(dpr, dpr);

    // Limpiar el minimapa
    minimapaCtx.clearRect(0, 0, minimapaAncho, minimapaAlto);
    // Dibujar el fondo del minimapa
    minimapaCtx.fillStyle = "#767878"; // Color de fondo gris claro
    
    minimapaCtx.fillRect(0, 0, minimapaAncho, minimapaAlto);
    // Aplicar el desplazamiento al minimapa
    minimapaCtx.save();
    minimapaCtx.translate(minimapaOffsetX, minimapaOffsetY);

    // Dibujar las calles en el minimapa (ajustar la escala)
    calles.forEach(calle => {
        minimapaCtx.save();
        minimapaCtx.translate(calle.x * minimapaEscala, calle.y * minimapaEscala);
        minimapaCtx.rotate(-calle.angulo * Math.PI / 180);
        minimapaCtx.fillStyle = "black";
        minimapaCtx.fillRect(0, 0, calle.tamano * celda_tamano * minimapaEscala, calle.carriles * celda_tamano * minimapaEscala);
        minimapaCtx.restore();
    });

    // Dibujar el rectángulo de la vista
    const rectAncho = viewport.ancho * minimapaEscala;
    const rectAlto = viewport.alto * minimapaEscala;
    const rectX = viewport.x * minimapaEscala;
    const rectY = viewport.y * minimapaEscala;

    // Si el rectángulo es muy pequeño, dibujar un área de detección visual COMPLETA
    if (rectAncho < 40 || rectAlto < 40) {
        const areaDeteccionAncho = Math.max(rectAncho, 40);
        const areaDeteccionAlto = Math.max(rectAlto, 40);
        const areaX = rectX - (areaDeteccionAncho - rectAncho) / 2;
        const areaY = rectY - (areaDeteccionAlto - rectAlto) / 2;
        
        // Dibujar área de detección RELLENA con semi-transparencia
        minimapaCtx.fillStyle = "rgba(255, 100, 100, 0.3)";
        minimapaCtx.fillRect(areaX, areaY, areaDeteccionAncho, areaDeteccionAlto);

        // Dibujar borde del área de detección
        minimapaCtx.strokeStyle = "rgba(255, 100, 100, 0.7)";
        minimapaCtx.lineWidth = 1;
        minimapaCtx.setLineDash([4, 4]);
        minimapaCtx.strokeRect(areaX, areaY, areaDeteccionAncho, areaDeteccionAlto);
        minimapaCtx.setLineDash([]);
    }

    // Dibujar relleno semi-transparente del rectángulo real para indicar que es arrastrable
    minimapaCtx.fillStyle = "rgba(255, 0, 0, 0.2)";
    minimapaCtx.fillRect(rectX, rectY, rectAncho, rectAlto);

    // Dibujar el contorno del rectángulo de la vista
    minimapaCtx.strokeStyle = "red";
    minimapaCtx.lineWidth = 2;
    minimapaCtx.strokeRect(rectX, rectY, rectAncho, rectAlto);

    minimapaCtx.restore();
}

// Evento para guardar la calle seleccionada y mostrar valores en los inputs
selectCalle.addEventListener("change", () => {
    const calleIndex = selectCalle.value;
    const campoGeneracion = document.getElementById('campoGeneracionConfig');

    if (calleIndex !== "") {
        calleSeleccionada = calles[calleIndex];
        window.calleSeleccionada = calleSeleccionada; // Exponer globalmente

        // Mostrar u ocultar campo de probabilidad de generación según el tipo
        if (calleSeleccionada.tipo === TIPOS.GENERADOR) {
            campoGeneracion.style.display = 'block';
            inputProbabilidadGeneracion.value = calleSeleccionada.probabilidadGeneracion * 100; // Conversión a porcentaje
        } else {
            // Ocultar para calles de tipo CONEXION y DEVORADOR
            campoGeneracion.style.display = 'none';
            inputProbabilidadGeneracion.value = 0; // Resetear valor
        }

        // Mostrar valor de probabilidad de salto (siempre visible)
        inputProbabilidadSalto.value = calleSeleccionada.probabilidadSaltoDeCarril * 100; // Conversión a porcentaje
    } else {
        calleSeleccionada = null;
        window.calleSeleccionada = null;
        campoGeneracion.style.display = 'none';
    }
    renderizarCanvas();
});

// Función para crear una calle con posición, ángulo y tamaño
function crearCalle(nombre, tamano, tipo, x, y, angulo, probabilidadGeneracion, carriles = 1, probabilidadSaltoDeCarril = 0.05) {
    let calle = {
        id: nombre, // ID único basado en el nombre
        nombre: nombre,
        tamano: tamano,
        tipo: tipo,
        probabilidadGeneracion: probabilidadGeneracion,
        arreglo: [],
        celulasEsperando: [],
        conexionesSalida: [],
        x: x,
        y: y,
        angulo: angulo,
        carriles: carriles,
        probabilidadSaltoDeCarril: probabilidadSaltoDeCarril,
        // NUEVAS PROPIEDADES PARA CURVAS
        vertices: [],  // Array de vértices para crear curvas
        esCurva: false // Indica si la calle tiene curva activa
    };

    // Creamos la matriz (arreglo 2D) y estructuras de control
    for (let i = 0; i < carriles; i++) {
        calle.arreglo.push(new Array(tamano).fill(0));
        calle.celulasEsperando.push(new Array(tamano).fill(false));
        calle.conexionesSalida.push([]);
    }

    // Inicialización SOLO si es GENERADOR
    if (tipo === TIPOS.GENERADOR) {
        for (let i = 0; i < carriles; i++) {
            for (let j = 0; j < tamano; j++) {
                calle.arreglo[i][j] = Math.random() < 0.1 ? 1 : 0;
            }
        }
    }

    // Inicializar vértices automáticamente para calles tipo CONEXION, GENERADOR y DEVORADOR
    if (tipo === TIPOS.CONEXION || tipo === TIPOS.GENERADOR || tipo === TIPOS.DEVORADOR) {
        inicializarVertices(calle);
    }

    calles.push(calle);
    return calle;
}


// Clase para conexiones multi-carril
class ConexionCA {
    constructor(origen, destino, carrilOrigen, carrilDestino, posOrigen = -1, posDestino = 0, probabilidadTransferencia = 1.0, tipo = TIPOS_CONEXION.LINEAL) {
        this.origen = origen;
        this.destino = destino;
        this.carrilOrigen = carrilOrigen;
        this.carrilDestino = carrilDestino;
        this.posOrigen = posOrigen;
        this.posDestino = posDestino;
        this.probabilidadTransferencia = probabilidadTransferencia;
        this.tipo = tipo;
        this.bloqueada = false;
        this.esConexionIntermedia = posOrigen !== -1 && posOrigen !== origen.tamano - 1;
    }

    transferir() {
        const posOrig = this.posOrigen === -1 ? this.origen.tamano - 1 : this.posOrigen;

        this.bloqueada = false;

        const vehiculoOrigen = this.origen.arreglo[this.carrilOrigen][posOrig];

        if (vehiculoOrigen > 0) {

            // Para conexiones probabilísticas, aplicar probabilidad
            if (this.tipo === TIPOS_CONEXION.PROBABILISTICA) {
                const seTransfiere = Math.random() < this.probabilidadTransferencia;

                if (!seTransfiere) {
                    // console.log(`🎲 CONEXIÓN: Vehículo tipo ${vehiculoOrigen} en [${this.origen.nombre}][Carril ${this.carrilOrigen}, Pos ${posOrig}] NO se transfiere (probabilidad ${this.probabilidadTransferencia})`);
                    return false;
                }
            }

            // Verificar si destino está ocupado
            if (this.destino.arreglo[this.carrilDestino][this.posDestino] > 0) {
                this.bloqueada = true;
                this.origen.celulasEsperando[this.carrilOrigen][posOrig] = true;
                // console.log(`🔴 CONEXIÓN BLOQUEADA: [${this.origen.nombre}][Carril ${this.carrilOrigen}, Pos ${posOrig}] → [${this.destino.nombre}][Carril ${this.carrilDestino}, Pos ${this.posDestino}] - Destino ocupado`);
                return false;
            } else {
                if (!this.origen.celulasEsperando[this.carrilOrigen][posOrig]) {
                    // Transferir el tipo de vehículo
                    this.destino.arreglo[this.carrilDestino][this.posDestino] = vehiculoOrigen;
                    this.origen.arreglo[this.carrilOrigen][posOrig] = 0;
                    // console.log(`✅ CONEXIÓN EXITOSA: Vehículo tipo ${vehiculoOrigen} de [${this.origen.nombre}][Carril ${this.carrilOrigen}, Pos ${posOrig}] → [${this.destino.nombre}][Carril ${this.carrilDestino}, Pos ${this.posDestino}]`);
                    return true;
                } else {
                    // console.log(`⏸️ CONEXIÓN: Vehículo tipo ${vehiculoOrigen} en [${this.origen.nombre}][Carril ${this.carrilOrigen}, Pos ${posOrig}] está esperando`);
                    return false;
                }
            }
        }
        return false;
    }

    dibujar() {
        const posOrig = this.posOrigen === -1 ? this.origen.tamano - 1 : this.posOrigen;

        // Calcular coordenadas del origen (usar función correcta según si es curva o no)
        let coordOrigen;
        if (this.origen.esCurva && this.origen.vertices && this.origen.vertices.length > 0) {
            if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva === 'function') {
                coordOrigen = window.obtenerCoordenadasGlobalesCeldaConCurva(this.origen, this.carrilOrigen, posOrig);
            } else {
                coordOrigen = obtenerCoordenadasGlobalesCelda(this.origen, this.carrilOrigen, posOrig);
            }
        } else {
            coordOrigen = obtenerCoordenadasGlobalesCelda(this.origen, this.carrilOrigen, posOrig);
        }

        // Calcular coordenadas del destino (usar función correcta según si es curva o no)
        let coordDestino;
        if (this.destino.esCurva && this.destino.vertices && this.destino.vertices.length > 0) {
            if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva === 'function') {
                coordDestino = window.obtenerCoordenadasGlobalesCeldaConCurva(this.destino, this.carrilDestino, this.posDestino);
            } else {
                coordDestino = obtenerCoordenadasGlobalesCelda(this.destino, this.carrilDestino, this.posDestino);
            }
        } else {
            coordDestino = obtenerCoordenadasGlobalesCelda(this.destino, this.carrilDestino, this.posDestino);
        }
        
        const x1 = coordOrigen.x;
        const y1 = coordOrigen.y;
        const x2 = coordDestino.x;
        const y2 = coordDestino.y;

        // Color según tipo
        let colorLinea = "#6bff8bff"; // Verde para conexiones lineales
        if (this.bloqueada) {
            colorLinea = "#FF3333"; // Rojo para bloqueadas
        } else if (this.tipo === TIPOS_CONEXION.PROBABILISTICA) {
            colorLinea = "#9966FF"; // Morado para probabilísticas
        } else if (this.tipo === TIPOS_CONEXION.INCORPORACION) {
            colorLinea = "#FF8C00"; // Naranja para incorporación
        }
        
        ctx.strokeStyle = colorLinea;
        ctx.lineWidth = this.bloqueada ? 1.5 : 1;
        
        // Patrón de línea
        if (this.tipo === TIPOS_CONEXION.PROBABILISTICA) {
            ctx.setLineDash([3, 3]);
        } else if (this.tipo === TIPOS_CONEXION.INCORPORACION) {
            ctx.setLineDash([5, 3]);
        } else {
            ctx.setLineDash(this.bloqueada ? [2, 2] : []);
        }
        
        // Dibujar línea
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        
        // Dibujar flecha en el destino
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLength = 6;
        
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowLength * Math.cos(angle - Math.PI/6), 
                   y2 - arrowLength * Math.sin(angle - Math.PI/6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowLength * Math.cos(angle + Math.PI/6), 
                   y2 - arrowLength * Math.sin(angle + Math.PI/6));
        ctx.stroke();
        
        // Indicadores visuales en el punto medio
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        
        if (this.bloqueada) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.beginPath();
            ctx.arc(midX, midY, 8, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.strokeStyle = "#FF0000";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(midX - 4, midY - 4);
            ctx.lineTo(midX + 4, midY + 4);
            ctx.moveTo(midX + 4, midY - 4);
            ctx.lineTo(midX - 4, midY + 4);
            ctx.stroke();
        } else if (this.tipo === TIPOS_CONEXION.PROBABILISTICA) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.beginPath();
            ctx.arc(midX, midY, 1, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.strokeStyle = "#9966FF";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(midX, midY, 1, 0, 2 * Math.PI);
            ctx.stroke();
            
            ctx.fillStyle = "#9966FF";
            ctx.font = "bold 1px Arial";
            ctx.textAlign = "center";
            ctx.fillText("%", midX, midY + 3);
            
            ctx.font = "7px Arial";
            ctx.fillText(`${Math.round(this.probabilidadTransferencia * 100)}%`, midX, midY + 18);
            ctx.textAlign = "left";
        } else if (this.tipo === TIPOS_CONEXION.INCORPORACION) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.beginPath();
            ctx.arc(midX, midY, 1, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.strokeStyle = "#FF8C00";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(midX, midY, 1, 0, 2 * Math.PI);
            ctx.stroke();
            
            ctx.fillStyle = "#FF8C00";
            ctx.font = "bold 8px Arial";
            ctx.textAlign = "center";
            ctx.fillText("I", midX, midY + 3);
            ctx.textAlign = "left";
        }
        
        // Restaurar configuración del contexto
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
    }
}

// Calcula las coordenadas globales del CENTRO de una celda específica.
function obtenerCoordenadasGlobalesCelda(calle, carril, indice) {
    const localX = (indice + 0.5) * celda_tamano;
    const localY = (carril + 0.5) * celda_tamano;

    const anguloRad = -calle.angulo * Math.PI / 180;
    const cos = Math.cos(anguloRad);
    const sin = Math.sin(anguloRad);
    const rotadoX = localX * cos - localY * sin;
    const rotadoY = localX * sin + localY * cos;

    return {
        x: rotadoX + calle.x,
        y: rotadoY + calle.y
    };
}

// Calcula la distancia euclidiana entre dos puntos.
function distancia(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}





function marcarCelulaEsperando(calle, carril, posicion) {
    calle.celulasEsperando[carril][posicion] = true;
}

function tieneConexionSalida(calle, carril, posicion) {
    return calle.conexionesSalida[carril].some(conexion => {
        const posOrig = conexion.posOrigen === -1 ? calle.tamano - 1 : conexion.posOrigen;
        if (posOrig === posicion) {
            if (conexion.tipo === TIPOS_CONEXION.PROBABILISTICA) {
                return calle.celulasEsperando[carril][posicion];
            }
            return true;
        }
        return false;
    });
}

// Función para generar células en arreglos GENERADOR
function generarCelulas(calle) {
    if (calle.tipo === TIPOS.GENERADOR) {
        // Aplicar multiplicador de tiempo si está activo
        let probEfectiva = calle.probabilidadGeneracion;
        if (window.configuracionTiempo?.usarPerfiles && window.obtenerMultiplicadorTrafico) {
            const multiplicador = window.obtenerMultiplicadorTrafico();
            probEfectiva *= multiplicador;
        }

        for (let carril = 0; carril < calle.carriles; carril++) {
            if (calle.arreglo[carril][0] === 0 && Math.random() < probEfectiva) {
                // Generar tipo aleatorio de vehículo (1-6)
                const tipoVehiculo = Math.floor(Math.random() * 6) + 1;
                calle.arreglo[carril][0] = tipoVehiculo;
                // console.log(`🏭 Generador "${calle.nombre}": Vehículo tipo ${tipoVehiculo} en carril ${carril + 1}, posición 0`);
            }
        }
    }
}

function actualizarCalle(calle, calleIndex) {
    let nuevaCalle = [];
    for (let c = 0; c < calle.carriles; c++) {
        nuevaCalle.push([...calle.arreglo[c]]);
    }

    // Aplicar reglas CA
    for (let c = 0; c < calle.carriles; c++) {
        if (!calle.arreglo?.[c] || !nuevaCalle?.[c] || calle.arreglo[c].length !== calle.tamano) continue;
        if (calle.tamano <= 1) continue;

        for (let i = 0; i < calle.tamano; i++) {
            // Si la celda está esperando, NO procesarla
            if (calle.celulasEsperando[c][i]) {
                nuevaCalle[c][i] = calle.arreglo[c][i];
                if (calle.arreglo[c][i] > 0) {
                    // console.log(`⏸️ CA: [${calle.nombre}][Carril ${c}, Pos ${i}] Vehículo tipo ${calle.arreglo[c][i]} está esperando (celda bloqueada)`);
                }
                continue;
            }

            // ========== PROCESAMIENTO DE ESTACIONAMIENTOS ==========
            // Verificar si esta celda tiene una conexión de estacionamiento
            if (calle.conexionesEstacionamiento) {
                const claveConexion = `${c}-${i}`;
                const conexion = calle.conexionesEstacionamiento.get(claveConexion);

                if (conexion) {
                    const edificio = conexion.edificio;

                    if (conexion.tipo === 'entrada' && edificio && edificio.esEstacionamiento) {
                        // ENTRADA: Verificar si hay un vehículo en esta celda O en la celda anterior
                        const vehiculoEnCelda = calle.arreglo[c][i];
                        const vehiculoEnCeldaAnterior = (i > 0) ? calle.arreglo[c][i - 1] : 0;

                        // Procesar vehículo en la celda de entrada
                        if (vehiculoEnCelda >= 1 && vehiculoEnCelda <= 6) {
                            // console.log(`🔍 ENTRADA DETECTADA: Vehículo tipo ${vehiculoEnCelda} en celda de entrada [${c},${i}] de "${edificio.label}"`);

                            // Obtener hora actual del simulador
                            const horaActual = window.configuracionTiempo?.horaActual || 0;

                            // Intentar absorber el vehículo con probabilidad
                            const absorbido = window.procesarEntradaVehiculo?.(edificio, vehiculoEnCelda, horaActual);
                            // console.log(`🎲 PROBABILIDAD ENTRADA: ${absorbido ? 'ACEPTADO' : 'RECHAZADO'} para "${edificio.label}"`);

                            if (absorbido) {
                                // Vehículo absorbido - eliminar de la celda actual
                                nuevaCalle[c][i] = 0;
                                // console.log(`✅ ENTRADA EXITOSA: Vehículo tipo ${vehiculoEnCelda} absorbido por "${edificio.label}" en [${c},${i}] - Celda eliminada`);
                                continue;
                            } else {
                                // console.log(`❌ ENTRADA RECHAZADA: Vehículo tipo ${vehiculoEnCelda} NO fue absorbido por "${edificio.label}" - sigue su camino`);
                            }
                        }
                        // Procesar vehículo que está LLEGANDO a la entrada (en celda anterior)
                        else if (vehiculoEnCeldaAnterior >= 1 && vehiculoEnCeldaAnterior <= 6 && vehiculoEnCelda === 0) {
                            // console.log(`🔍 ENTRADA ANTICIPADA: Vehículo tipo ${vehiculoEnCeldaAnterior} en celda anterior [${c},${i-1}] acercándose a entrada de "${edificio.label}"`);

                            // Obtener hora actual del simulador
                            const horaActual = window.configuracionTiempo?.horaActual || 0;

                            // Intentar absorber el vehículo con probabilidad
                            const absorbido = window.procesarEntradaVehiculo?.(edificio, vehiculoEnCeldaAnterior, horaActual);
                            // console.log(`🎲 PROBABILIDAD ENTRADA ANTICIPADA: ${absorbido ? 'ACEPTADO' : 'RECHAZADO'} para "${edificio.label}"`);

                            if (absorbido) {
                                // Vehículo absorbido - eliminar de la celda ANTERIOR y marcar entrada como vacía
                                if (i > 0) {
                                    nuevaCalle[c][i - 1] = 0;
                                }
                                nuevaCalle[c][i] = 0;
                                // console.log(`✅ ENTRADA ANTICIPADA EXITOSA: Vehículo tipo ${vehiculoEnCeldaAnterior} absorbido desde [${c},${i-1}] por "${edificio.label}"`);
                                continue;
                            }
                        }
                    } else if (conexion.tipo === 'salida' && edificio && edificio.esEstacionamiento) {
                        // SALIDA: Verificar si la celda de salida Y la celda ANTERIOR están vacías
                        const celdaSalidaVacia = calle.arreglo[c][i] === 0;
                        const celdaAnteriorVacia = (i > 0) ? calle.arreglo[c][i - 1] === 0 : true;

                        // Solo generar vehículo si ambas celdas están vacías (para evitar colisiones)
                        if (celdaSalidaVacia && celdaAnteriorVacia) {
                            // Obtener hora actual del simulador
                            const horaActual = window.configuracionTiempo?.horaActual || 0;

                            // Intentar generar un vehículo con probabilidad
                            const tipoVehiculo = window.intentarGenerarSalida?.(edificio, horaActual);

                            if (tipoVehiculo !== null) {
                                // Vehículo generado - colocarlo en esta celda
                                nuevaCalle[c][i] = tipoVehiculo;
                                // console.log(`✅ SALIDA EXITOSA: Vehículo tipo ${tipoVehiculo} generado desde "${edificio.label}" en [${c},${i}]`);
                                continue;
                            }
                        } else if (!celdaAnteriorVacia) {
                            // console.log(`⏸️ SALIDA BLOQUEADA: No se puede generar salida en "${edificio.label}" [${c},${i}] - celda anterior [${i-1}] ocupada`);
                        }
                    }
                }
            }
            // ========== FIN PROCESAMIENTO DE ESTACIONAMIENTOS ==========

            // Si tiene conexión de salida, no mover
            if (tieneConexionSalida(calle, c, i) && calle.arreglo[c][i] > 0) {
                nuevaCalle[c][i] = calle.arreglo[c][i];
                // console.log(`🔗 CA: [${calle.nombre}][Carril ${c}, Pos ${i}] Vehículo tipo ${calle.arreglo[c][i]} esperando en conexión de salida`);
                continue;
            }

            // Obtener valores de celdas vecinas
            let izq = i > 0 ? calle.arreglo[c][i - 1] : 0;
            const centro = calle.arreglo[c][i];
            let der = i < calle.tamano - 1 ? calle.arreglo[c][i + 1] : 0;

            // IMPORTANTE: Si la celda izquierda está esperando, tratarla como vacía
            // para evitar que se "copie" el vehículo a la celda actual
            if (i > 0 && calle.celulasEsperando[c][i - 1]) {
                izq = 0;
            }

            // IMPORTANTE: Si la celda derecha está esperando, tratarla como ocupada
            // para evitar que el vehículo actual intente moverse ahí
            // (esto ya se maneja implícitamente, pero lo hacemos explícito)

            const patron = `${izq},${centro},${der}`;
            const resultadoRegla = reglas[patron];

            if (resultadoRegla !== undefined) {
                // ✅ PRESERVAR TIPO DE VEHÍCULO
                // Si la regla dice que debe haber un vehículo (>0), usar el tipo original
                if (resultadoRegla > 0 && centro > 0) {
                    nuevaCalle[c][i] = centro; // Mantener el tipo original

                    // Log solo si el vehículo se movió (cambió de posición)
                    if (izq > 0 && resultadoRegla > 0) {
                        // console.log(`🚗 CA: [${calle.nombre}][Carril ${c}, Pos ${i}] Patrón[${patron}] → Vehículo tipo ${centro} avanza desde pos ${i-1}`);
                    }
                } else {
                    nuevaCalle[c][i] = resultadoRegla;

                    // Log cuando una celda cambia de estado
                    if (centro !== resultadoRegla) {
                        if (resultadoRegla === 0 && centro > 0) {
                            // console.log(`🚗 CA: [${calle.nombre}][Carril ${c}, Pos ${i}] Patrón[${patron}] → Vehículo tipo ${centro} sale de la celda`);
                        } else if (resultadoRegla > 0 && centro === 0) {
                            // console.log(`🚗 CA: [${calle.nombre}][Carril ${c}, Pos ${i}] Patrón[${patron}] → Vehículo llega a celda vacía`);
                        }
                    }
                }
            } else {
                nuevaCalle[c][i] = centro;
            }
        }
    }

    calle.arreglo = nuevaCalle;
    
    // Limpiar flags de espera
    for (let c = 0; c < calle.carriles; c++) {
        calle.celulasEsperando[c].fill(false);
    }

    if (calle.tipo === TIPOS.DEVORADOR) {
        for (let c = 0; c < calle.carriles; c++) {
            const vehiculoEliminado = calle.arreglo[c][calle.tamano - 1];
            if (vehiculoEliminado > 0) {
                // console.log(`🗑️ CA: [${calle.nombre}][Carril ${c}, Pos ${calle.tamano - 1}] DEVORADOR elimina vehículo tipo ${vehiculoEliminado}`);
            }
            calle.arreglo[c][calle.tamano - 1] = 0;
        }
    }
}

function cambioCarril(calle) {
    if (calle.carriles <= 1 || calle.probabilidadSaltoDeCarril <= 0) {
        return;
    }

    const cambios = [];
    const espaciosReservados = new Set(); // Reserva GLOBAL para destinos (SOLO destinos)
    const estadoOriginal = {}; // Backup del estado original

    // ✅ FASE 0: Crear backup del estado original
    for (let c = 0; c < calle.carriles; c++) {
        estadoOriginal[c] = [...calle.arreglo[c]];
    }

    // ✅ FASE 1: Detectar y reservar cambios válidos DIAGONALES
    // Cambio diagonal = carril diferente + avanzar 1 posición adelante
    for (let c = 0; c < calle.carriles; c++) {
        for (let i = 1; i < calle.tamano - 1; i++) {
            const vehiculo = calle.arreglo[c][i];

            // Solo procesar si hay vehículo válido (1-6) Y no está esperando
            if (vehiculo >= 1 && vehiculo <= 6 && !calle.celulasEsperando[c][i]) {
                // 🚧 DETECCIÓN DE OBSTRUCCIONES ADELANTE
                // Verificar si hay una obstrucción (valor 7) en las próximas 3 celdas
                let hayObstruccionAdelante = false;
                const distanciaDeteccion = 3; // Mirar 3 celdas adelante

                for (let offset = 1; offset <= distanciaDeteccion && (i + offset) < calle.tamano; offset++) {
                    if (calle.arreglo[c][i + offset] === 7) {
                        hayObstruccionAdelante = true;
                        break;
                    }
                }

                // Determinar probabilidad de cambio de carril
                // Si hay obstrucción adelante: 30%, sino: probabilidad normal de la calle
                const probabilidadCambio = hayObstruccionAdelante ? 0.30 : calle.probabilidadSaltoDeCarril;

                if (Math.random() < probabilidadCambio) {
                    const carrilesDisponibles = [];

                    // CAMBIO DIAGONAL SUPERIOR: carril-1, posición+1
                    if (c > 0) {
                        const posDestino = i + 1;
                        const claveDestino = `${c - 1},${posDestino}`;

                        // Verificar que destino esté vacío Y no reservado
                        // IMPORTANTE: verificar contra estadoOriginal para evitar conflictos
                        if (posDestino < calle.tamano &&
                            estadoOriginal[c - 1][posDestino] === 0 &&
                            !espaciosReservados.has(claveDestino) &&
                            !calle.celulasEsperando[c - 1][posDestino]) {
                            carrilesDisponibles.push({
                                carril: c - 1,
                                posicion: posDestino,
                                key: claveDestino
                            });
                        }
                    }

                    // CAMBIO DIAGONAL INFERIOR: carril+1, posición+1
                    if (c < calle.carriles - 1) {
                        const posDestino = i + 1;
                        const claveDestino = `${c + 1},${posDestino}`;

                        // Verificar que destino esté vacío Y no reservado
                        // IMPORTANTE: verificar contra estadoOriginal para evitar conflictos
                        if (posDestino < calle.tamano &&
                            estadoOriginal[c + 1][posDestino] === 0 &&
                            !espaciosReservados.has(claveDestino) &&
                            !calle.celulasEsperando[c + 1][posDestino]) {
                            carrilesDisponibles.push({
                                carril: c + 1,
                                posicion: posDestino,
                                key: claveDestino
                            });
                        }
                    }

                    // Si hay carriles disponibles, elegir uno al azar
                    if (carrilesDisponibles.length > 0) {
                        const seleccion = carrilesDisponibles[Math.floor(Math.random() * carrilesDisponibles.length)];

                        // Reservar SOLO el destino (el origen se liberará automáticamente)
                        espaciosReservados.add(seleccion.key);

                        cambios.push({
                            desde: {carril: c, posicion: i},
                            hacia: {carril: seleccion.carril, posicion: seleccion.posicion},
                            tipoVehiculo: vehiculo
                        });
                    }
                }
            }
        }
    }

    // Si no hay cambios, salir
    if (cambios.length === 0) {
        return;
    }

    // ✅ FASE 2: Detectar y eliminar cambios cruzados en "X"
    // Cambio cruzado = dos vehículos en carriles adyacentes que intentan intercambiar carriles
    const cambiosFiltrados = [];
    const cambiosEliminados = new Set(); // Índices de cambios que se deben eliminar

    for (let i = 0; i < cambios.length; i++) {
        if (cambiosEliminados.has(i)) continue; // Ya fue eliminado

        const cambioA = cambios[i];
        let esCruzado = false;

        // Buscar si hay otro cambio que forme una X con este
        for (let j = i + 1; j < cambios.length; j++) {
            if (cambiosEliminados.has(j)) continue;

            const cambioB = cambios[j];

            // Detectar cruce en X:
            // Dos vehículos se cruzan si:
            // 1. Están en carriles adyacentes en el origen
            // 2. Están en la misma posición horizontal en el origen
            // 3. Intercambian posiciones diagonalmente (uno sube, otro baja)
            // 4. Ambos avanzan a la misma columna destino
            //
            // Ejemplo de cruce prohibido:
            // Antes: [carril2, pos1]=vehículo1  y  [carril3, pos1]=vehículo2
            // Después: [carril1, pos2]=vehículo1  y  [carril2, pos2]=vehículo2
            // (Se cruzan en el espacio entre pos1 y pos2)

            const mismaColumnaOrigen = cambioA.desde.posicion === cambioB.desde.posicion;
            const mismaColumnaDestino = cambioA.hacia.posicion === cambioB.hacia.posicion;
            const carrilesAdyacentesOrigen = Math.abs(cambioA.desde.carril - cambioB.desde.carril) === 1;
            const carrilesAdyacentesDestino = Math.abs(cambioA.hacia.carril - cambioB.hacia.carril) === 1;

            // Verificar si hay cruce: ambos en carriles adyacentes, misma posición inicial,
            // y se cruzan (uno sube mientras el otro baja)
            const seCruzan =
                (cambioA.desde.carril < cambioB.desde.carril && cambioA.hacia.carril > cambioB.hacia.carril) ||
                (cambioA.desde.carril > cambioB.desde.carril && cambioA.hacia.carril < cambioB.hacia.carril);

            if (mismaColumnaOrigen && mismaColumnaDestino && carrilesAdyacentesOrigen && carrilesAdyacentesDestino && seCruzan) {
                // Cruce en X detectado
                // console.log(`🚫 Cruce en X detectado: [${cambioA.desde.carril},${cambioA.desde.posicion}]→[${cambioA.hacia.carril},${cambioA.hacia.posicion}] vs [${cambioB.desde.carril},${cambioB.desde.posicion}]→[${cambioB.hacia.carril},${cambioB.hacia.posicion}]`);
                cambiosEliminados.add(i);
                cambiosEliminados.add(j);
                esCruzado = true;
                break;
            }
        }

        // Si no es cruzado, mantener el cambio
        if (!esCruzado && !cambiosEliminados.has(i)) {
            cambiosFiltrados.push(cambioA);
        }
    }

    // Reemplazar lista de cambios con la filtrada
    cambios.length = 0;
    cambios.push(...cambiosFiltrados);

    // Si después de filtrar no quedan cambios, salir
    if (cambios.length === 0) {
        return;
    }

    // ✅ FASE 3: Validar que TODOS los cambios son seguros
    // IMPORTANTE: verificar contra el estado ORIGINAL para garantizar integridad
    let todosLosDestinosLibres = true;
    for (const cambio of cambios) {
        const destinoEnEstadoOriginal = estadoOriginal[cambio.hacia.carril][cambio.hacia.posicion];
        if (destinoEnEstadoOriginal !== 0) {
            console.error(`❌ VALIDACIÓN FALLIDA: Destino [${cambio.hacia.carril},${cambio.hacia.posicion}] ocupado por tipo ${destinoEnEstadoOriginal} en estado original`);
            todosLosDestinosLibres = false;
            break;
        }
    }

    // Si algún destino está ocupado, CANCELAR TODOS los cambios
    if (!todosLosDestinosLibres) {
        console.warn(`⚠️ CAMBIOS CANCELADOS: Colisión detectada en validación`);
        return;
    }

    // ✅ FASE 4: Aplicar cambios de forma ATÓMICA
    // Primero: Limpiar TODOS los orígenes
    for (const cambio of cambios) {
        calle.arreglo[cambio.desde.carril][cambio.desde.posicion] = 0;
    }

    // Segundo: Colocar TODOS los vehículos en destino con verificación
    let colisionDetectada = false;
    for (const cambio of cambios) {
        // VERIFICACIÓN FINAL antes de escribir
        if (calle.arreglo[cambio.hacia.carril][cambio.hacia.posicion] !== 0) {
            console.error(`❌ COLISIÓN CRÍTICA: Tipo ${cambio.tipoVehiculo} intentó ocupar [${cambio.hacia.carril},${cambio.hacia.posicion}] pero está ocupado por tipo ${calle.arreglo[cambio.hacia.carril][cambio.hacia.posicion]}`);
            colisionDetectada = true;
            break;
        }

        // Colocar vehículo en destino
        calle.arreglo[cambio.hacia.carril][cambio.hacia.posicion] = cambio.tipoVehiculo;
    }

    // Si hubo colisión, hacer ROLLBACK completo
    if (colisionDetectada) {
        console.error(`🔄 ROLLBACK: Restaurando estado original debido a colisión`);
        for (let c = 0; c < calle.carriles; c++) {
            calle.arreglo[c] = [...estadoOriginal[c]];
        }
        return; // Salir de la función completa
    }

    // ✅ FASE 5: Marcar celdas como esperando (solo si TODO fue exitoso)
    // Para cambios DIAGONALES, solo necesitamos marcar el destino y su vecindad
    // No necesitamos marcar todos los carriles porque el vehículo se mueve diagonal
    for (const cambio of cambios) {
        // Marcar el destino (donde llegó el vehículo)
        calle.celulasEsperando[cambio.hacia.carril][cambio.hacia.posicion] = true;

        // IMPORTANTE: NO marcar el origen como esperando
        // El origen queda vacío después del cambio de carril y DEBE poder recibir
        // vehículos que vengan desde posiciones anteriores por las reglas CA

        // Marcar vecinos del destino en el MISMO carril de destino
        // IMPORTANTE: NO marcar el vecino anterior (pos-1) porque puede recibir vehículos
        // que avanzan por las reglas CA normales desde posiciones anteriores
        // Solo marcamos el vecino siguiente para evitar que avance sobre el vehículo que acaba de llegar
        if (cambio.hacia.posicion < calle.tamano - 1) {
            calle.celulasEsperando[cambio.hacia.carril][cambio.hacia.posicion + 1] = true;
        }

        // Marcar vecinos del origen en el MISMO carril de origen
        // IMPORTANTE: NO marcar el vecino anterior (pos-1) porque puede haber vehículos
        // que necesitan avanzar a esa posición desde posiciones más atrás
        // IMPORTANTE: NO marcar el origen mismo porque necesita recibir vehículos

        // Marcar el vecino siguiente para evitar que el vehículo siguiente avance
        // inmediatamente al espacio que quedó vacío
        if (cambio.desde.posicion < calle.tamano - 1) {
            calle.celulasEsperando[cambio.desde.carril][cambio.desde.posicion + 1] = true;
        }

        // console.log(`🔄 CAMBIO DE CARRIL: [${calle.nombre}] Vehículo tipo ${cambio.tipoVehiculo} de [Carril ${cambio.desde.carril}, Pos ${cambio.desde.posicion}] → [Carril ${cambio.hacia.carril}, Pos ${cambio.hacia.posicion}]`);
    }

    // ✅ FASE 5: Validación post-cambio
    let vehiculosFinales = 0;
    for (let c = 0; c < calle.carriles; c++) {
        for (let i = 0; i < calle.tamano; i++) {
            if (calle.arreglo[c][i] >= 1 && calle.arreglo[c][i] <= 6) {
                vehiculosFinales++;
            }
        }
    }

    // console.log(`📊 Cambios de carril completados: ${cambios.length} movimientos, ${vehiculosFinales} vehículos totales`);
}

// ========== EXPONER VARIABLES GLOBALES PARA EL EDITOR ==========
window.backgroundAreas = backgroundAreas;
window.edificios = edificios;
window.edificioSeleccionado = null;

// Función mejorada para dibujar edificios con selección visual
function dibujarEdificios() {
    // Usar window.edificios si existe, sino usar la constante local edificios como fallback
    const edificiosADibujar = window.edificios || edificios;
    edificiosADibujar.forEach((edificio, index) => {
        ctx.save();
        ctx.translate(edificio.x, edificio.y);
        ctx.rotate((edificio.angle || 0) * Math.PI / 180);

        // Buscar si existe una imagen para este edificio
        const img = buildingImageMap[edificio.label];

        // Si existe una imagen y está cargada, dibujarla
        if (img && img.complete && img.naturalHeight !== 0) {
            ctx.drawImage(img, -edificio.width / 2, -edificio.height / 2, edificio.width, edificio.height);
        } else {
            // Dibujar rectángulo de color para otros edificios
            ctx.fillStyle = edificio.color;
            ctx.fillRect(-edificio.width / 2, -edificio.height / 2, edificio.width, edificio.height);
        }

        // Resaltar edificio seleccionado
        if (window.edificioSeleccionado && window.edificioSeleccionado.index === index) {
            // Naranja para Constructor, dorado para Configuración
            ctx.strokeStyle = window.modoSeleccion === "constructor" ? "#FFA500" : "#FFD700";
            ctx.lineWidth = 4 / escala;
            ctx.setLineDash([10 / escala, 5 / escala]);
            ctx.strokeRect(-edificio.width / 2, -edificio.height / 2, edificio.width, edificio.height);
            ctx.setLineDash([]);
        }

        // Etiqueta del edificio (opcional, puedes comentar esta sección si no quieres el texto)
        if (edificio.label && edificio.label !== "CONO") {
            ctx.fillStyle = "white";
            ctx.font = `${12 / escala}px Arial`;
            ctx.textAlign = "center";
            ctx.fillText(edificio.label, 0, 0);
        }

        ctx.restore();
    });
}

function dibujarCalles() {
    calles.forEach(calle => {
        ctx.save();
        
        // Si la calle tiene curva activa, dibujar con curvas
        if (calle.esCurva && calle.vertices.length >= 2) {
            dibujarCalleConCurva(calle);
        } else {
            // Dibujo tradicional (rectilíneo)
            ctx.translate(calle.x, calle.y);
            ctx.rotate(-calle.angulo * Math.PI / 180);

            for (let c = 0; c < calle.carriles; c++) {
                for (let i = 0; i < calle.tamano; i++) {
                    ctx.drawImage(carreteraImg, i * celda_tamano, c * celda_tamano, celda_tamano, celda_tamano);
                }
            }
            
            // Dibujar borde si la calle está seleccionada
            if (window.calleSeleccionada && calle.nombre === window.calleSeleccionada.nombre) {
                // Naranja para Constructor, amarillo para Configuración
                ctx.strokeStyle = window.modoSeleccion === "constructor" ? "#FFA500" : "yellow";
                ctx.lineWidth = 1;
                ctx.strokeRect(0, 0, calle.tamano * celda_tamano, calle.carriles * celda_tamano);
            }
        }
        
        ctx.restore();
    });
}

// Función para dibujar calle con curvas
function dibujarCalleConCurva(calle) {
    // Dibujar cada celda en su posición curvada
    for (let c = 0; c < calle.carriles; c++) {
        for (let i = 0; i < calle.tamano; i++) {
            const coords = obtenerCoordenadasGlobalesCeldaConCurva(calle, c, i);
            
            ctx.save();
            ctx.translate(coords.x, coords.y);
            ctx.rotate(-coords.angulo * Math.PI / 180);
            ctx.drawImage(carreteraImg, -celda_tamano / 2, -celda_tamano / 2, celda_tamano, celda_tamano);
            ctx.restore();
        }
    }
    
    // Dibujar contorno completo si está seleccionada
    if (window.calleSeleccionada && calle.nombre === window.calleSeleccionada.nombre) {
        dibujarContornoCalleCurva(calle);
    }
}

// Función para dibujar el contorno completo de una calle con curvas
function dibujarContornoCalleCurva(calle) {
    // Naranja para Constructor, amarillo para Configuración
    ctx.strokeStyle = window.modoSeleccion === "constructor" ? "#FFA500" : "yellow";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]); // Línea punteada para mejor visibilidad

    // Dibujar contorno superior (carril 0)
    ctx.beginPath();
    for (let i = 0; i < calle.tamano; i++) {
        const coords = obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, i);
        const anguloRad = -coords.angulo * Math.PI / 180;

        // Offset perpendicular hacia arriba (lado superior de la calle)
        const offsetX = -Math.sin(anguloRad) * (celda_tamano / 2);
        const offsetY = Math.cos(anguloRad) * (celda_tamano / 2);

        const puntoX = coords.x + offsetX;
        const puntoY = coords.y + offsetY;

        if (i === 0) {
            ctx.moveTo(puntoX, puntoY);
        } else {
            ctx.lineTo(puntoX, puntoY);
        }
    }
    ctx.stroke();

    // Dibujar contorno inferior (último carril)
    ctx.beginPath();
    const ultimoCarril = calle.carriles - 1;
    for (let i = 0; i < calle.tamano; i++) {
        const coords = obtenerCoordenadasGlobalesCeldaConCurva(calle, ultimoCarril, i);
        const anguloRad = -coords.angulo * Math.PI / 180;

        // Offset perpendicular hacia abajo (lado inferior de la calle)
        const offsetX = Math.sin(anguloRad) * (celda_tamano / 2);
        const offsetY = -Math.cos(anguloRad) * (celda_tamano / 2);

        const puntoX = coords.x + offsetX;
        const puntoY = coords.y + offsetY;

        if (i === 0) {
            ctx.moveTo(puntoX, puntoY);
        } else {
            ctx.lineTo(puntoX, puntoY);
        }
    }
    ctx.stroke();

    // Dibujar líneas laterales (inicio y final)
    // Lado izquierdo (inicio de la calle)
    ctx.beginPath();
    const coordsInicio0 = obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, 0);
    const coordsInicioN = obtenerCoordenadasGlobalesCeldaConCurva(calle, ultimoCarril, 0);
    const anguloInicioRad = -coordsInicio0.angulo * Math.PI / 180;

    const offsetInicioSupX = -Math.sin(anguloInicioRad) * (celda_tamano / 2);
    const offsetInicioSupY = Math.cos(anguloInicioRad) * (celda_tamano / 2);
    const offsetInicioInfX = Math.sin(anguloInicioRad) * (celda_tamano / 2);
    const offsetInicioInfY = -Math.cos(anguloInicioRad) * (celda_tamano / 2);

    ctx.moveTo(coordsInicio0.x + offsetInicioSupX, coordsInicio0.y + offsetInicioSupY);
    ctx.lineTo(coordsInicioN.x + offsetInicioInfX, coordsInicioN.y + offsetInicioInfY);
    ctx.stroke();

    // Lado derecho (final de la calle)
    ctx.beginPath();
    const ultimoIndice = calle.tamano - 1;
    const coordsFinal0 = obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, ultimoIndice);
    const coordsFinalN = obtenerCoordenadasGlobalesCeldaConCurva(calle, ultimoCarril, ultimoIndice);
    const anguloFinalRad = -coordsFinal0.angulo * Math.PI / 180;

    const offsetFinalSupX = -Math.sin(anguloFinalRad) * (celda_tamano / 2);
    const offsetFinalSupY = Math.cos(anguloFinalRad) * (celda_tamano / 2);
    const offsetFinalInfX = Math.sin(anguloFinalRad) * (celda_tamano / 2);
    const offsetFinalInfY = -Math.cos(anguloFinalRad) * (celda_tamano / 2);

    ctx.moveTo(coordsFinal0.x + offsetFinalSupX, coordsFinal0.y + offsetFinalSupY);
    ctx.lineTo(coordsFinalN.x + offsetFinalInfX, coordsFinalN.y + offsetFinalInfY);
    ctx.stroke();

    ctx.setLineDash([]); // Restaurar línea sólida
}


// Función para dibujar vértices editables
function dibujarVertices() {
    if (!mostrarVertices) return;

    ctx.save();

    calles.forEach(calle => {
        if (calle.tipo !== TIPOS.CONEXION || !calle.vertices || calle.vertices.length === 0) return;

        calle.vertices.forEach((vertice, index) => {
            const pos = calcularPosicionVertice(calle, vertice);

            // Dibujar línea guía entre vértices
            if (index > 0) {
                const verticeAnterior = calle.vertices[index - 1];
                const posAnterior = calcularPosicionVertice(calle, verticeAnterior);

                ctx.strokeStyle = "rgba(255, 165, 0, 0.4)";
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(posAnterior.x, posAnterior.y);

                // Si la calle tiene curvas activas, dibujar siguiendo la curva real
                if (calle.esCurva && calle.vertices.length >= 2) {
                    const carrilCentral = Math.floor(calle.carriles / 2);
                    const pasos = Math.max(5, Math.floor((vertice.indiceCelda - verticeAnterior.indiceCelda) / 5));

                    for (let i = 1; i <= pasos; i++) {
                        const t = i / pasos;
                        const indiceCeldaIntermedia = Math.floor(verticeAnterior.indiceCelda + t * (vertice.indiceCelda - verticeAnterior.indiceCelda));
                        const coordIntermedia = obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, indiceCeldaIntermedia);
                        ctx.lineTo(coordIntermedia.x, coordIntermedia.y);
                    }
                } else {
                    // Para calles rectas, línea directa
                    ctx.lineTo(pos.x, pos.y);
                }

                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Determinar si es el vértice seleccionado
            const esSeleccionado = calleSeleccionada && calle.nombre === calleSeleccionada.nombre;
            const esVerticeActivo = verticeSeleccionado && verticeSeleccionado.indice === index &&
                                     verticeSeleccionado.calle === calle;

            // Si es el vértice activo, dibujar control visual mejorado
            if (esVerticeActivo) {
                // Línea perpendicular para mostrar dirección de arrastre
                // Usar el ángulo real en este punto de la curva
                const anguloEnPuntoActual = calle.esCurva && calle.vertices.length >= 2
                    ? obtenerAnguloEnPunto(calle, vertice.indiceCelda)
                    : calle.angulo;
                const anguloBaseRad = -anguloEnPuntoActual * Math.PI / 180;
                const perpX = -Math.sin(anguloBaseRad);
                const perpY = Math.cos(anguloBaseRad);

                const radioGuia = 50; // Longitud de la guía visual
                ctx.strokeStyle = "rgba(100, 200, 255, 0.6)";
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(pos.x - perpX * radioGuia, pos.y - perpY * radioGuia);
                ctx.lineTo(pos.x + perpX * radioGuia, pos.y + perpY * radioGuia);
                ctx.stroke();
                ctx.setLineDash([]);

                // Círculo de control exterior (área de arrastre)
                ctx.strokeStyle = "rgba(100, 200, 255, 0.5)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 50, 0, 2 * Math.PI);
                ctx.stroke();

                // Indicador de posición actual del ángulo
                const anguloOffsetRad = (-vertice.anguloOffset * Math.PI) / 180;
                const indicadorX = pos.x + perpX * (vertice.anguloOffset / 30) * 50;
                const indicadorY = pos.y + perpY * (vertice.anguloOffset / 30) * 50;

                ctx.fillStyle = "rgba(255, 100, 100, 0.8)";
                ctx.beginPath();
                ctx.arc(indicadorX, indicadorY, 6, 0, 2 * Math.PI);
                ctx.fill();

                // Línea conectando centro con indicador
                ctx.strokeStyle = "rgba(255, 100, 100, 0.6)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(indicadorX, indicadorY);
                ctx.stroke();
            }

            // Radio del vértice
            const radio = esVerticeActivo ? 10 : (esSeleccionado ? 8 : 6);

            // Color según ángulo offset
            let colorVertice = "rgba(100, 149, 237, 0.9)"; // Azul por defecto
            if (Math.abs(vertice.anguloOffset) > 0) {
                const intensidad = Math.abs(vertice.anguloOffset) / 30;
                colorVertice = `rgba(255, ${165 * (1 - intensidad)}, 0, 0.9)`;
            }

            // Círculo del vértice
            ctx.fillStyle = esVerticeActivo ? "rgba(100, 200, 255, 0.9)" :
                           (esSeleccionado ? "rgba(255, 215, 0, 0.9)" : colorVertice);
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radio, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // Número del vértice
            ctx.fillStyle = "white";
            ctx.font = "bold 9px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(index.toString(), pos.x, pos.y);

            // Mostrar ángulo offset si no es cero
            if ((esSeleccionado || esVerticeActivo) && Math.abs(vertice.anguloOffset) > 0.1) {
                ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
                ctx.fillRect(pos.x - 25, pos.y - 30, 50, 18);
                ctx.fillStyle = "white";
                ctx.font = "bold 11px Arial";
                ctx.fillText(`${vertice.anguloOffset.toFixed(1)}°`, pos.x, pos.y - 22);
            }
        });
    });

    ctx.restore();
}

// Función para obtener el color según el tipo de vehículo
function obtenerColorVehiculo(tipo) {
    const colores = {
        1: '#FF5733', // Rojo-naranja
        2: '#3498DB', // Azul
        3: '#2ECC71', // Verde
        4: '#F39C12', // Amarillo-naranja
        5: '#9B59B6', // Púrpura
        6: '#E74C3C'  // Rojo
    };
    return colores[tipo] || '#FF5733';
}

function dibujarCarros() {
    calles.forEach(calle => {
        ctx.save();

        if (calle.esCurva && calle.vertices.length >= 2) {
            // Dibujar carros en calle curva
            for (let c = 0; c < calle.carriles; c++) {
                calle.arreglo[c].forEach((celda, i) => {
                    if (celda > 0) {
                        const coords = obtenerCoordenadasGlobalesCeldaConCurva(calle, c, i);

                        ctx.save();
                        ctx.translate(coords.x, coords.y);

                        // Usar el ángulo que ya viene calculado correctamente desde obtenerCoordenadasGlobalesCeldaConCurva
                        // Este ángulo ya considera la curvatura de la calle en este punto específico
                        ctx.rotate(-coords.angulo * Math.PI / 180);

                        // Obtener la imagen según el tipo de vehículo
                        const imgVehiculo = obtenerImagenVehiculo(celda);
                        // Dibujar imagen o rectángulo de color como fallback
                        if (imgVehiculo && imgVehiculo.complete && imgVehiculo.naturalHeight !== 0) {
                            ctx.drawImage(imgVehiculo, -celda_tamano / 2, -celda_tamano / 2, celda_tamano, celda_tamano);
                        } else {
                            ctx.fillStyle = obtenerColorVehiculo(celda);
                            ctx.fillRect(-celda_tamano / 2, -celda_tamano / 2, celda_tamano, celda_tamano);
                        }
                        ctx.restore();
                    }
                });
            }
        } else {
            // Dibujo tradicional
            ctx.translate(calle.x, calle.y);
            ctx.rotate(-calle.angulo * Math.PI / 180);

            for (let c = 0; c < calle.carriles; c++) {
                calle.arreglo[c].forEach((celda, i) => {
                    if (celda > 0) {
                        // Obtener la imagen según el tipo de vehículo
                        const imgVehiculo = obtenerImagenVehiculo(celda);
                        // Dibujar imagen o rectángulo de color como fallback
                        if (imgVehiculo && imgVehiculo.complete && imgVehiculo.naturalHeight !== 0) {
                            ctx.drawImage(imgVehiculo, i * celda_tamano, c * celda_tamano, celda_tamano, celda_tamano);
                        } else {
                            ctx.fillStyle = obtenerColorVehiculo(celda);
                            ctx.fillRect(i * celda_tamano, c * celda_tamano, celda_tamano, celda_tamano);
                        }
                    }
                });
            }
        }
        
        ctx.restore();
    });
}


// Función para dibujar todas las conexiones
function dibujarConexionesDetectadas() {
    if (!mostrarConexiones) return;

    ctx.save();
    
    conexiones.forEach(conexion => {
        if (conexion instanceof ConexionCA) {
            conexion.dibujar();
        }
    });
    
    ctx.restore();
}

// Renderizar canvas
function renderizarCanvas() {
    // Si PixiJS está inicializado Y habilitado, usar el motor gráfico
    if (window.USE_PIXI && pixiInitialized && window.pixiApp && window.pixiApp.sceneManager) {
        // Solo renderizar la escena completa la primera vez
        // Después, el ticker de PixiJS maneja todo automáticamente
        if (!pixiFirstRender) {
            console.log('🎨 Primera renderización con PixiJS');
            window.pixiApp.sceneManager.renderAll();
            pixiFirstRender = true;
        } else {
            // Si hay una calle seleccionada en modo edición, re-renderizarla
            // para reflejar cambios de geometría (como curvas de vértices)
            if (window.editorCalles && window.editorCalles.modoEdicion && window.calleSeleccionada) {
                const calleRenderer = window.pixiApp.sceneManager.calleRenderer;
                if (calleRenderer) {
                    // Re-renderizar la calle seleccionada
                    if (window.calleSeleccionada.esCurva) {
                        calleRenderer.renderCalleCurva(window.calleSeleccionada);
                    } else {
                        calleRenderer.renderCalleRecta(window.calleSeleccionada);
                    }
                    // Re-renderizar sus vértices
                    calleRenderer.renderVertices(window.calleSeleccionada);
                }
            }
        }

        // El minimapa se actualiza en cada frame (es ligero)
        if (window.pixiApp.minimapRenderer) {
            window.pixiApp.minimapRenderer.render();
        }

        // Nota: PixiJS.Ticker ya está renderizando el stage automáticamente
        // No necesitamos hacer nada más aquí
        return;
    }

    // Fallback completo a Canvas 2D nativo si PixiJS no está disponible
    ctx.fillStyle = "#c6cbcd";

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(escala, 0, 0, escala, offsetX, offsetY);

    dibujarEdificios();
    dibujarCalles();
    dibujarCarros();
    dibujarConexionesDetectadas();
    dibujarVertices();
    dibujarEtiquetasCalles();
    dibujarMinimapa();
}


// Función para calcular los límites del mapa
function calcularLimitesMapa() {
    if (calles.length === 0) {
        return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    calles.forEach(calle => {
        const angle = -calle.angulo * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const corners = [
            { x: 0, y: 0 },
            { x: calle.tamano * celda_tamano, y: 0 },
            { x: 0, y: calle.carriles * celda_tamano },
            { x: calle.tamano * celda_tamano, y: calle.carriles * celda_tamano }
        ];

        corners.forEach(corner => {
            const globalX = calle.x + (corner.x * cos - corner.y * sin);
            const globalY = calle.y + (corner.x * sin + corner.y * cos);

            minX = Math.min(minX, globalX);
            minY = Math.min(minY, globalY);
            maxX = Math.max(maxX, globalX);
            maxY = Math.max(maxY, globalY);
        });
    });

    const margen = 800;
    return {
        minX: minX - margen,
        minY: minY - margen,
        maxX: maxX + margen,
        maxY: maxY + margen
    };
}

// Función para centrar la vista en el mapa (útil para móviles)
function centrarVistaEnMapa() {
    if (calles.length === 0) {
        console.warn("⚠️ No hay calles para centrar la vista");
        return;
    }

    // Calcular el centro del mapa
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    calles.forEach(calle => {
        minX = Math.min(minX, calle.x);
        minY = Math.min(minY, calle.y);
        maxX = Math.max(maxX, calle.x);
        maxY = Math.max(maxY, calle.y);
    });

    const centroMapaX = (minX + maxX) / 2;
    const centroMapaY = (minY + maxY) / 2;

    // Calcular el centro del canvas
    const centroPantallaX = canvas.width / 2;
    const centroPantallaY = canvas.height / 2;

    // Ajustar offset para centrar el mapa en la pantalla
    offsetX = centroPantallaX - centroMapaX * escala;
    offsetY = centroPantallaY - centroMapaY * escala;

    console.log(`📍 Vista centrada en mapa: centro(${centroMapaX.toFixed(0)}, ${centroMapaY.toFixed(0)}), offset(${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);

    // Si usamos PixiJS, actualizar el CameraController
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.cameraController) {
        window.pixiApp.cameraController.setPosition(offsetX, offsetY);
    }
}

// Función para aplicar límites al offset
function aplicarLimitesOffset() {
    const limites = calcularLimitesMapa();

    // Usar canvas de PixiJS si está disponible, sino usar Canvas 2D
    let canvasWidth, canvasHeight;
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.app && window.pixiApp.app.view) {
        canvasWidth = window.pixiApp.app.view.width;
        canvasHeight = window.pixiApp.app.view.height;
    } else {
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
    }

    // IMPORTANTE: Usar las variables globales actualizadas por CameraController
    const currentEscala = window.escala || escala;
    const currentOffsetX = window.offsetX !== undefined ? window.offsetX : offsetX;
    const currentOffsetY = window.offsetY !== undefined ? window.offsetY : offsetY;

    const minOffsetX = -(limites.maxX * currentEscala - canvasWidth);
    const maxOffsetX = -limites.minX * currentEscala;
    const minOffsetY = -(limites.maxY * currentEscala - canvasHeight);
    const maxOffsetY = -limites.minY * currentEscala;

    // Guardar valores antes de aplicar límites (para debug)
    const offsetXAntes = currentOffsetX;
    const offsetYAntes = currentOffsetY;

    // Actualizar tanto las variables locales como las globales
    offsetX = Math.max(minOffsetX, Math.min(maxOffsetX, currentOffsetX));
    offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, currentOffsetY));

    // Debug: verificar si los límites están bloqueando el movimiento
    if (isMobile && (offsetX !== offsetXAntes || offsetY !== offsetYAntes)) {
        console.log(`⚠️ Límites aplicados: offset cambió de (${offsetXAntes.toFixed(0)}, ${offsetYAntes.toFixed(0)}) a (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
        console.log(`   Límites: X[${minOffsetX.toFixed(0)} a ${maxOffsetX.toFixed(0)}], Y[${minOffsetY.toFixed(0)} a ${maxOffsetY.toFixed(0)}]`);
    }

    // Sincronizar con variables globales
    window.offsetX = offsetX;
    window.offsetY = offsetY;
}

function calcularViewportVisible() {
    // Usar canvas de PixiJS si está disponible, sino usar Canvas 2D
    let canvasWidth, canvasHeight;

    if (window.USE_PIXI && window.pixiApp && window.pixiApp.app && window.pixiApp.app.view) {
        canvasWidth = window.pixiApp.app.view.width;
        canvasHeight = window.pixiApp.app.view.height;
    } else {
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
    }

    // IMPORTANTE: Usar las variables globales actualizadas por CameraController
    const currentEscala = window.escala || escala;
    const currentOffsetX = window.offsetX || offsetX;
    const currentOffsetY = window.offsetY || offsetY;

    const vistaX = -currentOffsetX / currentEscala;
    const vistaY = -currentOffsetY / currentEscala;
    const vistaAncho = canvasWidth / currentEscala;
    const vistaAlto = canvasHeight / currentEscala;

    return { x: vistaX, y: vistaY, ancho: vistaAncho, alto: vistaAlto };
}

function encontrarCeldaMasCercana(worldX, worldY) {
    let celdaMasCercana = null;
    let distanciaMinima = Infinity;
    const umbralDistancia = celda_tamano;

    calles.forEach((calle, calleIndex) => {
        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                // CORRECCIÓN: Usar la función correcta según si la calle tiene curvas o no
                let centroCelda;
                if (calle.esCurva && calle.vertices && calle.vertices.length > 0) {
                    centroCelda = obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice);
                } else {
                    centroCelda = obtenerCoordenadasGlobalesCelda(calle, carril, indice);
                }

                const dx = worldX - centroCelda.x;
                const dy = worldY - centroCelda.y;
                const distancia = Math.sqrt(dx * dx + dy * dy);

                if (distancia < distanciaMinima) {
                    distanciaMinima = distancia;
                    celdaMasCercana = { calle, carril, indice, calleIndex };
                }
            }
        }
    });

    if (celdaMasCercana && distanciaMinima < umbralDistancia) {
        return celdaMasCercana;
    } else {
        return null;
    }
}

// Función para detectar si un punto está sobre una calle (para selección por clic)
function encontrarCalleEnPunto(worldX, worldY) {
    // Iterar sobre todas las calles en orden inverso (las de arriba primero)
    for (let i = calles.length - 1; i >= 0; i--) {
        const calle = calles[i];

        // Si la calle tiene curvas, usar método de detección por celdas
        if (calle.esCurva && calle.vertices && calle.vertices.length > 0) {
            for (let carril = 0; carril < calle.carriles; carril++) {
                for (let indice = 0; indice < calle.tamano; indice++) {
                    const coords = obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice);
                    const dx = worldX - coords.x;
                    const dy = worldY - coords.y;
                    const distancia = Math.sqrt(dx * dx + dy * dy);

                    if (distancia < celda_tamano) {
                        return { calle, calleIndex: i };
                    }
                }
            }
        } else {
            // Para calles rectas, usar transformación geométrica
            const angle = -calle.angulo * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Transformar el punto al sistema de coordenadas local de la calle
            const dx = worldX - calle.x;
            const dy = worldY - calle.y;
            const localX = dx * cos + dy * sin;
            const localY = -dx * sin + dy * cos;

            // Verificar si el punto está dentro del rectángulo de la calle
            const width = calle.tamano * celda_tamano;
            const height = calle.carriles * celda_tamano;

            if (localX >= 0 && localX <= width && localY >= 0 && localY <= height) {
                return { calle, calleIndex: i };
            }
        }
    }

    return null;
}

// Función para detectar si un punto está sobre un edificio (para selección por clic)
function encontrarEdificioEnPunto(worldX, worldY) {
    // Usar window.edificios si existe, sino usar la constante local edificios como fallback
    const edificiosABuscar = window.edificios || edificios;
    // Iterar sobre todos los edificios en orden inverso (los de arriba primero)
    for (let i = edificiosABuscar.length - 1; i >= 0; i--) {
        const edificio = edificiosABuscar[i];

        // Transformar el punto al sistema de coordenadas local del edificio
        const angle = -(edificio.angle || 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const dx = worldX - edificio.x;
        const dy = worldY - edificio.y;
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;

        // Verificar si el punto está dentro del rectángulo del edificio
        const halfWidth = edificio.width / 2;
        const halfHeight = edificio.height / 2;

        if (localX >= -halfWidth && localX <= halfWidth &&
            localY >= -halfHeight && localY <= halfHeight) {
            return { edificio, edificioIndex: i };
        }
    }

    return null;
}

function limpiarCeldas(){
    calles.forEach(calle => {
        for (let c = 0; c < calle.carriles; c++) {
            const carrilActual = calle.arreglo[c];
            if (carrilActual) { 
                for (let i = 0; i < calle.tamano; i++) { 
                    carrilActual[i] = 0; 
                }
            }
        }
        renderizarCanvas();
    });
}

function crearConexionLineal(origen, destino, numCarriles = null, probabilidad = 1.0) {
    const carriles = numCarriles || Math.min(origen.carriles, destino.carriles);
    const conexionesCreadas = [];
    
    console.log(`🔗 Conexión LINEAL: ${origen.nombre} → ${destino.nombre} (${carriles} carriles)`);
    
    for (let carril = 0; carril < carriles; carril++) {
        conexionesCreadas.push(new ConexionCA(
            origen,
            destino,
            carril,
            carril,
            -1,
            0,
            probabilidad,
            TIPOS_CONEXION.LINEAL
        ));
    }
    
    return conexionesCreadas;
}

function crearConexionIncorporacion(origen, destino, carrilDestino = 0, posicionInicial = 0, modoCruzado = 0, configuracion = null) {
    const conexionesCreadas = [];

    const tipoCruce = modoCruzado === 1 ? "CRUZADA" : "NORMAL";
    console.log(`🔀 Conexión INCORPORACIÓN ${tipoCruce}: ${origen.nombre} (${origen.carriles} carriles) → ${destino.nombre}[C${carrilDestino + 1}]`);

    if (configuracion === null) {
        for (let carril = 0; carril < origen.carriles; carril++) {
            // Calcular posición destino según el modo:
            // - Modo 0 (Normal): I1→R1, I2→R2, I3→R3... (posicionInicial + carril)
            // - Modo 1 (Cruzado): I1→R3, I2→R2, I3→R1... (posicionInicial + carriles invertidos)
            let posDestino;
            if (modoCruzado === 1) {
                // Modo cruzado: invertir el orden de los carriles
                posDestino = posicionInicial + (origen.carriles - 1 - carril);
            } else {
                // Modo normal: orden secuencial
                posDestino = posicionInicial + carril;
            }

            conexionesCreadas.push(new ConexionCA(
                origen,
                destino,
                carril,
                carrilDestino,
                -1,
                posDestino,
                1.0,
                TIPOS_CONEXION.INCORPORACION
            ));
        }
    } else {
        configuracion.forEach(config => {
            conexionesCreadas.push(new ConexionCA(
                origen,
                destino,
                config.carrilOrigen,
                carrilDestino,
                -1,
                config.posDestino,
                config.probabilidad || 1.0,
                TIPOS_CONEXION.INCORPORACION
            ));
        });
    }

    return conexionesCreadas;
}

function crearConexionProbabilistica(origen, carrilOrigen, destino, distribucion) {
    const conexionesCreadas = [];
    
    console.log(`🎲 Conexión PROBABILÍSTICA: ${origen.nombre}[C${carrilOrigen + 1}] → ${destino.nombre} (${distribucion.length} salidas)`);
    
    distribucion.forEach(dist => {
        conexionesCreadas.push(new ConexionCA(
            origen,
            destino,
            carrilOrigen,
            dist.carrilDestino,
            dist.posOrigen || -1,
            dist.posDestino || 0,
            dist.probabilidad,
            TIPOS_CONEXION.PROBABILISTICA
        ));
        console.log(`   → Carril ${dist.carrilDestino + 1}: ${(dist.probabilidad * 100).toFixed(0)}% prob.`);
    });
    
    return conexionesCreadas;
}

function registrarConexiones(conexionesArray) {
    calles.forEach(calle => {
        if (!calle.conexionesSalida) {
            calle.conexionesSalida = [];
            for (let carril = 0; carril < calle.carriles; carril++) {
                calle.conexionesSalida[carril] = [];
            }
        }
    });

    conexionesArray.forEach(conexion => {
        if (!conexion.origen.conexionesSalida[conexion.carrilOrigen]) {
            conexion.origen.conexionesSalida[conexion.carrilOrigen] = [];
        }
        conexion.origen.conexionesSalida[conexion.carrilOrigen].push(conexion);
    });
    
    console.log(`✅ ${conexionesArray.length} conexiones registradas`);
}

// Función para inicializar el motor gráfico PixiJS
async function inicializarMotorGrafico() {
    try {
        console.log('🎨 Inicializando motor gráfico PixiJS...');
        console.log('  → Verificando PixiApp:', typeof PixiApp);

        // Crear instancia de PixiApp
        const pixiApp = PixiApp.getInstance('simuladorCanvas');
        console.log('  → PixiApp instancia creada:', pixiApp);

        // Inicializar el motor
        console.log('  → Llamando a pixiApp.init()...');
        const success = await pixiApp.init();
        console.log('  → pixiApp.init() completado. Success:', success);

        if (success) {
            pixiInitialized = true;
            console.log('  → pixiInitialized = true');

            // Crear instancia de EditorHandles
            if (pixiApp.sceneManager) {
                console.log('  → Creando EditorHandles...');
                const editorHandles = new EditorHandles(pixiApp.sceneManager);
            }

            console.log('✅ Motor gráfico PixiJS inicializado correctamente');

            // IMPORTANTE: Renderizar la escena inicial si ya hay datos
            console.log('  → Verificando window.calles:', window.calles ? window.calles.length : 'undefined');
            if (window.calles && window.calles.length > 0) {
                console.log('🎨 Renderizando escena inicial con datos existentes...');
                console.log('  → Llamando a pixiApp.sceneManager.renderAll()...');
                pixiApp.sceneManager.renderAll();
                pixiFirstRender = true;
                console.log('  → renderAll() completado');
            } else {
                console.warn('⚠️ No hay calles para renderizar todavía');
            }

            // Renderizar minimapa si existe
            if (pixiApp.minimapRenderer) {
                console.log('  → Renderizando minimapa...');
                pixiApp.minimapRenderer.render();
            } else {
                console.warn('⚠️ minimapRenderer no está disponible');
            }

            return true;
        } else {
            console.warn('⚠️ No se pudo inicializar PixiJS, usando Canvas 2D');
            return false;
        }
    } catch (error) {
        console.error('❌ Error inicializando motor gráfico:', error);
        console.error('Stack trace:', error.stack);
        console.warn('⚠️ Usando Canvas 2D como fallback');
        return false;
    }
}

function iniciarSimulacion() {
    const Retorno1 = crearCalle("Retorno M. ←", 6, TIPOS.CONEXION, 1932, 889, 260, 0.0, 2, 0.01);
    const Retorno2 = crearCalle("Retorno M. →", 6, TIPOS.CONEXION, 1941, 926, 80, 0.0, 2, 0.01);
    const Retornotorres = crearCalle("Retorno torres →", 7, TIPOS.CONEXION, 1029, 766, 72, 0.0, 1, 0.01);
    const Retornotorres2 = crearCalle("Retorno torres ←", 7, TIPOS.CONEXION, 1051, 731, 252, 0.0, 1, 0.01);
    const RetornoESCOM = crearCalle("Retorno ESCOM ←", 6, TIPOS.CONEXION, 1222, 766, 259, 0.0, 1, 0.01);
    const RetornoESCOM2 = crearCalle("Retorno ESCOM →", 6, TIPOS.CONEXION, 1206, 798, 79, 0.0, 1, 0.01);
    const RetornoEstampa = crearCalle("Retorno Estampa ←", 6, TIPOS.CONEXION, 1390, 795, 259, 0.0, 1, 0.01);
    const RetornoEStampa2 = crearCalle("Retorno Estampa →", 6, TIPOS.CONEXION, 1374, 827, 79, 0.0, 1, 0.01);
    const RetornoJuan = crearCalle("Retorno Juan F. ←", 6, TIPOS.CONEXION, 1439, 804, 259, 0.0, 1, 0.01);
    const RetornoJuan2 = crearCalle("Retorno Juan F. →", 6, TIPOS.CONEXION, 1423, 836, 79, 0.0, 1, 0.01);
    const RetornoJuanD = crearCalle("Retorno Juan F. 2 ←", 6, TIPOS.CONEXION, 1552, 824, 259, 0.0, 1, 0.01);
    const RetornoJuanD2 = crearCalle("Retorno Juan F. 2 →", 6, TIPOS.CONEXION, 1536, 856, 79, 0.0, 1, 0.01);
    const RetornoBatiz = crearCalle("Retorno Batiz ←", 6, TIPOS.CONEXION, 1745, 858, 259, 0.0, 1, 0.01);
    const RetornoBatiz2 = crearCalle("Retorno Batiz →", 6, TIPOS.CONEXION, 1729, 890, 79, 0.0, 1, 0.01);
    const RetornoBatizD = crearCalle("Retorno Batiz F. ←", 6, TIPOS.CONEXION, 2040, 910, 259, 0.0, 1, 0.01);
    const RetornoBatizD2 = crearCalle("Retorno Batiz F. →", 6, TIPOS.CONEXION, 2024, 942, 79, 0.0, 1, 0.01);
    const RetornoSec = crearCalle("Retorno SECAD ←", 7, TIPOS.CONEXION, 2345, 962, 259, 0.0, 1, 0.01);
    const RetornoSec2 = crearCalle("Retorno SECAD →", 7, TIPOS.CONEXION, 2328, 999, 79, 0.0, 1, 0.01);
    const RetornoBernard = crearCalle("Retorno Bernard ←", 7, TIPOS.CONEXION, 2424, 976, 259, 0.0, 1, 0.01);
    const RetornoBernard2 = crearCalle("Retorno Bernard →", 7, TIPOS.CONEXION, 2407, 1013, 79, 0.0, 1, 0.01);
    const RetornoErro1 = crearCalle("Retorno Erro 1 ←", 4, TIPOS.CONEXION, 2129, 627, 136, 0.0, 2, 0.01);
    const RetornoErro2 = crearCalle("Retorno Erro 2 ←", 3, TIPOS.CONEXION, 2048, 701, 136, 0.0, 2, 0.01);
    const RetornoWilfrido = crearCalle("Retorno Wilfrido. ←", 4, TIPOS.CONEXION, 1026, 1475, 258, 0.0, 1, 0.01);
    const RetornoEscalera = crearCalle("Retorno Escalera ←", 4, TIPOS.CONEXION, 1132, 1519, 247, 0.0, 1, 0.01);
    const RetornoEscalera2 = crearCalle("Retorno Escalera →", 4, TIPOS.CONEXION, 1114, 1537, 67, 0.0, 1, 0.01);
    const RetornoWilfrido1 = crearCalle("Retorno Wilfrido1 ←", 4, TIPOS.CONEXION, 1609, 1764, 67, 0.0, 1, 0.01);
    const RetornoWilfrido2 = crearCalle("Retorno Wilfrido2 →", 4, TIPOS.CONEXION, 1627, 1746, 248, 0.0, 1, 0.01);
    const RetornoWilfrido3 = crearCalle("Retorno Wilfrido3 →", 4, TIPOS.CONEXION, 1737, 1822, 68, 0.0, 1, 0.01);
    const RetornoWilfrido4 = crearCalle("Retorno Wilfrido4 ←", 4, TIPOS.CONEXION, 1755, 1803, 248, 0.0, 1, 0.01);
    const RetornoWilfrido5 = crearCalle("Retorno Wilfrido5 ←", 4, TIPOS.CONEXION, 2135, 1910, 259, 0.0, 1, 0.01);
    const RetornoWilfrido6 = crearCalle("Retorno Wilfrido6 →", 4, TIPOS.CONEXION, 2295, 1974, 78, 0.0, 1, 0.01);
    const RetornoWilfrido7 = crearCalle("Retorno Wilfrido7 ←", 4, TIPOS.CONEXION, 2309, 1952, 257, 0.0, 1, 0.01);
    const RetornoWilfrido8 = crearCalle("Retorno Wilfrido8 →", 3, TIPOS.CONEXION, 2549, 2033, 80, 0.0, 1, 0.01);
    const RetornoWilfrido9 = crearCalle("Retorno Wilfrido9 ←", 3, TIPOS.CONEXION, 2562, 2017, 259, 0.0, 1, 0.01);
    const RetornoWilfrido10 = crearCalle("Retorno Wilfrido10 ←", 4, TIPOS.CONEXION, 1800, 1823, 247, 0.0, 1, 0.01);
    const RetornoWilfrido11 = crearCalle("Retorno Wilfrido11 →", 4, TIPOS.CONEXION, 1781, 1842, 67, 0.0, 1, 0.01);
    const RetornoErro3 = crearCalle("Retorno Erro 3 →", 4, TIPOS.CONEXION, 1904, 1017, 350, 0.0, 1, 0.01);
    const RetornoErro4 = crearCalle("Retorno Erro 3 ←", 4, TIPOS.CONEXION, 1927, 1031, 169, 0.0, 1, 0.01);
    const RetornoErro5 = crearCalle("Retorno Erro 4 →", 4, TIPOS.CONEXION, 1879, 1159, 350, 0.0, 1, 0.01);
    const RetornoErro6 = crearCalle("Retorno Erro 4 ←", 4, TIPOS.CONEXION, 1901, 1174, 169, 0.0, 1, 0.01);
    const RetornoErro7 = crearCalle("Retorno Erro 5 →", 4, TIPOS.CONEXION, 1816, 1519, 349, 0.0, 1, 0.01);
    const RetornoErro8 = crearCalle("Retorno Erro 5 ←", 4, TIPOS.CONEXION, 1838, 1533, 169, 0.0, 1, 0.01);
    const RetornoBarredo1 = crearCalle("Retorno Barredo →", 5, TIPOS.CONEXION, 2290, 1131, 347, 0.0, 1, 0.01);
    const RetornoBarredo2 = crearCalle("Retorno Barredo ←", 5, TIPOS.CONEXION, 2317, 1147, 167, 0.0, 1, 0.01);
    const RetornoBarredo3 = crearCalle("Retorno Barredo 3 →", 5, TIPOS.CONEXION, 2264, 1253, 347, 0.0, 1, 0.01);
    const RetornoBarredo4 = crearCalle("Retorno Barredo 3 ←", 5, TIPOS.CONEXION, 2291, 1269, 167, 0.0, 1, 0.01);
    const RetornoBarredo5 = crearCalle("Retorno Barredo 4 →", 5, TIPOS.CONEXION, 2233, 1400, 347, 0.0, 1, 0.01);
    const RetornoBarredo6 = crearCalle("Retorno Barredo 4 ←", 5, TIPOS.CONEXION, 2260, 1416, 167, 0.0, 1, 0.01);
    const RetornoBarredo7 = crearCalle("Retorno Barredo 5 →", 5, TIPOS.CONEXION, 2202, 1546, 347, 0.0, 1, 0.01);
    const RetornoBarredo8 = crearCalle("Retorno Barredo 5 ←", 5, TIPOS.CONEXION, 2228, 1562, 167, 0.0, 1, 0.01);
    const RetornoBarredo9 = crearCalle("Retorno Barredo 6 →", 5, TIPOS.CONEXION, 2173, 1684, 347, 0.0, 1, 0.01);
    const RetornoBarredo10 = crearCalle("Retorno Barredo 6 ←", 5, TIPOS.CONEXION, 2199, 1700, 167, 0.0, 1, 0.01);
    const María_L_Estampa_Ortigoza = crearCalle("Calle M. Luisa Estampa Ort. →", 50, TIPOS.CONEXION, 1389, 788, 86, 0.0, 1, 0.01);
    const María_L_Estampa_Ortigoza2 = crearCalle("Calle M. Luisa Estampa Ort. ←", 49, TIPOS.CONEXION, 1395, 540, 264, 0.0, 1, 0.01);
    const Avenida_Miguel_Othon_de_Mendizabal_1 = crearCalle("Av. Miguel Othon de Mendizabal →", 248, TIPOS.CONEXION, 729, 805, 22, 0.0, 3, 0.02);
    const Calle_Luis_Enrique_Erro_2 = crearCalle("Calle Luis Enrique Erro Tramo 2 →", 65, TIPOS.CONEXION, 1952, 888, 80, 0.0, 2, 0.01);
    const Avenida_Juan_de_Dios_Batiz2 = crearCalle("Av. Juan de Dios Batiz ←", 199, TIPOS.CONEXION, 2385, 967, 170, 0.0, 3, 0.01);
    const Avenida_Juan_de_Dios_Batiz6 = crearCalle("Entrada a Av. Juan de Dios Batiz ←", 17, TIPOS.CONEXION, 2484, 974, 170, 0.0, 3, 0.01);
    const Avenida_Juan_de_Dios_Batiz7 = crearCalle("Salida Juan de Dios Batiz ←", 84, TIPOS.CONEXION, 1410, 795, 170, 0.0, 3, 0.01);
    
    const Avenida_Miguel_Bernard = crearCalle("Av. Miguel Bernard →", 190, TIPOS.CONEXION, 1862, 329, -46, 0.0, 3, 0.01);
    const Avenida_Wilfrido_Massieu_2 = crearCalle("Av. Wilfrido Massieu →", 343, TIPOS.CONEXION, 986, 1502, 345, 0.0, 2, 0.01);
    const Avenida_Cien_Metros2 = crearCalle("Av. Cien Metros ←", 230, TIPOS.CONEXION, 1034, 1671, 110, 0.9, 3, 0.01);
    const Calle_Circuito_Interior_1 = crearCalle("Calle Interior IPN ←", 180, TIPOS.CONEXION, 1413, 843, 257, 0.0, 1, 0.01);
    const Calle_Circuito_Interior_2 = crearCalle("Calle Interior IPN →", 179, TIPOS.CONEXION, 1821, 1487, 144, 0.0, 1, 0.01);
    const Calle_Luis_Enrique_Erro_3 = crearCalle("Calle Luis Enrique Erro ←", 177, TIPOS.CONEXION, 1920, 928, 260, 0.0, 2, 0.01);
    const Calle_Miguel_Anda_y_Barredo2 = crearCalle("Calle Miguel Anda y Barredo ←", 184, TIPOS.CONEXION, 2322, 1004, 258, 0.0, 2, 0.01);
    //const Avenida_Juan_de_Dios_Batiz = crearCalle("Av. Juan de Dios Batiz →", 377, TIPOS.CONEXION, 921, 736, -10, 0.0, 3, 0.01);
    const Avenida_Juan_de_Dios_Batiz3 = crearCalle("Entrada Juan de Dios Batiz →", 95, TIPOS.CONEXION, 921, 736, -10, 0.0, 3, 0.01);
    const Avenida_Juan_de_Dios_Batiz4 = crearCalle("Av. Juan de Dios Batiz →", 204, TIPOS.CONEXION, 1397, 836, -10, 0.0, 3, 0.01);
    const Avenida_Juan_de_Dios_Batiz5 = crearCalle("Salida de Juan de Dios Batiz →", 76, TIPOS.CONEXION, 2399, 1006, -10, 0.0, 3, 0.01);
    const Avenida_IPN = crearCalle("Av. IPN ←", 230, TIPOS.CONEXION, 2805, 950, -100, 0.0, 2, 0.01);
    const Calle_Luis_Enrique_Erro_1 = crearCalle("Calle Luis Enrique Erro →", 178, TIPOS.CONEXION, 1784, 1813, 80, 0.0, 2, 0.01);
    const Calle_Luis_Enrique_Erro_4 = crearCalle("Calle Luis Enrique Erro Tramo 2 ←", 69, TIPOS.CONEXION, 2118, 603, 225, 0.0, 2, 0.01);
    const Calle_Miguel_Anda_y_Barredo = crearCalle("Calle Miguel Anda y Barredo →", 184, TIPOS.CONEXION, 2150, 1908, 78, 0.0, 2, 0.01);
    const Avenida_Wilfrido_Massieu_1 = crearCalle("Av. Wilfrido Massieu ←", 346, TIPOS.CONEXION, 2605, 2027, 166, 0.0, 2, 0.01);
    const Devorador = crearCalle("Salida Cien Metros ←", 4, TIPOS.DEVORADOR, 642, 595, 110, 0, 3, 0);
    const Generador_1 = crearCalle("Entrada a Cien Metros →", 4, TIPOS.GENERADOR, 1039, 1685, 110, 1, 3, 0.0);
    const Generador_2 = crearCalle("Entrada a Av. IPN ←", 5, TIPOS.GENERADOR, 2808, 930, 260, 0.12, 2, 0);
    const Devorador_2 = crearCalle("Salida Av. IPN ←", 5, TIPOS.DEVORADOR, 2606, 2078, 260, 0, 2, 0);
    const Generador_3 = crearCalle("Entrada ←", 5, TIPOS.GENERADOR, 1933, 341, 225, 0.1, 2, 0);
    const Devorador_3 = crearCalle("Salida 1 →", 5, TIPOS.DEVORADOR, 1880, 328, 59, 0, 2, 0);
    const Devorador_4 = crearCalle("Salida 2 →", 5, TIPOS.DEVORADOR, 1758, 346, 117, 0, 2, 0);
    const Generador_4 = crearCalle("E ←", 4, TIPOS.GENERADOR, 2399, 977, 170, 0.0, 3, 0.0);
    const Generador_5 = crearCalle("E 2→", 4, TIPOS.GENERADOR, 1383, 826, -10, 0.0, 3, 0.0);
    const Generador_6 = crearCalle("Er→", 2, TIPOS.GENERADOR, 1783, 1818, 80, 0.05, 2, 0.0);
    const Generador_7 = crearCalle("B →", 2, TIPOS.GENERADOR, 2149, 1913, 78, 0.05, 2, 0.0);

    Calle_Circuito_Interior_2.vertices = [  
        { indiceCelda: 0, anguloOffset: 28.89548024446025 },  
        { indiceCelda: 10, anguloOffset: 3.1801712339538493 },  
        { indiceCelda: 20, anguloOffset: 4.796474299369461 },  
        { indiceCelda: 30, anguloOffset: 0 },  
        { indiceCelda: 40, anguloOffset: -0.00794727257835708 },  
        { indiceCelda: 50, anguloOffset: 0 },  
        { indiceCelda: 60, anguloOffset: 0 },  
        { indiceCelda: 70, anguloOffset: 0 },  
        { indiceCelda: 80, anguloOffset: 1.829304467757733 },  
        { indiceCelda: 90, anguloOffset: 1.4478610439537427 },  
        { indiceCelda: 100, anguloOffset: -2.030172569923173 },  
        { indiceCelda: 110, anguloOffset: -4.502270183637761 },  
        { indiceCelda: 120, anguloOffset: -63.5577432808695 },  
        { indiceCelda: 130, anguloOffset: -65.69793766474116 },  
        { indiceCelda: 140, anguloOffset: -65.52183278172396 },  
        { indiceCelda: 150, anguloOffset: -67.84416906203114 },  
        { indiceCelda: 160, anguloOffset: -67.21386047837817 },  
        { indiceCelda: 170, anguloOffset: -66.85664257102005 },  
        { indiceCelda: 178, anguloOffset: -67.1927676606841 }
    ];  
    Calle_Circuito_Interior_2.esCurva = true;  

    Calle_Circuito_Interior_1.vertices = [  
        { indiceCelda: 0, anguloOffset: 0 },  
        { indiceCelda: 10, anguloOffset: 0 },  
        { indiceCelda: 20, anguloOffset: 0 },  
        { indiceCelda: 30, anguloOffset: 0 },  
        { indiceCelda: 40, anguloOffset: 0 },  
        { indiceCelda: 50, anguloOffset: 0 },  
        { indiceCelda: 60, anguloOffset: 0 },  
        { indiceCelda: 70, anguloOffset: 62.251548429966434 },  
        { indiceCelda: 80, anguloOffset: 64.86502331910667 },  
        { indiceCelda: 90, anguloOffset: 67.76822255642779 },  
        { indiceCelda: 100, anguloOffset: 67.63279626937843 },  
        { indiceCelda: 110, anguloOffset: 68.28819931797415 },  
        { indiceCelda: 120, anguloOffset: 67.4142388009761 },  
        { indiceCelda: 130, anguloOffset: 66.173107308759 },  
        { indiceCelda: 140, anguloOffset: 66.2690469423283 },  
        { indiceCelda: 150, anguloOffset: 67.04561677420118 },  
        { indiceCelda: 160, anguloOffset: 71.78368971854515 },  
        { indiceCelda: 170, anguloOffset: 66.87425162471017 },  
        { indiceCelda: 179, anguloOffset: 90 }  
    ];  
    Calle_Circuito_Interior_1.esCurva = true;    

    María_L_Estampa_Ortigoza2.vertices = [  
        { indiceCelda: 0, anguloOffset: 33.26229205895698 },  
        { indiceCelda: 10, anguloOffset: 5.788936485168125 },  
        { indiceCelda: 20, anguloOffset: -4.722625436006455 },  
        { indiceCelda: 30, anguloOffset: 2.53504905354953 },  
        { indiceCelda: 40, anguloOffset: 2.101814511806475 },  
        { indiceCelda: 48, anguloOffset: -2.6525930720032487 }  
    ];  
    María_L_Estampa_Ortigoza2.esCurva = true;  

    María_L_Estampa_Ortigoza.vertices = [  
        { indiceCelda: 0, anguloOffset: -6.75246815978369 },  
        { indiceCelda: 10, anguloOffset: 0 },  
        { indiceCelda: 20, anguloOffset: 0 },  
        { indiceCelda: 30, anguloOffset: -4.7146542518544425 },  
        { indiceCelda: 40, anguloOffset: -1.1090452039524306 },  
        { indiceCelda: 49, anguloOffset: 26.392890085209743 }  
    ];  
    María_L_Estampa_Ortigoza.esCurva = true; 
    
    // Vértices para Av. Miguel Othon de Mendizabal →
    Avenida_Miguel_Othon_de_Mendizabal_1.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: 0 },
        { indiceCelda: 100, anguloOffset: 0 },
        { indiceCelda: 110, anguloOffset: 0 },
        { indiceCelda: 120, anguloOffset: 0 },
        { indiceCelda: 130, anguloOffset: 0 },
        { indiceCelda: 140, anguloOffset: 0 },
        { indiceCelda: 150, anguloOffset: 0 },
        { indiceCelda: 160, anguloOffset: 0 },
        { indiceCelda: 170, anguloOffset: 0 },
        { indiceCelda: 180, anguloOffset: 0 },
        { indiceCelda: 190, anguloOffset: 0 },
        { indiceCelda: 200, anguloOffset: 15.782577335816946 },
        { indiceCelda: 210, anguloOffset: 5.405854354182056 },
        { indiceCelda: 220, anguloOffset: 16.08041053597891 },
        { indiceCelda: 230, anguloOffset: 5.828495352842338 },
        { indiceCelda: 240, anguloOffset: -15.330152643963826 },
        { indiceCelda: 247, anguloOffset: -28.6815865981034 }
    ];
    Avenida_Miguel_Othon_de_Mendizabal_1.esCurva = true;

    Avenida_Miguel_Bernard.vertices = [
        { indiceCelda: 0, anguloOffset: 29.183651591046115 },
        { indiceCelda: 10, anguloOffset: -1.0407776280136602 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: 0 },
        { indiceCelda: 100, anguloOffset: 0 },
        { indiceCelda: 110, anguloOffset: 0 },
        { indiceCelda: 120, anguloOffset: 0 },
        { indiceCelda: 130, anguloOffset: 0 },
        { indiceCelda: 140, anguloOffset: 0 },
        { indiceCelda: 150, anguloOffset: 0 },
        { indiceCelda: 160, anguloOffset: 7.115972469568073 },
        { indiceCelda: 170, anguloOffset: -0.30063084350775476 },
        { indiceCelda: 180, anguloOffset: -28.235936808677508 },
        { indiceCelda: 190, anguloOffset: -49.296816694482835 }
    ];
    Avenida_Miguel_Bernard.esCurva = true;
    
    // Vértices para Av. Wilfrido Massieu ←
    Avenida_Wilfrido_Massieu_1.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: 0 },
        { indiceCelda: 100, anguloOffset: 0 },
        { indiceCelda: 110, anguloOffset: 0 },
        { indiceCelda: 120, anguloOffset: 0 },
        { indiceCelda: 130, anguloOffset: 0 },
        { indiceCelda: 140, anguloOffset: 0 },
        { indiceCelda: 150, anguloOffset: 0 },
        { indiceCelda: 160, anguloOffset: 0 },
        { indiceCelda: 170, anguloOffset: -11.009098478730472 },
        { indiceCelda: 180, anguloOffset: -11.407038740359418 },
        { indiceCelda: 190, anguloOffset: -11.663564370295632 },
        { indiceCelda: 200, anguloOffset: -6.575739493312889 },
        { indiceCelda: 210, anguloOffset: -11.606703150263227 },
        { indiceCelda: 220, anguloOffset: -14.044688014277959 },
        { indiceCelda: 230, anguloOffset: -11.926764002101764 },
        { indiceCelda: 240, anguloOffset: -9.308916375838844 },
        { indiceCelda: 250, anguloOffset: -8.62069360411787 },
        { indiceCelda: 260, anguloOffset: -11.797253613314432 },
        { indiceCelda: 270, anguloOffset: -8.451094990844364 },
        { indiceCelda: 280, anguloOffset: -10.873446369255475 },
        { indiceCelda: 290, anguloOffset: -10.148863339446716 },
        { indiceCelda: 300, anguloOffset: -12.044049971264982 },
        { indiceCelda: 310, anguloOffset: -9.734523874663381 },
        { indiceCelda: 320, anguloOffset: -11.155215416939388 },
        { indiceCelda: 330, anguloOffset: -8.107048185852282 },
        { indiceCelda: 340, anguloOffset: 0.07275865577794495 },
        { indiceCelda: 345, anguloOffset: 32.42406150399883 }
    ];
    Avenida_Wilfrido_Massieu_1.esCurva = true;

    Calle_Luis_Enrique_Erro_3.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: 0 },
        { indiceCelda: 100, anguloOffset: 0 },
        { indiceCelda: 110, anguloOffset: 0 },
        { indiceCelda: 120, anguloOffset: 0 },
        { indiceCelda: 130, anguloOffset: 0 },
        { indiceCelda: 140, anguloOffset: 0 },
        { indiceCelda: 150, anguloOffset: 0 },
        { indiceCelda: 160, anguloOffset: 0 },
        { indiceCelda: 170, anguloOffset: -20.06920001085021 },
        { indiceCelda: 176, anguloOffset: -12.888080212217028 }
    ];
    Calle_Luis_Enrique_Erro_3.esCurva = true;

    Calle_Luis_Enrique_Erro_2.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: -17.39769742368201 },
        { indiceCelda: 30, anguloOffset: -29.394106807931976 },
        { indiceCelda: 40, anguloOffset: -31.74029755024812 },
        { indiceCelda: 50, anguloOffset: -34.93502217043735 },
        { indiceCelda: 60, anguloOffset: -35.75625427003757 },
        { indiceCelda: 65, anguloOffset: -31.556673587417112 }
    ];
    Calle_Luis_Enrique_Erro_2.esCurva = true;

    Calle_Luis_Enrique_Erro_4.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 22.188890071588943 },
        { indiceCelda: 60, anguloOffset: 34.60708766404601 },
        { indiceCelda: 68, anguloOffset: 35.69353556473338 }
    ];
    Calle_Luis_Enrique_Erro_4.esCurva = true;
    
    Avenida_Juan_de_Dios_Batiz2.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: 0 },
        { indiceCelda: 100, anguloOffset: 0 },
        { indiceCelda: 110, anguloOffset: 0 },
        { indiceCelda: 120, anguloOffset: 0 },
        { indiceCelda: 130, anguloOffset: 0 },
        { indiceCelda: 140, anguloOffset: 0 },
        { indiceCelda: 150, anguloOffset: 0 },
        { indiceCelda: 160, anguloOffset: 0 },
        { indiceCelda: 170, anguloOffset: 0 },
        { indiceCelda: 180, anguloOffset: 0 },
        { indiceCelda: 190, anguloOffset: 0 },
        { indiceCelda: 199, anguloOffset: 0 }
    ];
    Avenida_Juan_de_Dios_Batiz2.esCurva = true;
    Avenida_Juan_de_Dios_Batiz7.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: -4.276161152925752 },
        { indiceCelda: 80, anguloOffset: -6.541011746692756 },
        { indiceCelda: 84, anguloOffset: -38.3378248018302}
    ];
    Avenida_Juan_de_Dios_Batiz7.esCurva = true;

    Avenida_Juan_de_Dios_Batiz6.vertices = [
        { indiceCelda: 0, anguloOffset: 25.80263615745194 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 16, anguloOffset: 0 }
    ];
    Avenida_Juan_de_Dios_Batiz6.esCurva = true;

    Avenida_Juan_de_Dios_Batiz4.vertices = [
        { indiceCelda: 0, anguloOffset: 0 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: 2.341840612539078 },
        { indiceCelda: 100, anguloOffset: 0.6446246298432945 },
        { indiceCelda: 110, anguloOffset: -0.24721573725166493 },
        { indiceCelda: 120, anguloOffset: -2.0856148088049578 },
        { indiceCelda: 130, anguloOffset: -1.9931206794537515 },
        { indiceCelda: 140, anguloOffset: 0 },
        { indiceCelda: 150, anguloOffset: 0 },
        { indiceCelda: 160, anguloOffset: 0 },
        { indiceCelda: 170, anguloOffset: 0 },
        { indiceCelda: 180, anguloOffset: 0 },
        { indiceCelda: 190, anguloOffset: 0 },
        { indiceCelda: 203, anguloOffset: 0 }
    ];
    Avenida_Juan_de_Dios_Batiz4.esCurva = true;

    Avenida_Juan_de_Dios_Batiz3.vertices = [
        { indiceCelda: 0, anguloOffset: -40 },
        { indiceCelda: 10, anguloOffset: 0 },
        { indiceCelda: 20, anguloOffset: 0 },
        { indiceCelda: 30, anguloOffset: 0 },
        { indiceCelda: 40, anguloOffset: 0 },
        { indiceCelda: 50, anguloOffset: 0 },
        { indiceCelda: 60, anguloOffset: 0 },
        { indiceCelda: 70, anguloOffset: 0 },
        { indiceCelda: 80, anguloOffset: 0 },
        { indiceCelda: 90, anguloOffset: -0.8179858385372861 },
        { indiceCelda: 94, anguloOffset: -0.8876108187661783 }
    ];
    Avenida_Juan_de_Dios_Batiz3.esCurva = true;

    Avenida_Wilfrido_Massieu_2.vertices = [  
        { indiceCelda: 0, anguloOffset: 34.01911280594667 },  
        { indiceCelda: 10, anguloOffset: -5.980887194053331 },  
        { indiceCelda: 20, anguloOffset: -7.198865443321912 },  
        { indiceCelda: 30, anguloOffset: -9.216817554150742 },  
        { indiceCelda: 40, anguloOffset: -11.43441987037647 },  
        { indiceCelda: 50, anguloOffset: -7.965630398413504 },  
        { indiceCelda: 60, anguloOffset: -9.182982789846694 },  
        { indiceCelda: 70, anguloOffset: -9.071958977500396 },  
        { indiceCelda: 80, anguloOffset: -9.340882674320676 },  
        { indiceCelda: 90, anguloOffset: -9.941219007364822 },  
        { indiceCelda: 100, anguloOffset: -7.796220976167478 },  
        { indiceCelda: 110, anguloOffset: -8.149011588852922 },  
        { indiceCelda: 120, anguloOffset: -11.320184193589338 },  
        { indiceCelda: 130, anguloOffset: -13.180076970400824 },  
        { indiceCelda: 140, anguloOffset: -8.438919002612998 },  
        { indiceCelda: 150, anguloOffset: -8.808264032898121 },  
        { indiceCelda: 160, anguloOffset: -11.51936318301416 },  
        { indiceCelda: 170, anguloOffset: -8.390324170084245 },  
        { indiceCelda: 180, anguloOffset: 0 },  
        { indiceCelda: 190, anguloOffset: 1.7460387687726275 },  
        { indiceCelda: 200, anguloOffset: 0 },  
        { indiceCelda: 210, anguloOffset: 0.4575348257035403 },  
        { indiceCelda: 220, anguloOffset: 0 },  
        { indiceCelda: 230, anguloOffset: 0 },  
        { indiceCelda: 240, anguloOffset: 0 },  
        { indiceCelda: 250, anguloOffset: 0 },  
        { indiceCelda: 260, anguloOffset: 2.499802263561486 },  
        { indiceCelda: 270, anguloOffset: 1.2519063810628852 },  
        { indiceCelda: 280, anguloOffset: 1.1394180248672738 },  
        { indiceCelda: 290, anguloOffset: 2.0211681202770686 },  
        { indiceCelda: 300, anguloOffset: 2.0022947448441974 },  
        { indiceCelda: 310, anguloOffset: 2.0691502053190396 },  
        { indiceCelda: 320, anguloOffset: 1.6508201426792355 },  
        { indiceCelda: 330, anguloOffset: 0.37393566172394005 },  
        { indiceCelda: 340, anguloOffset: 5.088991945668468 },  
        { indiceCelda: 342, anguloOffset: 3.3003800222679205 }  
    ];  
    Avenida_Wilfrido_Massieu_2.esCurva = true;  
    
    const conexionesCA = [];

    // INICIO DE CONEXIONES
    // ============================================  
    // CONEXIONES LINEALES  
    // ============================================

    conexionesCA.push(...crearConexionLineal(  
        Generador_6,  
        Calle_Luis_Enrique_Erro_1  
    ));
    conexionesCA.push(...crearConexionLineal(  
        Avenida_Juan_de_Dios_Batiz2,  
        Avenida_Juan_de_Dios_Batiz7  
    ));
    conexionesCA.push(...crearConexionLineal(  
        Avenida_Juan_de_Dios_Batiz3,  
        Generador_5  
    ));
    conexionesCA.push(...crearConexionLineal(  
        Avenida_Juan_de_Dios_Batiz4,  
        Avenida_Juan_de_Dios_Batiz5  
    ));
    conexionesCA.push(...crearConexionLineal(  
        Avenida_Juan_de_Dios_Batiz6,  
        Generador_4  
    ));
    conexionesCA.push(...crearConexionLineal(  
        Generador_7,  
        Calle_Miguel_Anda_y_Barredo  
    ));
    // Av. Miguel Othon de Mendizabal → a Av. Miguel Bernard →  
    conexionesCA.push(...crearConexionLineal(  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        Avenida_Miguel_Bernard  
    ));
    
    // Entrada a Cien Metros → a Av. Cien Metros ←  
    conexionesCA.push(...crearConexionLineal(  
        Generador_1,  
        Avenida_Cien_Metros2  
    ));
    
    // Calle Luis Enrique Erro → a Calle Luis Enrique Erro Tramo 2 →  
    conexionesCA.push(...crearConexionLineal(  
        Avenida_Cien_Metros2,  
        Devorador  
    ));
    
    // Calle Luis Enrique Erro → a Calle Luis Enrique Erro Tramo 2 →  
    conexionesCA.push(...crearConexionLineal(  
        Generador_2,  
        Avenida_IPN  
    ));
    // Calle Luis Enrique Erro → a Calle Luis Enrique Erro Tramo 2 →  
    conexionesCA.push(...crearConexionLineal(  
        Avenida_IPN,  
        Devorador_2 
    ));

    // Calle Luis Enrique Erro → a Calle Luis Enrique Erro Tramo 2 →  
    conexionesCA.push(...crearConexionLineal(  
        Generador_4,  
        Avenida_Juan_de_Dios_Batiz2
    ));

        // Calle Luis Enrique Erro → a Calle Luis Enrique Erro Tramo 2 →  
    conexionesCA.push(...crearConexionLineal(  
        Generador_5,  
        Avenida_Juan_de_Dios_Batiz4
    ));
    
    // ============================================  
    // CONEXIONES PROBABILÍSTICAS  
    // ============================================
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        0,  
        Devorador_4,  
        [  
            { carrilDestino: 0, posOrigen: 226, posDestino: 0, probabilidad: 0.8 },  
            { carrilDestino: 1, posOrigen: 227, posDestino: 0, probabilidad: 0.5 }  
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Miguel_Bernard,  
        0,  
        Devorador_3,  
        [  
            { carrilDestino: 0, posOrigen: 3, posDestino: 0, probabilidad: 0.8 },  
            { carrilDestino: 1, posOrigen: 4, posDestino: 0, probabilidad: 0.5 }  
        ]  
    ));

    // Av. Cien Metros ← a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Cien_Metros2,  
        2,  
        Avenida_Wilfrido_Massieu_2,  
        [  
            { carrilDestino: 0, posOrigen: 35, posDestino: 0, probabilidad: 0.3 },  
            { carrilDestino: 1, posOrigen: 34, posDestino: 0, probabilidad: 0.9 }  
        ]  
    ));
    
    // Av. Miguel Othon de Mendizabal → a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        2,  
        Avenida_Juan_de_Dios_Batiz3,  
        [  
            { carrilDestino: 0, posOrigen: 41, posDestino: 0, probabilidad: 0.34 },  
            { carrilDestino: 1, posOrigen: 40, posDestino: 0, probabilidad: 0.33 },  
            { carrilDestino: 2, posOrigen: 39, posDestino: 0, probabilidad: 0.33 }  
        ]  
    ));
    
    // Av. Miguel Othon de Mendizabal → a Calle M. Luisa Estampa Ort. ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        2,  
        María_L_Estampa_Ortigoza2,  
        [  
            { carrilDestino: 0, posOrigen: 143, posDestino: 0, probabilidad: 0.35 }  
        ]  
    ));
    
    // Av. Cien Metros ← a Av. Miguel Othon de Mendizabal →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Cien_Metros2,  
        2,  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        [  
            { carrilDestino: 0, posOrigen: 184, posDestino: 0, probabilidad: 0.28 },  
            { carrilDestino: 1, posOrigen: 183, posDestino: 0, probabilidad: 0.43 },  
            { carrilDestino: 2, posOrigen: 182, posDestino: 0, probabilidad: 0.5 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno Batiz →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        RetornoBatiz2,  
        [  
            { carrilDestino: 0, posOrigen: 67, posDestino: 0, probabilidad: 0.35 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno torres ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz7,  
        0,  
        Retornotorres2,  
        [  
            { carrilDestino: 0, posOrigen: 73, posDestino: 0, probabilidad: 0.2 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz → a Retorno torres →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz3,  
        0,  
        Retornotorres,  
        [  
            { carrilDestino: 0, posOrigen: 23, posDestino: 0, probabilidad: 0.25 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz → a Retorno ESCOM →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz3,  
        0,  
        RetornoESCOM2,  
        [  
            { carrilDestino: 0, posOrigen: 59, posDestino: 0, probabilidad: 0.2 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno ESCOM ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz7,  
        0,  
        RetornoESCOM,  
        [  
            { carrilDestino: 0, posOrigen: 38, posDestino: 0, probabilidad: 0.2 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz → a Retorno Estampa →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz3,  
        0,  
        RetornoEStampa2,  
        [  
            { carrilDestino: 0, posOrigen: 93, posDestino: 0, probabilidad: 0.12 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno Estampa ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz7,  
        0,  
        RetornoEstampa,  
        [  
            { carrilDestino: 0, posOrigen: 4, posDestino: 0, probabilidad: 0.13 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Calle M. Luisa Estampa Ort. →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz7,  
        2,  
        María_L_Estampa_Ortigoza,  
        [  
            { carrilDestino: 0, posOrigen: 4, posDestino: 0, probabilidad: 0.4 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz → a Retorno Juan F. →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        RetornoJuan2,  
        [  
            { carrilDestino: 0, posOrigen: 5, posDestino: 0, probabilidad: 0.14 }  
        ]  
    ));
    // Av. Juan de Dios Batiz → a Circuito Interior IPN 
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        2,  
        Calle_Circuito_Interior_1,  
        [  
            { carrilDestino: 0, posOrigen: 3, posDestino: 0, probabilidad: 0.14 }  
        ]  
    ));
    
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_3,  
        1,  
        Calle_Circuito_Interior_2,  
        [  
            { carrilDestino: 0, posOrigen: 113, posDestino: 0, probabilidad: 0.14 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno Juan F. ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        RetornoJuan,  
        [  
            { carrilDestino: 0, posOrigen: 192, posDestino: 0, probabilidad: 0.2 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno Juan F. 2 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        RetornoJuanD,  
        [  
            { carrilDestino: 0, posOrigen: 169, posDestino: 0, probabilidad: 0.11 }  
        ]  
    ));
    
    // Av. Juan de Dios Batiz ← a Retorno Batiz ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        RetornoBatiz,  
        [  
            { carrilDestino: 0, posOrigen: 130, posDestino: 0, probabilidad: 0.31 }  
        ]  
    ));
    
    // Calle Luis Enrique Erro Tramo 2 → a Retorno Erro 2 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_2,  
        0,  
        RetornoErro2,  
        [  
            { carrilDestino: 0, posOrigen: 43, posDestino: 0, probabilidad: 0.42 },  
            { carrilDestino: 1, posOrigen: 44, posDestino: 0, probabilidad: 0.2 }  
        ]  
    ));

    // IPN a Wilfrido 1  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_IPN,  
        1,  
        Avenida_Wilfrido_Massieu_1,  
        [  
            { carrilDestino: 0, posOrigen: 219, posDestino: 0, probabilidad: 0.5 },  
            { carrilDestino: 1, posOrigen: 218, posDestino: 0, probabilidad: 0.5 }  
        ]  
    ));
    // juan dios batiz 1 A CALLE ANDA BARREDO
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        2,  
        Calle_Miguel_Anda_y_Barredo2,  
        [  
            { carrilDestino: 1, posOrigen: 186, posDestino: 0, probabilidad: 0.5 },  
            { carrilDestino: 0, posOrigen: 187, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO A RETORNO BARREDO
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        RetornoBarredo1,  
        [  
            { carrilDestino: 0, posOrigen: 26, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO A RETORNO BARREDO 3
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        RetornoBarredo3,  
        [  
            { carrilDestino: 0, posOrigen: 51, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO A RETORNO BARREDO 5
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        RetornoBarredo5,  
        [  
            { carrilDestino: 0, posOrigen: 81, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO A RETORNO BARREDO 7
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        RetornoBarredo7,  
        [  
            { carrilDestino: 0, posOrigen: 111, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO A RETORNO BARREDO 9
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        RetornoBarredo9,  
        [  
            { carrilDestino: 0, posOrigen: 139, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 10
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        RetornoBarredo10,  
        [  
            { carrilDestino: 0, posOrigen: 43, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 8
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        RetornoBarredo8,  
        [  
            { carrilDestino: 0, posOrigen: 70, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 6
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        RetornoBarredo6,  
        [  
            { carrilDestino: 0, posOrigen: 101, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 4
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        RetornoBarredo4,  
        [  
            { carrilDestino: 0, posOrigen: 131, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 2
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        RetornoBarredo2,  
        [  
            { carrilDestino: 0, posOrigen: 156, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 2
    /*conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        1,  
        Calle_Miguel_Anda_y_Barredo,  
        [  
            { carrilDestino: 1, posOrigen: 91, posDestino: 0, probabilidad: 0.5 },
            { carrilDestino: 0, posOrigen: 92, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    // ANDA BARREDO 2 A RETORNO BARREDO 2
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        1,  
        Calle_Luis_Enrique_Erro_1,  
        [  
            { carrilDestino: 1, posOrigen: 167, posDestino: 0, probabilidad: 0.5 },
            { carrilDestino: 0, posOrigen: 168, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));*/
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        2,  
        Calle_Luis_Enrique_Erro_3,  
        [  
            { carrilDestino: 1, posOrigen: 105, posDestino: 0, probabilidad: 0.5 },
            { carrilDestino: 0, posOrigen: 106, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        Retorno2,  
        [  
            { carrilDestino: 0, posOrigen: 110, posDestino: 0, probabilidad: 0.2 },
            { carrilDestino: 1, posOrigen: 111, posDestino: 0, probabilidad: 0.1 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        RetornoBatizD2,  
        [  
            { carrilDestino: 0, posOrigen: 127, posDestino: 0, probabilidad: 0.52 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        RetornoSec2,  
        [  
            { carrilDestino: 0, posOrigen: 189, posDestino: 0, probabilidad: 0.25 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz5,  
        0,  
        RetornoBernard2,  
        [  
            { carrilDestino: 0, posOrigen: 2, posDestino: 0, probabilidad: 0.25 }
        ]  
    ));
    /*
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz,  
        0,  
        RetornoBernard2,  
        [  
            { carrilDestino: 0, posOrigen: 303, posDestino: 0, probabilidad: 0.09 }
        ]  
    ));*/
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        Retorno1,  
        [  
            { carrilDestino: 0, posOrigen: 92, posDestino: 0, probabilidad: 0.3 },
            { carrilDestino: 1, posOrigen: 93, posDestino: 0, probabilidad: 0.15 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        2,  
        Calle_Luis_Enrique_Erro_2,  
        [  
            { carrilDestino: 1, posOrigen: 87, posDestino: 0, probabilidad: 0.5 },
            { carrilDestino: 0, posOrigen: 88, posDestino: 0, probabilidad: 0.5 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        RetornoBatizD,  
        [  
            { carrilDestino: 0, posOrigen: 70, posDestino: 0, probabilidad: 0.4 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        RetornoSec,  
        [  
            { carrilDestino: 0, posOrigen: 8, posDestino: 0, probabilidad: 0.2 }
        ]  
    ));
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz6,  
        0,  
        RetornoBernard,  
        [  
            { carrilDestino: 0, posOrigen: 12, posDestino: 0, probabilidad: 0.27 }
        ]  
    ));
    
    // Av. Wilfrido Massieu ← a Retorno Wilfrido. ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido,  
        [  
            { carrilDestino: 0, posOrigen: 336, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // ============================================  
    // CONEXIONES DE INCORPORACIÓN  
    // ============================================
    
    // Av. Juan de Dios Batiz ← a Av. Miguel Othon de Mendizabal →  
    conexionesCA.push(...crearConexionIncorporacion(  
        Avenida_Juan_de_Dios_Batiz7,  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        2,  
        56  
    ));
    
    // Calle M. Luisa Estampa Ort. → a Av. Miguel Othon de Mendizabal →  
    conexionesCA.push(...crearConexionIncorporacion(  
        María_L_Estampa_Ortigoza,  
        Avenida_Miguel_Othon_de_Mendizabal_1,  
        2,  
        144  
    ));
    
    // Av. Miguel Bernard → a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        Avenida_Miguel_Bernard,  
        Avenida_Juan_de_Dios_Batiz5,  
        0,  
        17,
        1 
    ));
    
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Circuito_Interior_2,  
        Avenida_Juan_de_Dios_Batiz4,  
        2,  
        4  
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Circuito_Interior_1,  
        Calle_Luis_Enrique_Erro_3,  
        1,  
        114  
    ));
    // Retorno torres ← a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        Retornotorres2,  
        Avenida_Juan_de_Dios_Batiz3,  
        0,  
        24  
    ));
    
    // Retorno torres → a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        Retornotorres,  
        Avenida_Juan_de_Dios_Batiz7,  
        0,  
        74  
    ));
    
    // Retorno ESCOM → a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoESCOM2,  
        Avenida_Juan_de_Dios_Batiz7,  
        0,  
        39  
    ));
    
    // Retorno ESCOM ← a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoESCOM,  
        Avenida_Juan_de_Dios_Batiz3,  
        0,  
        60  
    ));
    
    // Retorno Estampa → a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoEStampa2,  
        Avenida_Juan_de_Dios_Batiz7,  
        0,  
        5  
    ));
    
    // Retorno Estampa ← a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoEstampa,  
        Avenida_Juan_de_Dios_Batiz3,  
        0,  
        94  
    ));
    
    // Calle M. Luisa Estampa Ort. ← a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        María_L_Estampa_Ortigoza2,  
        Avenida_Juan_de_Dios_Batiz7,  
        2,  
        5  
    ));
    
    // Retorno Juan F. → a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoJuan2,  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        193 
    ));
    
    // Retorno Juan F. ← a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoJuan,  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        6  
    ));
    
    // Retorno Juan F. 2 ← a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoJuanD,  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        29  
    ));
    
    // Retorno Juan F. 2 → a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoJuanD2,  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        170  
    ));
    
    // Retorno Batiz ← a Av. Juan de Dios Batiz →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBatiz,  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        68  
    ));
    
    // Retorno Batiz → a Av. Juan de Dios Batiz ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBatiz2,  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        131  
    ));
    
    // Retorno Erro 2 ← a Calle Luis Enrique Erro Tramo 2 ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro2,  
        Calle_Luis_Enrique_Erro_4,  
        0,  
        22,
        1
    ));
    
    // Calle Luis Enrique Erro Tramo 2 → a Retorno Erro 1 ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Luis_Enrique_Erro_2,  
        RetornoErro1,  
        0,  
        0,
        1
    ));
    
    // Retorno Erro 1 ← a Calle Luis Enrique Erro Tramo 2 ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro1,  
        Calle_Luis_Enrique_Erro_4,  
        0,  
        0,
        1
    ));
    
    //nuevas
    // ============================================  
    // CONEXIONES PROBABILÍSTICAS  
    // ============================================
    
    // Av. Juan de Dios Batiz ← a Retorno Batiz →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        RetornoJuanD2,  
        [  
            { carrilDestino: 0, posOrigen: 28, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu → a Retorno Escalera ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoEscalera,  
        [  
            { carrilDestino: 0, posOrigen: 313, posDestino: 0, probabilidad: 0.2 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu ← a Retorno Escalera →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        RetornoEscalera2,  
        [  
            { carrilDestino: 0, posOrigen: 27, posDestino: 0, probabilidad: 0.14 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu → a Retorno Wilfrido1 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        RetornoWilfrido1,  
        [  
            { carrilDestino: 0, posOrigen: 135, posDestino: 0, probabilidad: 0.17 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu ← a Retorno Wilfrido2 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido2,  
        [  
            { carrilDestino: 0, posOrigen: 203, posDestino: 0, probabilidad: 0.22 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu → a Retorno Wilfrido11 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        RetornoWilfrido11,  
        [  
            { carrilDestino: 0, posOrigen: 173, posDestino: 0, probabilidad: 1 }  
        ]  
    ));

    // Av. Wilfrido Massieu ← a Retorno Wilfrido3 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        RetornoWilfrido3,  
        [  
            { carrilDestino: 0, posOrigen: 164, posDestino: 0, probabilidad: 0.3 }  // 1 SIGNIFICA 100%
        ]  
    )); 

    // Av. Wilfrido Massieu → a Retorno Wilfrido4 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido4,  
        [  
            { carrilDestino: 0, posOrigen: 176, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu ← a Retorno Wilfrido10 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido10,  
        [  
            { carrilDestino: 0, posOrigen: 165, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu → a Retorno Wilfrido5 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido5,  
        [  
            { carrilDestino: 0, posOrigen: 97, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    // Av. Wilfrido Massieu → a Retorno Wilfrido6 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        RetornoWilfrido6,  
        [  
            { carrilDestino: 0, posOrigen: 280, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu ← a Retorno Wilfrido7 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido7,  
        [  
            { carrilDestino: 0, posOrigen: 61, posDestino: 0, probabilidad: 0.4 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu → a Retorno Wilfrido8 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        RetornoWilfrido8,  
        [  
            { carrilDestino: 0, posOrigen: 331, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Av. Wilfrido Massieu ← a Retorno Wilfrido9 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        RetornoWilfrido9,  
        [  
            { carrilDestino: 0, posOrigen: 8, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // ============================================  
    // CONEXIONES DE INCORPORACIÓN  
    // ============================================
    
    // Retorno Wilfrido. ← a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        6 
    ));
    
    // Retorno Escalera ← a Av. Wilfrido Massieu ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoEscalera,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        28  
    ));
    
    // Retorno Escalera → a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoEscalera2,  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        314  
    ));
    
    // Retorno Wilfrido1 ← a Av. Wilfrido Massieu ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido1,  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        204  
    ));
    
    // Retorno Wilfrido2 → a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido2,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        136  
    ));
    
    // Retorno Wilfrido3 → a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido3,  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        177  
    ));
    
    // Retorno Wilfrido11 → a Av. Wilfrido Massieu ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido11,  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        166  
    ));
    
    // Retorno Wilfrido10 ← a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido10,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        174  
    ));
    
    // Retorno Wilfrido4 ← a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido4,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        165  
    ));
    
    // Retorno Wilfrido5 → a Av. Wilfrido Massieu ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido5,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        245  
    ));
    
    // AV Wilfrido ← a Av. Cien Metros ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        Avenida_Wilfrido_Massieu_1,  
        Avenida_Cien_Metros2,  
        2,  
        40  
    ));

    // AV Wilfrido → a Av. IPN ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        Avenida_Wilfrido_Massieu_2,  
        Avenida_IPN,  
        1,  
        222 
    ));

    // Retorno Wilfrido6 → a Av. Wilfrido Massieu ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido6,  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        62  
    ));
    
    // Retorno Wilfrido7 ← a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido7,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        281 
    ));
    
    // Retorno Wilfrido8 → a Av. Wilfrido Massieu ←  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido8,  
        Avenida_Wilfrido_Massieu_1,  
        0,  
        9  
    ));
    
    // Retorno Wilfrido9 ← a Av. Wilfrido Massieu →  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoWilfrido9,  
        Avenida_Wilfrido_Massieu_2,  
        0,  
        332  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Miguel_Anda_y_Barredo2,  
        Avenida_Wilfrido_Massieu_1,  
        1,  
        98  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Miguel_Anda_y_Barredo,  
        Avenida_Juan_de_Dios_Batiz4,  
        2,  
        192  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Luis_Enrique_Erro_3,  
        Avenida_Wilfrido_Massieu_1,  
        1,  
        177  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro8,  
        Calle_Luis_Enrique_Erro_3,  
        0,  
        121  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro7,  
        Calle_Luis_Enrique_Erro_1,  
        0,  
        58  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro6,  
        Calle_Luis_Enrique_Erro_3,  
        0,  
        48  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro5,  
        Calle_Luis_Enrique_Erro_1,  
        0,  
        131  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro4,  
        Calle_Luis_Enrique_Erro_3,  
        0,  
        19  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoErro3,  
        Calle_Luis_Enrique_Erro_1,  
        0,  
        160  
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Luis_Enrique_Erro_1,  
        Avenida_Juan_de_Dios_Batiz4,  
        2,  
        110  
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        Retorno1,  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        105,
        1 
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        Retorno2,  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        87,
        1  
    ));  
    conexionesCA.push(...crearConexionIncorporacion(  
        Calle_Luis_Enrique_Erro_4,  
        Avenida_Juan_de_Dios_Batiz2,  
        2,  
        92 
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBatizD2,  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        71 
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBatizD,  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        128 
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoSec2,  
        Avenida_Juan_de_Dios_Batiz2,  
        0,  
        9 
    )); 
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoSec,  
        Avenida_Juan_de_Dios_Batiz4,  
        0,  
        190 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBernard2,  
        Avenida_Juan_de_Dios_Batiz6,  
        0,  
        13 
    )); 
    
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBernard,  
        Avenida_Juan_de_Dios_Batiz5,  
        0,  
        3 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        Avenida_Juan_de_Dios_Batiz5,  
        Avenida_IPN,  
        1,  
        25 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo10,  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        140 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo9,  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        44
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo8,  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        112 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo7,  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        72 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo6,  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        82 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo5,  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        102
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo4,  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        52 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo3,  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        132
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo2,  
        Calle_Miguel_Anda_y_Barredo2,  
        0,  
        27 
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        RetornoBarredo1,  
        Calle_Miguel_Anda_y_Barredo,  
        0,  
        157
    ));
    conexionesCA.push(...crearConexionIncorporacion(  
        Generador_3,  
        Avenida_Miguel_Bernard,  
        0,  
        10 
    ));

    // Bernard a Batiz ← 
    conexionesCA.push(...crearConexionProbabilistica(  
        Avenida_Miguel_Bernard,  
        2,  
        Avenida_Juan_de_Dios_Batiz6,  
        [  
            { carrilDestino: 2, posOrigen: 179, posDestino: 0, probabilidad: 0.15 },
            { carrilDestino: 1, posOrigen: 180, posDestino: 0, probabilidad: 0.1 }, 
            { carrilDestino: 0, posOrigen: 181, posDestino: 0, probabilidad: 0.05 }  
        ]  
    ));
    // Calle Luis Enrique Erro ← a Retorno Erro 3 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_3,  
        0,  
        RetornoErro3,  
        [  
            { carrilDestino: 0, posOrigen: 18, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Calle Luis Enrique Erro → a Retorno Erro 3 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_1,  
        0,  
        RetornoErro4,  
        [  
            { carrilDestino: 0, posOrigen: 159, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Calle Luis Enrique Erro ← a Retorno Erro 4 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_3,  
        0,  
        RetornoErro5,  
        [  
            { carrilDestino: 0, posOrigen: 47, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Calle Luis Enrique Erro → a Retorno Erro 4 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_1,  
        0,  
        RetornoErro6,  
        [  
            { carrilDestino: 0, posOrigen: 130, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Calle Luis Enrique Erro ← a Retorno Erro 5 →  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_3,  
        0,  
        RetornoErro7,  
        [  
            { carrilDestino: 0, posOrigen: 120, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));
    
    // Calle Luis Enrique Erro → a Retorno Erro 5 ←  
    conexionesCA.push(...crearConexionProbabilistica(  
        Calle_Luis_Enrique_Erro_1,  
        0,  
        RetornoErro8,  
        [  
            { carrilDestino: 0, posOrigen: 57, posDestino: 0, probabilidad: 0.3 }  
        ]  
    ));  

    registrarConexiones(conexionesCA);
    conexiones = conexionesCA;

    calles.forEach(calle => {
        let option = document.createElement("option");
        option.value = calles.indexOf(calle);
        option.textContent = calle.nombre;
        selectCalle.appendChild(option);
    });

    const btnPauseResume = document.getElementById('btnPauseResume');
    const btnConexiones = document.getElementById('btnConexiones');

    const btnPaso = document.getElementById('btnPaso');
    const velocidadSlider = document.getElementById('velocidadSlider');
    const velocidadValorSpan = document.getElementById('velocidadValor');
    const btnBorrar = document.getElementById('btnBorrar');
    const btnRandom = document.getElementById('btnRandom');
    const probabilidadSlider = document.getElementById('probabilidadSlider');
    const probabilidadValor = document.getElementById('probabilidadValor');

    function calcularIntervaloDesdeSlider(valorSlider) {
        const rangoSlider = maxVelocidadSlider - minVelocidadSlider;
        const rangoIntervalo = maxIntervalo - minIntervalo;
        if (rangoSlider === 0) return intervaloDeseado;
        const normalizado = (valorSlider - minVelocidadSlider) / rangoSlider;
        return Math.round(maxIntervalo - (normalizado * rangoIntervalo));
    }

    function calcularSliderDesdeIntervalo(intervalo) {
        const rangoSlider = maxVelocidadSlider - minVelocidadSlider;
        const rangoIntervalo = maxIntervalo - minIntervalo;
        if (rangoIntervalo === 0) return minVelocidadSlider;
        const normalizado = (maxIntervalo - Math.max(minIntervalo, Math.min(maxIntervalo, intervalo))) / rangoIntervalo;
        return Math.round(minVelocidadSlider + (normalizado * rangoSlider));
    }

    intervaloDeseado = calcularIntervaloDesdeSlider(50);

    btnActualizarCalle.addEventListener("click", () => {
        const calleIndex = selectCalle.value;
        const valorSalto = parseFloat(inputProbabilidadSalto.value);

        // Validar que haya una calle seleccionada
        if (calleIndex === "") {
            mostrarNotificacion('error', 'Error', 'Por favor selecciona una calle primero.');
            return;
        }

        const calleActual = calles[calleIndex];
        const nombreCalle = calleActual.nombre;
        const esTipoGenerador = calleActual.tipo === TIPOS.GENERADOR;

        let valorGeneracion = 0;
        let mensajeGeneracion = '';

        // Solo validar y actualizar probabilidad de generación si es tipo GENERADOR
        if (esTipoGenerador) {
            valorGeneracion = parseFloat(inputProbabilidadGeneracion.value);

            // Validar valores de probabilidad de generación
            if (isNaN(valorGeneracion) || valorGeneracion < 0 || valorGeneracion > 100) {
                inputProbabilidadGeneracion.classList.add('is-invalid');
                mostrarNotificacion('error', 'Error de Validación', 'La probabilidad de generación debe estar entre 0 y 100.');
                return;
            } else {
                inputProbabilidadGeneracion.classList.remove('is-invalid');
            }

            mensajeGeneracion = `• Generación: ${valorGeneracion}%\n`;
        }

        // Validar valores de probabilidad de salto (siempre se valida)
        if (isNaN(valorSalto) || valorSalto < 0 || valorSalto > 100) {
            inputProbabilidadSalto.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'La probabilidad de cambio de carril debe estar entre 0 y 100.');
            return;
        } else {
            inputProbabilidadSalto.classList.remove('is-invalid');
        }

        // Aplicar cambios (convertir a 0-1)
        const nuevaProbabilidadSalto = valorSalto / 100;

        if (esTipoGenerador) {
            const nuevaProbabilidad = valorGeneracion / 100;
            calleActual.probabilidadGeneracion = nuevaProbabilidad;
            console.log(`✏️ Actualizada ${nombreCalle}: Gen=${nuevaProbabilidad}, Salto=${nuevaProbabilidadSalto}`);
        } else {
            console.log(`✏️ Actualizada ${nombreCalle}: Salto=${nuevaProbabilidadSalto} (no aplica generación, tipo: ${calleActual.tipo})`);
        }

        calleActual.probabilidadSaltoDeCarril = nuevaProbabilidadSalto;

        // Mostrar notificación de éxito
        mostrarNotificacion('success', 'Cambios Aplicados',
            `Se actualizaron las probabilidades de "${nombreCalle}":\n` +
            mensajeGeneracion +
            `• Cambio de carril: ${valorSalto}%`);
    });

    // Validación en tiempo real para inputs de probabilidades
    inputProbabilidadGeneracion.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (isNaN(valor) || valor < 0 || valor > 100) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    inputProbabilidadSalto.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (isNaN(valor) || valor < 0 || valor > 100) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Prevenir valores fuera del rango al pegar o escribir
    [inputProbabilidadGeneracion, inputProbabilidadSalto].forEach(input => {
        input.addEventListener('blur', function() {
            let valor = parseFloat(this.value);
            if (!isNaN(valor)) {
                // Forzar el valor dentro del rango 0-100
                if (valor < 0) valor = 0;
                if (valor > 100) valor = 100;
                this.value = valor;
            }
        });
    });

    function paso() {
        // 1. Generar nuevos vehículos
        calles.forEach(calle => {
            if (calle.tipo === TIPOS.GENERADOR) {
                generarCelulas(calle);
            }
        });
        
        // 2. Transferir vehículos por conexiones
        let transferenciasExitosas = 0;
        let transferenciasBloqueadas = 0;
        
        conexiones.forEach((conexion) => {
            if (conexion instanceof ConexionCA) {
                const resultado = conexion.transferir();
                if (resultado === true) {
                    transferenciasExitosas++;
                } else if (conexion.bloqueada) {
                    transferenciasBloqueadas++;
                }
            }
        });

        // ✅ CRÍTICO: PRIMERO cambiar carriles
        calles.forEach(cambioCarril);

        // ✅ CRÍTICO: LUEGO actualizar estado de cada calle
        calles.forEach((calle, index) => {
            actualizarCalle(calle, index);
        });

        // Avanzar tiempo virtual (función definida en tiempo.js)
        if (window.avanzarTiempo) {
            window.avanzarTiempo();
        }

        // Actualizar métricas (función definida en graficas.js)
        if (window.updateMetrics) {
            window.updateMetrics();
        }

        // Actualizar contadores de estacionamientos si están visibles
        if (window.mostrarContadores && window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
            window.pixiApp.sceneManager.renderContadores();
        }
        renderizarCanvas();

        // Actualizar información en tiempo real (barra estilo Golly)
        if (window.updateSimulationInfo) {
            window.updateSimulationInfo();
        }
    }

    function animate(tiempoActual) {
        if (!tiempoAnterior) tiempoAnterior = tiempoActual;

        // 🔧 FIX: Solo ejecutar paso() si NO está pausado
        if (!isPaused) {
            const tiempoTranscurrido = tiempoActual - tiempoAnterior;
            if (tiempoTranscurrido >= intervaloDeseado) {
                paso();
                tiempoAnterior = tiempoActual;
            }
        } else {
            // Si está pausado, actualizar tiempoAnterior para evitar saltos temporales
            tiempoAnterior = tiempoActual;
        }

        animationId = requestAnimationFrame(animate);
    }

    animationId = requestAnimationFrame(animate);

    if (btnPauseResume) {
        btnPauseResume.addEventListener('click', () => {
            isPaused = !isPaused;
            if (isPaused) {
                // No cancelar animationFrame - dejar que siga corriendo pero sin ejecutar paso()
                btnPauseResume.textContent = '▶️';
                btnPaso.disabled = false;
                console.log('⏸️ Simulación pausada');
            } else {
                // Resetear tiempoAnterior para evitar saltos temporales al reanudar
                tiempoAnterior = performance.now();
                btnPauseResume.textContent = '⏸';
                btnPaso.disabled = true;
                console.log('▶️ Simulación reanudada');
            }
        });
    }

    if (btnConexiones) {
        btnConexiones.addEventListener('click', () => {
            mostrarConexiones = !mostrarConexiones;
            window.mostrarConexiones = mostrarConexiones;
            // Solo emoji, el tooltip ya explica la función
            btnConexiones.textContent = mostrarConexiones ? '🔗' : '🔗';

            // Si usamos PixiJS, forzar renderizado de conexiones
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                if (mostrarConexiones) {
                    // Renderizar conexiones
                    window.pixiApp.sceneManager.renderAll();
                } else {
                    // Limpiar conexiones
                    if (window.pixiApp.sceneManager.conexionRenderer) {
                        window.pixiApp.sceneManager.conexionRenderer.clearAll();
                    }
                }
            }

            renderizarCanvas();
        });
    }

    const btnVertices = document.getElementById('btnVertices');
    if (btnVertices) {
        btnVertices.addEventListener('click', () => {
            mostrarVertices = !mostrarVertices;
            window.mostrarVertices = mostrarVertices;
            // Solo emoji, el tooltip ya explica la función
            btnVertices.textContent = mostrarVertices ? '📍' : '📍';

            // Si usamos PixiJS, forzar renderizado de vértices
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                if (mostrarVertices) {
                    // Renderizar vértices
                    window.pixiApp.sceneManager.renderAll();
                } else {
                    // Limpiar vértices
                    if (window.pixiApp.sceneManager.uiRenderer) {
                        window.pixiApp.sceneManager.uiRenderer.clearVertices();
                    }
                }
            }

            renderizarCanvas();
        });
    }

    const btnEtiquetas = document.getElementById('btnEtiquetas');
    if (btnEtiquetas) {
        btnEtiquetas.addEventListener('click', () => {
            mostrarEtiquetas = !mostrarEtiquetas;
            window.mostrarEtiquetas = mostrarEtiquetas; // Sincronizar con window
            // Cambiar entre etiqueta visible y etiqueta tachada
            btnEtiquetas.textContent = mostrarEtiquetas ? '🏷️' : '🚫';

            // Actualizar etiquetas en PixiJS
            if (window.pixiApp && window.pixiApp.sceneManager) {
                // Actualizar etiquetas de edificios
                if (window.pixiApp.sceneManager.edificioRenderer) {
                    window.pixiApp.sceneManager.edificioRenderer.updateLabelsVisibility(mostrarEtiquetas);
                }

                // Actualizar etiquetas de calles
                if (window.pixiApp.sceneManager.uiRenderer) {
                    if (mostrarEtiquetas) {
                        window.pixiApp.sceneManager.uiRenderer.updateEtiquetas(calles);
                    } else {
                        window.pixiApp.sceneManager.uiRenderer.clearEtiquetas();
                    }
                }
            }

            renderizarCanvas();
        });
    }

    const btnContadores = document.getElementById('btnContadores');
    if (btnContadores) {
        btnContadores.addEventListener('click', () => {
            window.mostrarContadores = !window.mostrarContadores;
            btnContadores.textContent = window.mostrarContadores ? '🔢' : '🚫';

            // Si usamos PixiJS, forzar re-renderizado
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                if (window.mostrarContadores) {
                    window.pixiApp.sceneManager.renderContadores();
                } else {
                    window.pixiApp.sceneManager.clearContadores();
                }
            }
            renderizarCanvas();
        });
    }

    if (btnPaso) {
        btnPaso.addEventListener('click', () => {
            paso();
        });
    }

    if (btnBorrar) {
        btnBorrar.addEventListener('click', () => {
            limpiarCeldas();
        });
    }

    if (btnRandom) {
        btnRandom.addEventListener('click', () => {
            calles.forEach(calle => {
                for (let c = 0; c < calle.carriles; c++) {
                    const carrilActual = calle.arreglo[c];
                    if (carrilActual) {
                        for (let i = 0; i < calle.tamano; i++) {
                            // Respetar obstáculos, inundaciones y bloqueos (valor 7)
                            if (carrilActual[i] === 7) {
                                continue; // No modificar estas celdas
                            }

                            if (Math.random() < probabilidadGeneracionGeneral) {
                                // Generar tipo aleatorio de vehículo (1-6)
                                carrilActual[i] = Math.floor(Math.random() * 6) + 1;
                            } else {
                                carrilActual[i] = 0;
                            }
                        }
                    }
                }
            });
            renderizarCanvas();
        });
    }

    if (velocidadSlider && velocidadValorSpan) {
        const valorInicialSlider = calcularSliderDesdeIntervalo(intervaloDeseado);
        velocidadSlider.value = valorInicialSlider;
        velocidadValorSpan.textContent = valorInicialSlider;

        // Calcular y exponer velocidad de simulación normalizada (frames por segundo)
        // A 1000ms = 1 fps, a 0ms = máxima velocidad posible del navegador
        window.velocidadSimulacion = intervaloDeseado > 0 ? maxIntervalo / intervaloDeseado : Infinity;
        window.intervaloDeseado = intervaloDeseado;

        velocidadSlider.addEventListener('input', () => {
            const valorActualSlider = parseFloat(velocidadSlider.value);
            intervaloDeseado = calcularIntervaloDesdeSlider(valorActualSlider);
            velocidadValorSpan.textContent = valorActualSlider;

            // Actualizar velocidad de simulación normalizada (protección contra división por cero)
            window.velocidadSimulacion = intervaloDeseado > 0 ? maxIntervalo / intervaloDeseado : Infinity;
            window.intervaloDeseado = intervaloDeseado;
        });
    }

    if (probabilidadSlider && probabilidadValor) {
        const valorInicialPorcentaje = probabilidadGeneracionGeneral * 100;
        probabilidadSlider.value = valorInicialPorcentaje;
        probabilidadValor.textContent = valorInicialPorcentaje + '%';
        probabilidadSlider.addEventListener('input', () => {
            const valorSlider = probabilidadSlider.value;
            const nuevaProbabilidad = parseFloat(valorSlider) / 100.0;
            probabilidadGeneracionGeneral = nuevaProbabilidad;
            probabilidadValor.textContent = valorSlider + '%';

            /* // Aplicar la nueva probabilidad a todos los generadores
            // Solo si los perfiles están desactivados (el slider solo funciona cuando perfiles está OFF)
            calles.forEach(calle => {
                if (calle.tipo === TIPOS.GENERADOR) {
                    calle.probabilidadGeneracion = nuevaProbabilidad;
                }
            }); */

            console.log(`🎚️ Probabilidad de generación global: ${valorSlider}% aplicada a todos los generadores`);
        });
    }

    // Centrar la vista en el mapa (especialmente útil en móviles)
    console.log("📍 Centrando vista en el mapa...");
    centrarVistaEnMapa();

    // Renderizar canvas inicial para asegurar que se vea en móviles
    console.log("🎨 Renderizado inicial del canvas después de inicialización");
    renderizarCanvas();
}

// Zoom y Desplazamiento
canvas.addEventListener("wheel", event => {
    event.preventDefault();

    const zoomIntensity = 1.1;
    const direction = event.deltaY < 0 ? 1 : -1;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const worldX_before = (mouseX - offsetX) / escala;
    const worldY_before = (mouseY - offsetY) / escala;

    const escala_anterior = escala;
    escala = escala_anterior * Math.pow(zoomIntensity, direction);

    const minEscala = 0.5;
    const maxEscala = 20.0;
    escala = Math.max(minEscala, Math.min(maxEscala, escala));
    if (escala === escala_anterior) {
        return;
    }

    offsetX = mouseX - worldX_before * escala;
    offsetY = mouseY - worldY_before * escala;

    aplicarLimitesOffset();

    // Actualizar handles del editor si está disponible y en modo edición
    if (window.editorCalles && window.editorCalles.modoEdicion) {
        window.editorCalles.actualizarPosicionHandles();
    }

    renderizarCanvas();
});

canvas.addEventListener("mousedown", event => {
    console.log('🟨 trafico.js canvas.mousedown EJECUTADO');

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaledMouseX = mouseX * scaleX;
    const scaledMouseY = mouseY * scaleY;

    const worldX = (scaledMouseX - offsetX) / escala;
    const worldY = (scaledMouseY - offsetY) / escala;

    // NUEVO: Detectar SHIFT + clic para arrastrar calle en modo edición
    if (event.shiftKey && window.editorCalles && window.editorCalles.modoEdicion) {
        const resultadoCalle = encontrarCalleEnPunto(worldX, worldY);

        if (resultadoCalle && resultadoCalle.calle) {
            event.preventDefault();
            isDraggingStreet = true;
            draggedStreet = resultadoCalle.calle;
            dragStreetStartX = event.clientX;
            dragStreetStartY = event.clientY;
            dragStreetInitialX = draggedStreet.x;
            dragStreetInitialY = draggedStreet.y;
            canvas.style.cursor = 'move';
            console.log('🚀 Iniciando arrastre de calle:', draggedStreet.nombre);
            return;
        }
    }

    // Intentar detectar vértice primero
    const verticeDetectado = detectarVerticeEnPosicion(worldX, worldY);

    if (verticeDetectado && calleSeleccionada && calleSeleccionada.esCurva) {
        // Iniciar control de vértice
        controlandoVertice = true;
        verticeSeleccionado = {
            calle: calleSeleccionada,
            indice: verticeDetectado.indice,
            vertice: verticeDetectado.vertice
        };
        renderizarCanvas();
        return;
    }

    // Si no hay vértice, iniciar arrastre normal del canvas
    // SOLO si NO estamos usando PixiJS (porque CameraController lo maneja)
    if (!window.USE_PIXI || !pixiInitialized) {
        isDragging = true;
        hasDragged = false;
        dragStartMouseX = event.clientX; // Guardar posición inicial del mouse
        dragStartMouseY = event.clientY; // para calcular distancia de drag
        startX = event.clientX - offsetX;
        startY = event.clientY - offsetY;
    }
});

canvas.addEventListener('click', (event) => {
    console.log('🟩 trafico.js canvas.click EJECUTADO');

    // DEBUG: Log para diagnosticar
    const cameraWasDragging = window.pixiApp?.cameraController?.wasDragging || false;
    console.log('   hasDragged:', hasDragged, 'controlandoVertice:', controlandoVertice, 'isDraggingStreet:', isDraggingStreet, 'cameraWasDragging:', cameraWasDragging);

    // Evitar comportamiento si se está arrastrando o controlando vértice o arrastrando calle
    // También verificar si CameraController estuvo arrastrando (para PixiJS)
    if (hasDragged || controlandoVertice || isDraggingStreet || cameraWasDragging) {
        console.log('⚠️ Click bloqueado');
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaledMouseX = mouseX * scaleX;
    const scaledMouseY = mouseY * scaleY;

    const worldX = (scaledMouseX - offsetX) / escala;
    const worldY = (scaledMouseY - offsetY) / escala;

    // Si se presiona Ctrl (Windows/Linux) o Cmd (Mac), seleccionar calle o edificio
    if (event.ctrlKey || event.metaKey) {
        // Intentar detectar edificio primero (están arriba de las calles visualmente)
        const resultadoEdificio = encontrarEdificioEnPunto(worldX, worldY);
        const resultadoCalle = encontrarCalleEnPunto(worldX, worldY);

        if (resultadoEdificio) {
            const { edificio, edificioIndex } = resultadoEdificio;

            // Limpiar selección de calle
            window.calleSeleccionada = null;
            calleSeleccionada = null;

            // Actualizar selección de edificio
            window.edificioSeleccionado = edificio;
            window.edificioSeleccionado.index = edificioIndex;

            // Actualizar selector de Configuración de Calles (volver a default)
            selectCalle.value = '';

            // Actualizar selectores del Constructor
            const selectTipoObjeto = document.getElementById('selectTipoObjeto');
            const selectEdificio = document.getElementById('selectEdificio');

            if (selectTipoObjeto && selectEdificio) {
                window.modoSeleccion = "constructor";
                selectTipoObjeto.value = 'edificio';

                // Disparar evento change para mostrar el selector correcto
                selectTipoObjeto.dispatchEvent(new Event('change'));

                // Seleccionar el edificio
                selectEdificio.value = edificioIndex;
                selectEdificio.dispatchEvent(new Event('change'));
            }

            renderizarCanvas();
            console.log(`🖱️ Edificio seleccionado por clic: ${edificio.label || 'Edificio ' + (edificioIndex + 1)}`);

        } else if (resultadoCalle) {
            const { calle, calleIndex } = resultadoCalle;

            // Limpiar selección de edificio
            window.edificioSeleccionado = null;

            // Actualizar la selección de calle
            calleSeleccionada = calle;
            window.calleSeleccionada = calle;

            // SIEMPRE actualizar AMBOS selectores de calle

            // 1. Actualizar selector de Configuración de Calles
            selectCalle.value = calleIndex;
            // Actualizar los campos de probabilidad
            inputProbabilidadGeneracion.value = calle.probabilidadGeneracion * 100;
            inputProbabilidadSalto.value = calle.probabilidadSaltoDeCarril * 100;

            // 2. Actualizar selectores del Constructor de Mapas
            const selectTipoObjeto = document.getElementById('selectTipoObjeto');
            const selectCalleEditor = document.getElementById('selectCalleEditor');

            if (selectTipoObjeto && selectCalleEditor) {
                selectTipoObjeto.value = 'calle';

                // Disparar evento change para mostrar el selector correcto
                selectTipoObjeto.dispatchEvent(new Event('change'));

                // Seleccionar la calle en el selector del constructor
                selectCalleEditor.value = calleIndex;
                selectCalleEditor.dispatchEvent(new Event('change'));
            }

            // Establecer modo basado en el acordeón abierto, pero la calle está seleccionada en ambos
            window.modoSeleccion = "configuracion";

            renderizarCanvas();
            console.log(`🖱️ Calle seleccionada por clic: ${calle.nombre} (actualizado en ambos selectores)`);
        }
        return;
    }

    // Comportamiento normal: agregar/quitar vehículos (toggle)
    const celdaObjetivo = encontrarCeldaMasCercana(worldX, worldY);

    console.log('🎯 celdaObjetivo:', celdaObjetivo);

    if (celdaObjetivo) {
        const { calle, carril, indice } = celdaObjetivo;

        console.log('📍 Celda encontrada - Calle:', calle.nombre, 'Carril:', carril, 'Índice:', indice);
        console.log('🔍 Arreglo existe?', calle.arreglo[carril] !== undefined);

        if (calle.arreglo[carril] !== undefined) {
            const currentValue = calle.arreglo[carril][indice];
            console.log('💾 Valor actual de la celda:', currentValue, 'Tipo:', typeof currentValue);

            if (currentValue === 0) {
                // Celda vacía -> Agregar vehículo con tipo aleatorio (1-6)
                const nuevoValor = Math.floor(Math.random() * 6) + 1;
                calle.arreglo[carril][indice] = nuevoValor;
                console.log('➕ Vehículo agregado con valor:', nuevoValor);
            } else {
                // Celda ocupada -> Quitar vehículo
                console.log('🔴 INTENTANDO QUITAR VEHÍCULO - Valor antes:', calle.arreglo[carril][indice]);
                calle.arreglo[carril][indice] = 0;
                console.log('🔴 Valor después de quitar:', calle.arreglo[carril][indice]);
                console.log('➖ Vehículo quitado');
            }

            renderizarCanvas();
        } else {
            console.log('❌ ERROR: El arreglo del carril no existe');
        }
    } else {
        console.log('❌ No se encontró celda objetivo');
    }
});

canvas.addEventListener("mousemove", event => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaledMouseX = mouseX * scaleX;
    const scaledMouseY = mouseY * scaleY;

    const worldX = (scaledMouseX - offsetX) / escala;
    const worldY = (scaledMouseY - offsetY) / escala;

    // Detectar si el mouse está sobre un edificio o calle para mostrar tooltip
    const resultadoEdificio = encontrarEdificioEnPunto(worldX, worldY);
    const resultadoCalle = encontrarCalleEnPunto(worldX, worldY);

    if (resultadoEdificio && resultadoEdificio.edificio.label) {
        canvas.title = resultadoEdificio.edificio.label;
    } else if (resultadoCalle && resultadoCalle.calle.nombre) {
        canvas.title = resultadoCalle.calle.nombre;
    } else {
        canvas.title = "";
    }

    // NUEVO: Si estamos arrastrando una calle con SHIFT
    if (isDraggingStreet && draggedStreet) {
        const deltaX = (event.clientX - dragStreetStartX) / escala;
        const deltaY = (event.clientY - dragStreetStartY) / escala;

        draggedStreet.x = dragStreetInitialX + deltaX;
        draggedStreet.y = dragStreetInitialY + deltaY;

        // Actualizar inputs de posición si el editor está disponible
        if (window.editorCalles) {
            window.editorCalles.actualizarInputsPosicion();
            window.editorCalles.actualizarPosicionHandles();
        }

        renderizarCanvas();
        return;
    }

    // Cambiar cursor si se presiona Ctrl/Cmd o SHIFT
    if (event.ctrlKey || event.metaKey) {
        canvas.style.cursor = (resultadoEdificio || resultadoCalle) ? 'pointer' : 'default';
    } else if (event.shiftKey && window.editorCalles && window.editorCalles.modoEdicion) {
        // Mostrar cursor de movimiento si SHIFT está presionado en modo edición
        canvas.style.cursor = resultadoCalle ? 'move' : 'default';
    } else {
        canvas.style.cursor = isDragging ? 'grabbing' : 'grab';
    }

    // Si estamos controlando un vértice
    if (controlandoVertice && verticeSeleccionado) {
        actualizarVerticePorArrastre(
            verticeSeleccionado.calle,
            verticeSeleccionado.indice,
            worldX,
            worldY
        );
        renderizarCanvas();
        return;
    }

    // Si estamos arrastrando el canvas (solo para Canvas 2D, no PixiJS)
    if (isDragging && (!window.USE_PIXI || !pixiInitialized)) {
        // Calcular distancia desde el punto inicial del drag
        const dragDistanceX = event.clientX - dragStartMouseX;
        const dragDistanceY = event.clientY - dragStartMouseY;
        const dragDistance = Math.sqrt(dragDistanceX * dragDistanceX + dragDistanceY * dragDistanceY);

        // Solo marcar como "dragged" si el movimiento supera el threshold
        // Esto evita que clicks con movimientos mínimos sean considerados drags
        if (dragDistance >= DRAG_THRESHOLD) {
            hasDragged = true;
        }

        offsetX = (event.clientX - startX);
        offsetY = (event.clientY - startY);
        aplicarLimitesOffset();

        // Actualizar handles del editor si está disponible y en modo edición
        if (window.editorCalles && window.editorCalles.modoEdicion) {
            window.editorCalles.actualizarPosicionHandles();
        }

        renderizarCanvas();
    }
});

canvas.addEventListener("mouseup", () => {
    // NUEVO: Finalizar arrastre de calle con SHIFT
    if (isDraggingStreet && draggedStreet) {
        console.log('✅ Arrastre de calle finalizado:', draggedStreet.nombre,
                    `Nueva posición: (${Math.round(draggedStreet.x)}, ${Math.round(draggedStreet.y)})`);

        isDraggingStreet = false;
        draggedStreet = null;
        canvas.style.cursor = 'grab';
        renderizarCanvas();
        return;
    }

    isDragging = false;
    hasDragged = false; // IMPORTANTE: Resetear hasDragged en mouseup
    controlandoVertice = false;
    verticeSeleccionado = null;
    renderizarCanvas();
});

canvas.addEventListener("mouseleave", () => {
    // NUEVO: Cancelar arrastre de calle si el mouse sale del canvas
    if (isDraggingStreet && draggedStreet) {
        isDraggingStreet = false;
        draggedStreet = null;
        canvas.style.cursor = 'grab';
    }

    isDragging = false;
    hasDragged = false; // IMPORTANTE: Resetear hasDragged
    controlandoVertice = false;
    verticeSeleccionado = null;
    renderizarCanvas();
});

// Debug visual PERSISTENTE para móvil (sin consola)
function mostrarDebugMovil(mensaje) {
    // Verificar si el debug está habilitado (solo en móviles)
    const switchDebug = document.getElementById('switchDebugMovil');
    if (switchDebug && !switchDebug.checked) {
        // Debug desactivado, ocultar si existe
        const debugDiv = document.getElementById('debugMovil');
        if (debugDiv) {
            debugDiv.style.display = 'none';
        }
        return;
    }

    let debugDiv = document.getElementById('debugMovil');
    if (!debugDiv) {
        debugDiv = document.createElement('div');
        debugDiv.id = 'debugMovil';
        debugDiv.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 10px;
            background: rgba(0, 0, 0, 0.9);
            color: #0f0;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 11px;
            z-index: 99999;
            max-width: 250px;
            pointer-events: none;
            white-space: pre-line;
            border: 1px solid #0f0;
            line-height: 1.3;
        `;
        document.body.appendChild(debugDiv);
    }
    debugDiv.textContent = mensaje;
    debugDiv.style.display = 'block';

    // NO auto-ocultar - permanece visible
}

// Event listener para el switch de debug móvil
document.addEventListener('DOMContentLoaded', () => {
    const switchDebugMovil = document.getElementById('switchDebugMovil');
    if (switchDebugMovil) {
        switchDebugMovil.addEventListener('change', (event) => {
            const debugDiv = document.getElementById('debugMovil');
            if (debugDiv) {
                debugDiv.style.display = event.target.checked ? 'block' : 'none';
            }
            console.log(`🐛 Debug visual: ${event.target.checked ? 'ACTIVADO' : 'DESACTIVADO'}`);
        });
    }
});

// Función auxiliar: calcular distancia entre dos puntos
function calcularDistancia(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

canvas.addEventListener("touchstart", event => {
    console.log("👆 TOUCHSTART detectado en canvas, toques:", event.touches.length);

    // Detectar pinch zoom (2 dedos)
    if (event.touches.length === 2) {
        isPinching = true;
        isDragging = false; // Deshabilitar arrastre cuando hay pinch

        const touch1 = event.touches[0];
        const touch2 = event.touches[1];

        initialPinchDistance = calcularDistancia(
            touch1.clientX, touch1.clientY,
            touch2.clientX, touch2.clientY
        );
        lastPinchDistance = initialPinchDistance;

        console.log(`🤏 PINCH INICIADO - Distancia inicial: ${initialPinchDistance.toFixed(0)}px`);
        mostrarDebugMovil(`PINCH ZOOM\nDistancia: ${initialPinchDistance.toFixed(0)}px\nEscala: ${escala.toFixed(2)}x`);
        return;
    }

    // Un solo dedo: arrastre normal
    mostrarDebugMovil(`TOUCHSTART detectado\nPos: (${event.touches[0].clientX}, ${event.touches[0].clientY})`);

    // Guardar posición inicial del touch
    lastTouchX = event.touches[0].clientX;
    lastTouchY = event.touches[0].clientY;

    // Iniciar arrastre
    isDragging = true;
    isPinching = false;
    hasDragged = false;

    console.log(`   Posición inicial: (${lastTouchX}, ${lastTouchY}), isDragging=${isDragging}`);
}, { passive: false });

canvas.addEventListener("touchmove", event => {
    event.preventDefault();

    // Manejar pinch zoom (2 dedos)
    if (event.touches.length === 2 && isPinching) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];

        const currentDistance = calcularDistancia(
            touch1.clientX, touch1.clientY,
            touch2.clientX, touch2.clientY
        );

        // Calcular el factor de zoom basado en el cambio de distancia
        const zoomFactor = currentDistance / lastPinchDistance;

        // Calcular el centro del pinch (punto medio entre los dos dedos)
        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;

        const rect = canvas.getBoundingClientRect();
        const canvasCenterX = centerX - rect.left;
        const canvasCenterY = centerY - rect.top;

        // Calcular coordenadas del mundo antes del zoom
        const worldX_before = (canvasCenterX - offsetX) / escala;
        const worldY_before = (canvasCenterY - offsetY) / escala;

        // Aplicar zoom
        const escalaAnterior = escala;
        escala *= zoomFactor;

        // Límites de zoom
        const minEscala = 0.1;
        const maxEscala = 5.0;
        escala = Math.max(minEscala, Math.min(maxEscala, escala));

        // Ajustar offset para mantener el punto del pinch en la misma posición visual
        if (escala !== escalaAnterior) {
            offsetX = canvasCenterX - worldX_before * escala;
            offsetY = canvasCenterY - worldY_before * escala;

            // Sincronizar con window
            window.offsetX = offsetX;
            window.offsetY = offsetY;
            window.escala = escala;

            aplicarLimitesOffset();

            // Re-sincronizar después de aplicar límites
            offsetX = window.offsetX;
            offsetY = window.offsetY;
        }

        lastPinchDistance = currentDistance;

        console.log(`🤏 PINCH - Distancia: ${currentDistance.toFixed(0)}, Factor: ${zoomFactor.toFixed(3)}, Escala: ${escala.toFixed(2)}`);
        mostrarDebugMovil(`PINCH ZOOM\nDistancia: ${currentDistance.toFixed(0)}px\nEscala: ${escala.toFixed(2)}x\nFactor: ${zoomFactor.toFixed(3)}`);

        renderizarCanvas();
        return;
    }

    console.log("👆 TOUCHMOVE detectado", isDragging ? "(arrastrando)" : "(NO arrastrando)");

    if (!isDragging) {
        console.warn("   ⚠️ TOUCHMOVE ignorado porque isDragging=false");
        mostrarDebugMovil(`TOUCHMOVE\nisDragging=FALSE\n⚠️ BLOQUEADO`);
        return;
    }

    // Marcar que hubo movimiento
    hasDragged = true;

    // Calcular delta del movimiento
    const deltaX = event.touches[0].clientX - lastTouchX;
    const deltaY = event.touches[0].clientY - lastTouchY;

    console.log(`   Delta: (${deltaX}, ${deltaY})`);

    // Actualizar offset (tanto local como global)
    offsetX += deltaX;
    offsetY += deltaY;

    // IMPORTANTE: Sincronizar con window ANTES de aplicar límites
    window.offsetX = offsetX;
    window.offsetY = offsetY;
    window.escala = escala;

    console.log(`   Nuevo offset: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);

    // Mostrar debug actualizado
    mostrarDebugMovil(`TOUCHMOVE OK\nDelta: (${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})\nOffset: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})\nisDragging: ${isDragging}`);

    // Actualizar posición del touch
    lastTouchX = event.touches[0].clientX;
    lastTouchY = event.touches[0].clientY;

    // Si usamos PixiJS, actualizar el CameraController
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.cameraController) {
        window.pixiApp.cameraController.setPosition(offsetX, offsetY);
    } else {
        // Aplicar límites (que volverá a actualizar window.offsetX/Y si es necesario)
        aplicarLimitesOffset();
        // Re-sincronizar después de aplicar límites
        offsetX = window.offsetX;
        offsetY = window.offsetY;
    }

    renderizarCanvas();
}, { passive: false });

canvas.addEventListener("touchend", event => {
    // Si se levanta un dedo durante pinch, terminar pinch
    if (event.touches.length < 2) {
        isPinching = false;
        initialPinchDistance = 0;
        lastPinchDistance = 0;
    }

    // Si no quedan dedos, resetear todo
    if (event.touches.length === 0) {
        isDragging = false;
        isPinching = false;

        // Si no hubo movimiento significativo, podría ser un tap
        if (!hasDragged) {
            console.log("Tap detectado en canvas");
            mostrarDebugMovil(`TOUCHEND\nTap detectado\n(sin movimiento)`);
        } else {
            mostrarDebugMovil(`TOUCHEND\nMovimiento completado`);
        }

        hasDragged = false;
    }
}, { passive: true }); // 📱 OPTIMIZACIÓN: passive=true mejora scroll performance

canvas.addEventListener("touchcancel", event => {
    isDragging = false;
    hasDragged = false;
    isPinching = false;
    initialPinchDistance = 0;
    lastPinchDistance = 0;
}, { passive: true }); // 📱 OPTIMIZACIÓN: passive=true mejora scroll performance

// Event listeners para cambiar el cursor cuando se presiona/suelta Ctrl/Cmd
document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey) {
        canvas.style.cursor = 'pointer';
    }
});

document.addEventListener("keyup", (event) => {
    if (!event.ctrlKey && !event.metaKey) {
        canvas.style.cursor = 'grab';
    }
});

// Variables para el arrastre del rectángulo del minimapa
let arrastandoMinimapa = false;
let minimapaInicialMouseX = 0;
let minimapaInicialMouseY = 0;
let minimapaInicialOffsetX = 0;
let minimapaInicialOffsetY = 0;

// Función auxiliar para verificar si el mouse está sobre el rectángulo rojo del minimapa
function estaEnRectanguloMinimapa(mouseX, mouseY) {
    const params = calcularParametrosMinimapa();
    const { minimapaEscala, minimapaOffsetX, minimapaOffsetY, viewport } = params;

    // Calcular los límites del rectángulo rojo en coordenadas relativas al mundo
    const rectX = viewport.x * minimapaEscala;
    const rectY = viewport.y * minimapaEscala;
    const rectAncho = viewport.ancho * minimapaEscala;
    const rectAlto = viewport.alto * minimapaEscala;

    // Área de detección expandida: mínimo 40px
    const areaDeteccionAncho = Math.max(rectAncho, 40);
    const areaDeteccionAlto = Math.max(rectAlto, 40);

    // Centrar el área expandida sobre el rectángulo real (en coordenadas relativas)
    const areaXRelativo = rectX - (areaDeteccionAncho - rectAncho) / 2;
    const areaYRelativo = rectY - (areaDeteccionAlto - rectAlto) / 2;

    // Convertir área de detección a coordenadas absolutas del canvas
    // (aplicando el mismo translate que se usa en dibujarMinimapa)
    const areaXAbsoluto = minimapaOffsetX + areaXRelativo;
    const areaYAbsoluto = minimapaOffsetY + areaYRelativo;

    // Comparar mouse (en coordenadas absolutas) con área (en coordenadas absolutas)
    return mouseX >= areaXAbsoluto && mouseX <= areaXAbsoluto + areaDeteccionAncho &&
           mouseY >= areaYAbsoluto && mouseY <= areaYAbsoluto + areaDeteccionAlto;
}

minimapaCanvas.addEventListener("mousedown", (event) => {
    const rect = minimapaCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    if (estaEnRectanguloMinimapa(mouseX, mouseY)) {
        arrastandoMinimapa = true;
        minimapaInicialMouseX = mouseX;
        minimapaInicialMouseY = mouseY;
        // IMPORTANTE: Usar las variables globales que son actualizadas por CameraController
        minimapaInicialOffsetX = window.offsetX !== undefined ? window.offsetX : offsetX;
        minimapaInicialOffsetY = window.offsetY !== undefined ? window.offsetY : offsetY;
        minimapaCanvas.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing'; // Cambiar cursor de toda la página
        event.preventDefault();
        event.stopPropagation();
    }
});

minimapaCanvas.addEventListener("mousemove", (event) => {
    const rect = minimapaCanvas.getBoundingClientRect();
    let mouseX = event.clientX - rect.left;
    let mouseY = event.clientY - rect.top;

    if (arrastandoMinimapa) {
        // Restringir las coordenadas del mouse dentro del minimapa
        mouseX = Math.max(0, Math.min(mouseX, rect.width));
        mouseY = Math.max(0, Math.min(mouseY, rect.height));

        // Obtener la escala actual del minimapa (dinámica)
        const params = calcularParametrosMinimapa();
        const minimapaEscala = params.minimapaEscala;

        const deltaX = mouseX - minimapaInicialMouseX;
        const deltaY = mouseY - minimapaInicialMouseY;

        // Convertir el delta del minimapa a coordenadas del mundo
        const worldDeltaX = deltaX / minimapaEscala;
        const worldDeltaY = deltaY / minimapaEscala;

        // IMPORTANTE: Usar la escala global actualizada por CameraController
        const currentEscala = window.escala || escala;

        // Actualizar el offset (el movimiento en el minimapa es directo, no inverso)
        offsetX = minimapaInicialOffsetX - worldDeltaX * currentEscala;
        offsetY = minimapaInicialOffsetY - worldDeltaY * currentEscala;

        // Si usamos PixiJS, actualizar el CameraController (que incluye aplicarLimitesOffset)
        if (window.USE_PIXI && window.pixiApp && window.pixiApp.cameraController) {
            window.pixiApp.cameraController.setPosition(offsetX, offsetY);
        } else {
            aplicarLimitesOffset();
        }

        renderizarCanvas();

        // Prevenir la selección de texto mientras se arrastra
        event.preventDefault();
    } else {
        // Cambiar el cursor si está sobre el rectángulo
        if (estaEnRectanguloMinimapa(mouseX, mouseY)) {
            minimapaCanvas.style.cursor = 'grab';
        } else {
            minimapaCanvas.style.cursor = 'default';
        }
    }
});

minimapaCanvas.addEventListener("mouseup", () => {
    if (arrastandoMinimapa) {
        arrastandoMinimapa = false;
        minimapaCanvas.style.cursor = 'grab';
        document.body.style.cursor = 'default'; // Restaurar cursor de la página
    }
});

// ========== EVENTOS TÁCTILES PARA EL MINIMAPA (MÓVILES) ==========
minimapaCanvas.addEventListener("touchstart", (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    const rect = minimapaCanvas.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const touchY = touch.clientY - rect.top;

    console.log(`📍 MINIMAPA TOUCHSTART: (${touchX.toFixed(0)}, ${touchY.toFixed(0)})`);

    if (estaEnRectanguloMinimapa(touchX, touchY)) {
        arrastandoMinimapa = true;
        minimapaInicialMouseX = touchX;
        minimapaInicialMouseY = touchY;
        minimapaInicialOffsetX = window.offsetX !== undefined ? window.offsetX : offsetX;
        minimapaInicialOffsetY = window.offsetY !== undefined ? window.offsetY : offsetY;
        console.log(`   ✅ Iniciando arrastre minimapa`);
        mostrarDebugMovil(`MINIMAPA TOUCH\nIniciando arrastre\nPos: (${touchX.toFixed(0)}, ${touchY.toFixed(0)})`);
    } else {
        console.log(`   ❌ Toque fuera del rectángulo`);
        mostrarDebugMovil(`MINIMAPA TOUCH\nFuera del área\nPos: (${touchX.toFixed(0)}, ${touchY.toFixed(0)})`);
    }
}, { passive: false });

minimapaCanvas.addEventListener("touchmove", (event) => {
    event.preventDefault();
    if (!arrastandoMinimapa) return;

    const touch = event.touches[0];
    const rect = minimapaCanvas.getBoundingClientRect();
    let touchX = touch.clientX - rect.left;
    let touchY = touch.clientY - rect.top;

    // Restringir las coordenadas del touch dentro del minimapa
    touchX = Math.max(0, Math.min(touchX, rect.width));
    touchY = Math.max(0, Math.min(touchY, rect.height));

    // Obtener la escala actual del minimapa (dinámica)
    const params = calcularParametrosMinimapa();
    const minimapaEscala = params.minimapaEscala;

    const deltaX = touchX - minimapaInicialMouseX;
    const deltaY = touchY - minimapaInicialMouseY;

    // Convertir el delta del minimapa a coordenadas del mundo
    const worldDeltaX = deltaX / minimapaEscala;
    const worldDeltaY = deltaY / minimapaEscala;

    const currentEscala = window.escala || escala;

    // Actualizar el offset
    offsetX = minimapaInicialOffsetX - worldDeltaX * currentEscala;
    offsetY = minimapaInicialOffsetY - worldDeltaY * currentEscala;

    // Sincronizar con window ANTES de aplicar límites
    window.offsetX = offsetX;
    window.offsetY = offsetY;

    // Si usamos PixiJS, actualizar el CameraController
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.cameraController) {
        window.pixiApp.cameraController.setPosition(offsetX, offsetY);
    } else {
        aplicarLimitesOffset();
        // Re-sincronizar después de aplicar límites
        offsetX = window.offsetX;
        offsetY = window.offsetY;
    }

    mostrarDebugMovil(`MINIMAPA ARRASTRE\nDelta: (${deltaX.toFixed(0)}, ${deltaY.toFixed(0)})\nOffset: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);

    renderizarCanvas();
}, { passive: false });

minimapaCanvas.addEventListener("touchend", () => {
    if (arrastandoMinimapa) {
        arrastandoMinimapa = false;
        console.log(`📍 MINIMAPA TOUCHEND`);
        mostrarDebugMovil(`MINIMAPA\nArrastre completado`);
    }
}, { passive: false });

minimapaCanvas.addEventListener("touchcancel", () => {
    if (arrastandoMinimapa) {
        arrastandoMinimapa = false;
        console.log(`📍 MINIMAPA TOUCHCANCEL`);
    }
}, { passive: false });

// Eventos globales para capturar el arrastre cuando el mouse sale del minimapa
document.addEventListener("mousemove", (event) => {
    if (arrastandoMinimapa) {
        const rect = minimapaCanvas.getBoundingClientRect();
        let mouseX = event.clientX - rect.left;
        let mouseY = event.clientY - rect.top;

        // Restringir las coordenadas del mouse dentro del minimapa
        mouseX = Math.max(0, Math.min(mouseX, rect.width));
        mouseY = Math.max(0, Math.min(mouseY, rect.height));

        // Obtener la escala actual del minimapa (dinámica)
        const params = calcularParametrosMinimapa();
        const minimapaEscala = params.minimapaEscala;

        const deltaX = mouseX - minimapaInicialMouseX;
        const deltaY = mouseY - minimapaInicialMouseY;

        // Convertir el delta del minimapa a coordenadas del mundo
        const worldDeltaX = deltaX / minimapaEscala;
        const worldDeltaY = deltaY / minimapaEscala;

        // IMPORTANTE: Usar la escala global actualizada por CameraController
        const currentEscala = window.escala || escala;

        // Actualizar el offset (el movimiento en el minimapa es directo, no inverso)
        offsetX = minimapaInicialOffsetX - worldDeltaX * currentEscala;
        offsetY = minimapaInicialOffsetY - worldDeltaY * currentEscala;

        // Si usamos PixiJS, actualizar el CameraController (que incluye aplicarLimitesOffset)
        if (window.USE_PIXI && window.pixiApp && window.pixiApp.cameraController) {
            window.pixiApp.cameraController.setPosition(offsetX, offsetY);
        } else {
            aplicarLimitesOffset();
        }

        renderizarCanvas();

        event.preventDefault();
    }
});

document.addEventListener("mouseup", () => {
    if (arrastandoMinimapa) {
        arrastandoMinimapa = false;
        minimapaCanvas.style.cursor = 'default';
        document.body.style.cursor = 'default'; // Restaurar cursor de la página
    }
});

// Ajustar tamaño del canvas si cambia la ventana
window.addEventListener("resize", () => {
    resizeCanvas();
    renderizarCanvas();
});

iniciarSimulacion();

// ========== EXPONER VARIABLES PARA EL EDITOR ==========
// IMPORTANTE: Actualizar referencia a conexiones después de inicializar la simulación
window.conexiones = conexiones;
window.calleSeleccionada = calleSeleccionada;
window.escala = escala;
window.offsetX = offsetX;
window.offsetY = offsetY;
window.celda_tamano = celda_tamano;
window.isPaused = isPaused;
window.calleSeleccionada = calleSeleccionada;

// NUEVAS EXPOSICIONES PARA VÉRTICES
window.inicializarVertices = inicializarVertices;
window.calcularPosicionVertice = calcularPosicionVertice;
window.obtenerAnguloEnPunto = obtenerAnguloEnPunto;
window.actualizarAnguloVertice = actualizarAnguloVertice;
window.actualizarVerticePorArrastre = actualizarVerticePorArrastre;
window.obtenerCoordenadasGlobalesCeldaConCurva = obtenerCoordenadasGlobalesCeldaConCurva;
window.calcularCentroCalleCurva = calcularCentroCalleCurva;
window.calcularPuntoFinalCalleCurva = calcularPuntoFinalCalleCurva;

// EXPOSICIONES PARA EL CONSTRUCTOR
window.crearCalle = crearCalle;
window.crearConexionLineal = crearConexionLineal;
window.crearConexionIncorporacion = crearConexionIncorporacion;
window.crearConexionProbabilistica = crearConexionProbabilistica;
window.registrarConexiones = registrarConexiones;
window.TIPOS = TIPOS;
window.TIPOS_CONEXION = TIPOS_CONEXION;
window.ConexionCA = ConexionCA; // Exponer clase ConexionCA para el constructor

selectCalle.addEventListener("change", () => {
    window.calleSeleccionada = calleSeleccionada;
});

window.renderizarCanvas = renderizarCanvas;
window.encontrarCeldaMasCercana = encontrarCeldaMasCercana;
window.dibujarMinimapa = dibujarMinimapa;
window.calcularLimitesMapa = calcularLimitesMapa;
window.aplicarLimitesOffset = aplicarLimitesOffset;
window.calcularViewportVisible = calcularViewportVisible;
window.calcularParametrosMinimapa = calcularParametrosMinimapa;

canvas.addEventListener("wheel", () => {
    window.escala = escala;
    window.offsetX = offsetX;
    window.offsetY = offsetY;
});

canvas.addEventListener("mousemove", () => {
    if (isDragging) {
        window.offsetX = offsetX;
        window.offsetY = offsetY;
    }
});



// Código relacionado con btnToggleCurva eliminado ya que el botón no existe
// Las curvas ahora siempre están disponibles automáticamente

// ============================================================================
// MODO OSCURO / MODO CLARO (Dark Mode / Light Mode)
// ============================================================================

// Obtener el switch del modo oscuro
const switchModoOscuro = document.getElementById('switchModoOscuro');
const labelModoOscuro = document.getElementById('labelModoOscuro');

// Función para aplicar el modo oscuro
function aplicarModoOscuro(activar) {
    if (activar) {
        // Agregar clase a HTML y body para evitar bordes blancos en iOS
        document.documentElement.classList.add('dark-mode');
        document.body.classList.add('dark-mode');
        labelModoOscuro.textContent = '☀️ Modo Claro';
        localStorage.setItem('modoOscuro', 'true');
    } else {
        document.documentElement.classList.remove('dark-mode');
        document.body.classList.remove('dark-mode');
        labelModoOscuro.textContent = '🌙 Modo Oscuro';
        localStorage.setItem('modoOscuro', 'false');
    }

    // Actualizar colores de las gráficas (función definida en graficas.js)
    if (window.actualizarColoresGraficas) {
        window.actualizarColoresGraficas(activar);
    }
}

// Cargar preferencia guardada del usuario al iniciar
document.addEventListener('DOMContentLoaded', () => {
    const modoOscuroGuardado = localStorage.getItem('modoOscuro');

    if (modoOscuroGuardado === 'true') {
        switchModoOscuro.checked = true;
        aplicarModoOscuro(true);
    } else {
        switchModoOscuro.checked = false;
        aplicarModoOscuro(false);
    }
});

// Event listener para el switch
switchModoOscuro.addEventListener('change', (event) => {
    aplicarModoOscuro(event.target.checked);

    // Renderizar el canvas para actualizar colores si es necesario
    renderizarCanvas();
});

// ============================================================================
// TOGGLE DE SECCIÓN DE CONFIGURACIÓN (COLAPSAR/EXPANDIR)
// ============================================================================

const configHeader = document.getElementById('configHeader');
const configFooter = document.querySelector('.sidebar-footer-config');

// Cargar estado guardado del colapso
document.addEventListener('DOMContentLoaded', () => {
    const configCollapsed = localStorage.getItem('configCollapsed');

    if (configCollapsed === 'true') {
        configFooter.classList.add('collapsed');
    }
});

// Event listener para toggle
if (configHeader) {
    configHeader.addEventListener('click', () => {
        configFooter.classList.toggle('collapsed');

        // Guardar estado en localStorage
        const isCollapsed = configFooter.classList.contains('collapsed');
        localStorage.setItem('configCollapsed', isCollapsed.toString());
    });
}