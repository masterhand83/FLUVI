/**
 * loadingAnimation.js - Animación de fondo con gradientes fluidos
 * Usa Canvas 2D nativo (más ligero y fluido que p5.js)
 * Se adapta automáticamente al modo oscuro/claro
 */

let animationCanvas = null;
let animationContext = null;
let animationFrameId = null;
let time = 0;

// Paletas de colores
const lightModeColors = {
    primary: [102, 126, 234],     // #667eea (azul-morado claro)
    secondary: [118, 75, 162],     // #764ba2 (morado)
    accent1: [147, 51, 234],       // #9333ea (morado brillante)
    accent2: [59, 130, 246],       // #3b82f6 (azul brillante)
    accent3: [168, 85, 247]        // #a855f7 (morado-rosa)
};

const darkModeColors = {
    primary: [30, 58, 95],         // #1e3a5f (azul oscuro)
    secondary: [21, 40, 61],       // #15283d (azul muy oscuro)
    accent1: [59, 130, 246],       // #3b82f6 (azul brillante)
    accent2: [99, 102, 241],       // #6366f1 (índigo)
    accent3: [139, 92, 246]        // #8b5cf6 (morado brillante)
};

/**
 * Inicializa la animación de carga
 */
window.initLoadingAnimation = function() {
    console.log('🎨 Inicializando animación de gradientes...');

    // Crear canvas
    const container = document.getElementById('loadingAnimationCanvas');
    if (!container) {
        console.error('❌ No se encontró el contenedor loadingAnimationCanvas');
        return;
    }

    animationCanvas = document.createElement('canvas');
    animationCanvas.id = 'gradientCanvas';
    animationCanvas.width = window.innerWidth;
    animationCanvas.height = window.innerHeight;
    container.appendChild(animationCanvas);

    animationContext = animationCanvas.getContext('2d');

    // Iniciar animación
    animate();

    // Ajustar al cambiar tamaño de ventana
    window.addEventListener('resize', onResize);

    console.log('✅ Animación de gradientes inicializada');
};

/**
 * Detecta si estamos en modo oscuro
 */
function isDarkMode() {
    return document.body.classList.contains('dark-mode');
}

/**
 * Obtiene la paleta de colores según el modo
 */
function getColorPalette() {
    return isDarkMode() ? darkModeColors : lightModeColors;
}

/**
 * Convierte array RGB a string rgba
 */
function rgbaString(rgbArray, alpha = 1) {
    return `rgba(${rgbArray[0]}, ${rgbArray[1]}, ${rgbArray[2]}, ${alpha})`;
}

/**
 * Interpola entre dos colores RGB
 */
function lerpColor(color1, color2, factor) {
    return [
        Math.round(color1[0] + (color2[0] - color1[0]) * factor),
        Math.round(color1[1] + (color2[1] - color1[1]) * factor),
        Math.round(color1[2] + (color2[2] - color1[2]) * factor)
    ];
}

/**
 * Dibuja un gradiente radial animado
 */
function drawRadialGradient(x, y, radius, colors, alpha) {
    const gradient = animationContext.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgbaString(colors[0], alpha));
    gradient.addColorStop(0.5, rgbaString(colors[1], alpha * 0.6));
    gradient.addColorStop(1, rgbaString(colors[2], alpha * 0));

    animationContext.fillStyle = gradient;
    animationContext.fillRect(0, 0, animationCanvas.width, animationCanvas.height);
}

/**
 * Función de animación principal
 */
function animate() {
    const palette = getColorPalette();
    const width = animationCanvas.width;
    const height = animationCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Limpiar canvas
    animationContext.clearRect(0, 0, width, height);

    // Incrementar tiempo
    time += 0.005;

    // Blob 1 - Movimiento circular lento
    const blob1X = centerX + Math.cos(time) * (width * 0.25);
    const blob1Y = centerY + Math.sin(time) * (height * 0.25);
    const blob1Radius = 300 + Math.sin(time * 2) * 100;
    const blob1Colors = [
        lerpColor(palette.primary, palette.accent1, (Math.sin(time) + 1) / 2),
        lerpColor(palette.secondary, palette.accent2, (Math.cos(time) + 1) / 2),
        palette.accent3
    ];
    drawRadialGradient(blob1X, blob1Y, blob1Radius, blob1Colors, 0.4);

    // Blob 2 - Movimiento en sentido contrario
    const blob2X = centerX + Math.cos(time * 1.5 + Math.PI) * (width * 0.2);
    const blob2Y = centerY + Math.sin(time * 1.5 + Math.PI) * (height * 0.2);
    const blob2Radius = 250 + Math.cos(time * 2.5) * 80;
    const blob2Colors = [
        lerpColor(palette.accent2, palette.accent1, (Math.cos(time * 1.3) + 1) / 2),
        lerpColor(palette.primary, palette.accent3, (Math.sin(time * 1.3) + 1) / 2),
        palette.secondary
    ];
    drawRadialGradient(blob2X, blob2Y, blob2Radius, blob2Colors, 0.35);

    // Blob 3 - Movimiento diagonal
    const blob3X = centerX + Math.sin(time * 0.8) * (width * 0.3);
    const blob3Y = centerY + Math.cos(time * 0.8) * (height * 0.3);
    const blob3Radius = 350 + Math.sin(time * 3) * 120;
    const blob3Colors = [
        lerpColor(palette.accent3, palette.accent2, (Math.sin(time * 1.7) + 1) / 2),
        lerpColor(palette.accent1, palette.primary, (Math.cos(time * 1.7) + 1) / 2),
        palette.secondary
    ];
    drawRadialGradient(blob3X, blob3Y, blob3Radius, blob3Colors, 0.3);

    // Blob 4 - Movimiento elíptico
    const blob4X = centerX + Math.cos(time * 0.6 + Math.PI / 2) * (width * 0.35);
    const blob4Y = centerY + Math.sin(time * 1.2 + Math.PI / 2) * (height * 0.25);
    const blob4Radius = 280 + Math.cos(time * 1.8) * 90;
    const blob4Colors = [
        lerpColor(palette.accent1, palette.accent3, (Math.cos(time * 2.1) + 1) / 2),
        lerpColor(palette.accent2, palette.primary, (Math.sin(time * 2.1) + 1) / 2),
        palette.secondary
    ];
    drawRadialGradient(blob4X, blob4Y, blob4Radius, blob4Colors, 0.25);

    // Continuar animación
    animationFrameId = requestAnimationFrame(animate);
}

/**
 * Ajustar canvas al cambiar tamaño de ventana
 */
function onResize() {
    if (animationCanvas) {
        animationCanvas.width = window.innerWidth;
        animationCanvas.height = window.innerHeight;
    }
}

/**
 * Destruye la animación y libera recursos
 */
window.destroyLoadingAnimation = function() {
    console.log('🧹 Destruyendo animación de gradientes...');

    // Cancelar frame de animación
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Remover event listener
    window.removeEventListener('resize', onResize);

    // Destruir canvas
    if (animationCanvas && animationCanvas.parentNode) {
        animationCanvas.parentNode.removeChild(animationCanvas);
    }

    animationCanvas = null;
    animationContext = null;
    time = 0;

    console.log('✅ Animación de gradientes destruida');
};

console.log('✓ loadingAnimation.js (gradientes) cargado');

// Auto-inicializar si el DOM ya está listo
if (document.readyState !== 'loading') {
    console.log('🚀 DOM listo, auto-inicializando animación...');
    // Pequeño delay para asegurar que el contenedor exista
    setTimeout(function() {
        if (document.getElementById('loadingAnimationCanvas')) {
            window.initLoadingAnimation();
        } else {
            console.warn('⚠️ Contenedor loadingAnimationCanvas no encontrado aún');
        }
    }, 10);
} else {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🚀 DOMContentLoaded, auto-inicializando animación...');
        setTimeout(function() {
            if (document.getElementById('loadingAnimationCanvas')) {
                window.initLoadingAnimation();
            } else {
                console.warn('⚠️ Contenedor loadingAnimationCanvas no encontrado');
            }
        }, 10);
    });
}
