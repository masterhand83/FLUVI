// ============================================================================
// ETIQUETAS.JS - Sistema de Etiquetas de Nombres de Calles
// ============================================================================
// Este módulo maneja el sistema de etiquetas para mostrar nombres de calles
// similar al estilo de Google Maps:
// - Detección automática de contraste (texto blanco/negro según fondo)
// - Posicionamiento externo a las calles
// - Adaptación a curvas (texto sigue la curvatura)
// - Repetición automática en calles largas

// Función para detectar si un color es oscuro o claro
function esColorOscuro(colorHex) {
    // Convertir hex a RGB
    const hex = colorHex.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Calcular luminosidad relativa según fórmula W3C
    const luminosidad = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Si luminosidad < 0.5 es oscuro, sino es claro
    return luminosidad < 0.5;
}

// Función para obtener el color del texto según el fondo
function obtenerColorTextoSegunFondo() {
    // Usar la variable global que almacena el color de fondo
    return esColorOscuro(colorFondoCanvas) ? "#FFFFFF" : "#000000";
}

// Función para calcular una posición específica en una calle
// posicion: valor entre 0 y 1, donde 0.5 es el centro
function calcularPosicionEnCalle(calle, posicion = 0.5) {
    if (calle.esCurva && calle.vertices && calle.vertices.length >= 2) {
        // Para calles curvas, usar el punto según posición
        const indice = Math.floor(calle.tamano * posicion);
        const indiceSeguro = Math.max(0, Math.min(calle.tamano - 1, indice));
        const carrilCentral = Math.floor(calle.carriles / 2);
        const coordenadas = obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, indiceSeguro);
        return {
            x: coordenadas.x,
            y: coordenadas.y,
            angulo: coordenadas.angulo
        };
    } else {
        // Para calles rectas, calcular según posición
        const angle = -calle.angulo * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const posX = (calle.tamano * celda_tamano) * posicion;
        const centroY = (calle.carriles * celda_tamano) / 2;

        return {
            x: calle.x + (posX * cos - centroY * sin),
            y: calle.y + (posX * sin + centroY * cos),
            angulo: calle.angulo
        };
    }
}

// Función para calcular el offset perpendicular para posicionar texto fuera de la calle
function calcularOffsetExterno(calle, anguloEnGrados) {
    // Distancia fija desde el borde de la calle
    const distanciaDesdeCalleBase = 8; // píxeles
    const anchoCallePixels = calle.carriles * celda_tamano;
    const distanciaTotal = (anchoCallePixels / 2) + distanciaDesdeCalleBase;

    // Convertir ángulo a radianes y calcular perpendicular
    const anguloRad = -anguloEnGrados * Math.PI / 180;
    const perpX = -Math.sin(anguloRad);
    const perpY = Math.cos(anguloRad);

    return {
        offsetX: perpX * distanciaTotal,
        offsetY: perpY * distanciaTotal
    };
}

// Función principal para dibujar etiquetas de calles
function dibujarEtiquetasCalles() {
    if (!mostrarEtiquetas) return;

    ctx.save();

    // Obtener color de texto según fondo
    const colorTexto = obtenerColorTextoSegunFondo();
    ctx.fillStyle = colorTexto;
    ctx.strokeStyle = colorTexto === "#FFFFFF" ? "#000000" : "#FFFFFF";
    ctx.lineWidth = 3;

    // Configurar fuente
    const tamanoFuenteBase = 14;
    const tamanoFuente = tamanoFuenteBase / escala; // Ajustar por zoom
    ctx.font = `${tamanoFuente}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    calles.forEach(calle => {
        // Calcular número de repeticiones según el tamaño de la calle
        const umbralRepeticion = 200; // Repetir cada 200 celdas
        const numRepeticiones = Math.max(1, Math.ceil(calle.tamano / umbralRepeticion));

        // Calcular posiciones donde dibujar las etiquetas
        const posiciones = [];
        if (numRepeticiones === 1) {
            posiciones.push(0.5); // Centro
        } else {
            // Distribuir uniformemente
            for (let i = 0; i < numRepeticiones; i++) {
                const posicion = (i + 1) / (numRepeticiones + 1);
                posiciones.push(posicion);
            }
        }

        // Dibujar etiqueta en cada posición
        posiciones.forEach(posicion => {
            if (calle.esCurva && calle.vertices && calle.vertices.length >= 2) {
                // Para calles curvas: dibujar texto siguiendo la curva
                dibujarEtiquetaSiguiendoCurva(calle, colorTexto, tamanoFuente, posicion);
            } else {
                // Para calles rectas: dibujar texto simple
                dibujarEtiquetaRecta(calle, colorTexto, tamanoFuente, posicion);
            }
        });
    });

    ctx.restore();
}

// Función para dibujar etiqueta en calle recta
// posicionRelativa: valor entre 0 y 1 indicando dónde dibujar (0.5 = centro)
function dibujarEtiquetaRecta(calle, colorTexto, tamanoFuente, posicionRelativa = 0.5) {
    const posicion = calcularPosicionEnCalle(calle, posicionRelativa);
    const offset = calcularOffsetExterno(calle, posicion.angulo);

    const x = posicion.x + offset.offsetX;
    const y = posicion.y + offset.offsetY;

    ctx.save();

    // Trasladar al punto y rotar
    ctx.translate(x, y);

    // Ajustar rotación del texto para que sea legible
    let anguloTexto = -posicion.angulo * Math.PI / 180;

    // Evitar texto al revés (entre 90 y 270 grados)
    if (posicion.angulo > 90 && posicion.angulo < 270) {
        anguloTexto += Math.PI;
    }

    ctx.rotate(anguloTexto);

    // Fondo semi-transparente para mejor legibilidad
    ctx.globalAlpha = 0.7;
    const textoMedida = ctx.measureText(calle.nombre);
    const padding = 4;
    ctx.fillStyle = colorTexto === "#FFFFFF" ? "#000000" : "#FFFFFF";
    ctx.fillRect(
        -textoMedida.width / 2 - padding,
        -tamanoFuente / 2 - padding / 2,
        textoMedida.width + padding * 2,
        tamanoFuente + padding
    );

    // Dibujar texto
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = colorTexto;
    ctx.fillText(calle.nombre, 0, 0);

    ctx.restore();
}

// Función para dibujar etiqueta siguiendo curva
// posicionRelativa: valor entre 0 y 1 indicando dónde dibujar (0.5 = centro)
function dibujarEtiquetaSiguiendoCurva(calle, colorTexto, tamanoFuente, posicionRelativa = 0.5) {
    // Calcular posición inicial según posicionRelativa
    const longitudTexto = ctx.measureText(calle.nombre).width;
    const indiceCentro = Math.floor(calle.tamano * posicionRelativa);
    const carrilCentral = Math.floor(calle.carriles / 2);

    // Estimar cuántas celdas ocupa el texto
    const celdasPorLetra = longitudTexto / (calle.nombre.length * celda_tamano);
    const indiceInicio = Math.max(0, Math.floor(indiceCentro - celdasPorLetra * calle.nombre.length / 2));

    // Determinar la dirección del texto basándose en el ángulo inicial
    // Esto evita que las letras se inviertan individualmente en las curvas
    const coordenadasInicio = obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, Math.max(0, indiceInicio));
    const debeInvertir = coordenadasInicio.angulo > 90 && coordenadasInicio.angulo < 270;

    // Si debemos invertir, invertir el orden de las letras para que se lean correctamente
    const textoADibujar = debeInvertir ? calle.nombre.split('').reverse().join('') : calle.nombre;

    // Dibujar cada letra siguiendo la curva
    let distanciaAcumulada = 0;
    const espaciado = longitudTexto / calle.nombre.length;

    for (let i = 0; i < textoADibujar.length; i++) {
        const letra = textoADibujar[i];

        // Calcular índice de celda para esta letra
        const factorAvance = distanciaAcumulada / longitudTexto;
        const indiceActual = Math.min(
            calle.tamano - 1,
            Math.floor(indiceInicio + factorAvance * calle.nombre.length * 2)
        );

        const coordenadas = obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, indiceActual);
        const offset = calcularOffsetExterno(calle, coordenadas.angulo);

        const x = coordenadas.x + offset.offsetX;
        const y = coordenadas.y + offset.offsetY;

        ctx.save();
        ctx.translate(x, y);

        // Ajustar rotación del texto usando la dirección determinada al inicio
        let anguloTexto = -coordenadas.angulo * Math.PI / 180;

        // Aplicar inversión consistente para toda la etiqueta
        if (debeInvertir) {
            anguloTexto += Math.PI;
        }

        ctx.rotate(anguloTexto);

        // Fondo semi-transparente para cada letra
        ctx.globalAlpha = 0.7;
        const letraMedida = ctx.measureText(letra);
        const padding = 2;
        ctx.fillStyle = colorTexto === "#FFFFFF" ? "#000000" : "#FFFFFF";
        ctx.fillRect(
            -letraMedida.width / 2 - padding,
            -tamanoFuente / 2 - padding / 2,
            letraMedida.width + padding * 2,
            tamanoFuente + padding
        );

        // Dibujar letra
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = colorTexto;
        ctx.fillText(letra, 0, 0);

        ctx.restore();

        distanciaAcumulada += espaciado;
    }
}
