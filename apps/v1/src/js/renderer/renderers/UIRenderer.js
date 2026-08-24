/**
 * UIRenderer.js - Renderizador de UI
 * Maneja la visualización de elementos de interfaz como etiquetas y vértices
 * Sistema avanzado de etiquetas estilo Google Maps
 */

class UIRenderer {
    constructor(sceneManager, assetLoader) {
        this.scene = sceneManager;
        this.assets = assetLoader;
        this.etiquetas = new Map(); // Map<calle, Array<Container>> - múltiples etiquetas por calle
        this.celda_tamano = window.celda_tamano || 5;
    }

    // Función auxiliar para detectar contraste del fondo
    esColorOscuro(colorHex) {
        const hex = colorHex.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const luminosidad = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminosidad < 0.5;
    }

    // Obtener color de texto según fondo del canvas
    obtenerColorTextoSegunFondo() {
        const colorFondo = window.colorFondoCanvas || '#1a1a1a';
        return this.esColorOscuro(colorFondo) ? 0xFFFFFF : 0x000000;
    }

    // Obtener color de fondo del texto (inverso del texto)
    obtenerColorFondoTexto() {
        const colorFondo = window.colorFondoCanvas || '#1a1a1a';
        return this.esColorOscuro(colorFondo) ? 0x000000 : 0xFFFFFF;
    }

    updateEtiquetas(calles) {
        if (!calles || !window.mostrarEtiquetas) {
            this.clearEtiquetas();
            return;
        }

        // Limpiar etiquetas anteriores
        this.clearEtiquetas();

        // Crear nuevas etiquetas para cada calle
        calles.forEach(calle => {
            this.createEtiquetasParaCalle(calle);
        });
    }

    createEtiquetasParaCalle(calle) {
        // CONDICIÓN: No renderizar etiquetas para calles de tipo CONEXION menores a 8 celdas
        // (Son retornos y no necesitan mostrar su nombre)
        if (calle.tipo === 'conexion' && calle.tamano < 8) {
            return; // Salir sin crear etiquetas
        }

        // Calcular número de repeticiones según el tamaño de la calle
        const umbralRepeticion = 200;
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

        // Crear array de containers para esta calle
        const etiquetasArray = [];

        // Crear etiqueta en cada posición
        posiciones.forEach(posicion => {
            let etiquetaContainer;

            if (calle.esCurva && calle.vertices && calle.vertices.length >= 2) {
                // Para calles curvas: crear texto siguiendo la curva
                etiquetaContainer = this.createEtiquetaCurva(calle, posicion);
            } else {
                // Para calles rectas: crear texto simple
                etiquetaContainer = this.createEtiquetaRecta(calle, posicion);
            }

            if (etiquetaContainer) {
                etiquetasArray.push(etiquetaContainer);
                this.scene.getLayer('ui').addChild(etiquetaContainer);
            }
        });

        // Guardar referencia
        this.etiquetas.set(calle, etiquetasArray);
    }

    // Calcular posición en calle (0 a 1)
    calcularPosicionEnCalle(calle, posicion = 0.5) {
        if (calle.esCurva && calle.vertices && calle.vertices.length >= 2 && window.obtenerCoordenadasGlobalesCeldaConCurva) {
            const indice = Math.floor(calle.tamano * posicion);
            const indiceSeguro = Math.max(0, Math.min(calle.tamano - 1, indice));
            const carrilCentral = Math.floor(calle.carriles / 2);
            const coordenadas = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, indiceSeguro);
            return {
                x: coordenadas.x,
                y: coordenadas.y,
                angulo: coordenadas.angulo
            };
        } else {
            const angle = -calle.angulo * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const posX = (calle.tamano * this.celda_tamano) * posicion;
            const centroY = (calle.carriles * this.celda_tamano) / 2;

            return {
                x: calle.x + (posX * cos - centroY * sin),
                y: calle.y + (posX * sin + centroY * cos),
                angulo: calle.angulo
            };
        }
    }

    // Calcular offset perpendicular para posicionar texto al lado de la calle
    // Ahora con opción de alinear a lo largo o perpendicular
    calcularOffsetExterno(calle, anguloEnGrados, alinearALoLargo = false) {
        const distanciaDesdeCalleBase = 8;
        const anchoCallePixels = calle.carriles * this.celda_tamano;
        const distanciaTotal = (anchoCallePixels / 2) + distanciaDesdeCalleBase;

        if (alinearALoLargo) {
            // Sin offset - la etiqueta se alinea con el centro de la calle
            return {
                offsetX: 0,
                offsetY: 0
            };
        } else {
            // Offset perpendicular (antiguo comportamiento)
            const anguloRad = -anguloEnGrados * Math.PI / 180;
            const perpX = -Math.sin(anguloRad);
            const perpY = Math.cos(anguloRad);

            return {
                offsetX: perpX * distanciaTotal,
                offsetY: perpY * distanciaTotal
            };
        }
    }

    // Crear etiqueta para calle recta
    createEtiquetaRecta(calle, posicionRelativa = 0.5) {
        const posicion = this.calcularPosicionEnCalle(calle, posicionRelativa);
        // Mantener offset perpendicular para posicionar al lado de la calle
        const offset = this.calcularOffsetExterno(calle, posicion.angulo, false);

        const x = posicion.x + offset.offsetX;
        const y = posicion.y + offset.offsetY;

        // Crear container para la etiqueta
        const container = new PIXI.Container();
        container.x = x;
        container.y = y;

        // Ajustar rotación del texto para que siga la dirección de la calle
        // CoordinateConverter.degreesToRadians ya incluye el negativo
        let anguloTexto = CoordinateConverter.degreesToRadians(posicion.angulo);

        // Evitar texto al revés (entre 90 y 270 grados)
        if (posicion.angulo > 90 && posicion.angulo < 270) {
            anguloTexto += Math.PI;
        }

        container.rotation = anguloTexto;

        // Obtener colores
        const colorTexto = this.obtenerColorTextoSegunFondo();
        const colorFondo = this.obtenerColorFondoTexto();

        // Crear texto con mayor resolución para evitar pixelación
        const text = new PIXI.Text(calle.nombre, {
            fontFamily: 'Arial',
            fontSize: 14,
            fill: colorTexto,
            align: 'center'
        });
        text.anchor.set(0.5);
        text.resolution = 2; // Doble resolución para mayor calidad

        // Crear fondo semi-transparente
        const padding = 4;
        const bg = new PIXI.Graphics();
        bg.beginFill(colorFondo, 0.7);
        bg.drawRect(
            -text.width / 2 - padding,
            -text.height / 2 - padding / 2,
            text.width + padding * 2,
            text.height + padding
        );
        bg.endFill();

        container.addChild(bg);
        container.addChild(text);

        return container;
    }

    // Crear etiqueta para calle curva (texto siguiendo la curva)
    createEtiquetaCurva(calle, posicionRelativa = 0.5) {
        if (!window.obtenerCoordenadasGlobalesCeldaConCurva) {
            // Fallback a etiqueta recta si no hay función de curvas
            return this.createEtiquetaRecta(calle, posicionRelativa);
        }

        const container = new PIXI.Container();

        const indiceCentro = Math.floor(calle.tamano * posicionRelativa);
        const carrilCentral = Math.floor(calle.carriles / 2);

        // Estimar cuántas celdas ocupa el texto
        const longitudEstimadaPorLetra = 8; // píxeles aproximados por letra
        const celdasPorLetra = longitudEstimadaPorLetra / this.celda_tamano;
        const indiceInicio = Math.max(0, Math.floor(indiceCentro - celdasPorLetra * calle.nombre.length / 2));

        // Determinar dirección del texto
        const coordenadasInicio = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, Math.max(0, indiceInicio));
        const debeInvertir = coordenadasInicio.angulo > 90 && coordenadasInicio.angulo < 270;
        const textoADibujar = debeInvertir ? calle.nombre.split('').reverse().join('') : calle.nombre;

        // Obtener colores
        const colorTexto = this.obtenerColorTextoSegunFondo();
        const colorFondo = this.obtenerColorFondoTexto();

        // Dibujar cada letra siguiendo la curva
        let distanciaAcumulada = 0;
        const espaciado = longitudEstimadaPorLetra;

        for (let i = 0; i < textoADibujar.length; i++) {
            const letra = textoADibujar[i];

            // Calcular índice de celda para esta letra
            const factorAvance = distanciaAcumulada / (longitudEstimadaPorLetra * calle.nombre.length);
            const indiceActual = Math.min(
                calle.tamano - 1,
                Math.floor(indiceInicio + factorAvance * calle.nombre.length * 2)
            );

            const coordenadas = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carrilCentral, indiceActual);
            // Mantener offset perpendicular para posicionar al lado de la calle
            const offset = this.calcularOffsetExterno(calle, coordenadas.angulo, false);

            // Crear container para esta letra
            const letraContainer = new PIXI.Container();
            letraContainer.x = coordenadas.x + offset.offsetX;
            letraContainer.y = coordenadas.y + offset.offsetY;

            // Ajustar rotación para que siga la dirección de la calle
            // CoordinateConverter.degreesToRadians ya incluye el negativo
            let anguloTexto = CoordinateConverter.degreesToRadians(coordenadas.angulo);
            if (debeInvertir) {
                anguloTexto += Math.PI;
            }
            letraContainer.rotation = anguloTexto;

            // Crear texto de la letra con mayor resolución para evitar pixelación
            const text = new PIXI.Text(letra, {
                fontFamily: 'Arial',
                fontSize: 14,
                fill: colorTexto,
                align: 'center'
            });
            text.anchor.set(0.5);
            text.resolution = 2; // Doble resolución para mayor calidad

            // Crear fondo semi-transparente para la letra
            const padding = 2;
            const bg = new PIXI.Graphics();
            bg.beginFill(colorFondo, 0.7);
            bg.drawRect(
                -text.width / 2 - padding,
                -text.height / 2 - padding / 2,
                text.width + padding * 2,
                text.height + padding
            );
            bg.endFill();

            letraContainer.addChild(bg);
            letraContainer.addChild(text);
            container.addChild(letraContainer);

            distanciaAcumulada += espaciado;
        }

        return container;
    }

    clearEtiquetas() {
        this.etiquetas.forEach((etiquetasArray, calle) => {
            // Cada calle puede tener múltiples etiquetas (repeticiones)
            etiquetasArray.forEach(container => {
                container.destroy({ children: true });
            });
        });
        this.etiquetas.clear();
    }

    updateVertices(calle) {
        if (!calle || !calle.esCurva || !calle.vertices) {
            this.clearVertices();
            return;
        }

        // Limpiar vértices anteriores
        this.clearVertices();

        calle.vertices.forEach((vertice, index) => {
            const id = `${calle.nombre}_vertice_${index}`;

            const pos = window.calcularPosicionVertice
                ? window.calcularPosicionVertice(calle, vertice)
                : { x: calle.x, y: calle.y };

            // Crear círculo para el vértice
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x9370DB, 0.8);
            graphics.drawCircle(0, 0, 8);
            graphics.endFill();
            graphics.lineStyle(2, 0xFFFFFF);
            graphics.drawCircle(0, 0, 8);

            graphics.x = pos.x;
            graphics.y = pos.y;

            // Hacer interactivo para arrastre (PixiJS v7+ API)
            graphics.eventMode = 'static';
            graphics.cursor = 'pointer';

            // Eventos de arrastre (se implementarán en EditorHandles)
            graphics.on('pointerdown', (e) => {
                if (window.editorHandles) {
                    window.editorHandles.onVerticeMouseDown(calle, vertice, index, e);
                }
            });

            this.scene.getLayer('debug').addChild(graphics);
            this.scene.verticeSprites.set(id, graphics);
        });
    }

    clearVertices() {
        this.scene.verticeSprites.forEach((graphics, id) => {
            graphics.destroy();
        });
        this.scene.verticeSprites.clear();
    }

    /**
     * Renderiza contadores de ocupación para edificios tipo estacionamiento
     */
    updateContadores() {
        if (!window.edificios || !window.mostrarContadores) {
            this.clearContadores();
            return;
        }

        // Limpiar contadores anteriores
        this.clearContadores();

        // Inicializar Map si no existe
        if (!this.contadores) {
            this.contadores = new Map();
        }

        // Filtrar edificios que son estacionamientos
        const estacionamientos = window.edificios.filter(e => e.esEstacionamiento);

        estacionamientos.forEach(edificio => {
            const container = new PIXI.Container();

            // Posición: debajo del edificio
            const offsetY = (edificio.height / 2) + 15; // 15px debajo del edificio
            container.x = edificio.x;
            container.y = edificio.y + offsetY;

            // Texto del contador: (ocupados/capacidad)
            const ocupacion = edificio.vehiculosActuales || 0;
            const capacidad = edificio.capacidadMaxima || 0;
            const textoContador = `(${ocupacion}/${capacidad})`;

            // Crear fondo semi-transparente
            const padding = 4;
            const bgColor = 0x000000;
            const bgAlpha = 0.7;

            // Crear texto
            const textColor = 0xFFFFFF; // Blanco para contraste con fondo negro
            const fontSize = 12;

            const text = new PIXI.Text(textoContador, {
                fontFamily: 'Arial',
                fontSize: fontSize,
                fill: textColor,
                align: 'center'
            });
            text.anchor.set(0.5, 0.5);

            // Crear fondo
            const bg = new PIXI.Graphics();
            bg.beginFill(bgColor, bgAlpha);
            bg.drawRoundedRect(
                -text.width / 2 - padding,
                -text.height / 2 - padding,
                text.width + padding * 2,
                text.height + padding * 2,
                4 // radio de esquinas redondeadas
            );
            bg.endFill();

            // Agregar fondo y texto al container
            container.addChild(bg);
            container.addChild(text);

            // Aplicar rotación del edificio (inversa para mantener texto legible)
            container.rotation = -(edificio.angle || 0) * Math.PI / 180;

            // Z-index alto para que esté encima de todo
            container.zIndex = 100;

            // Agregar al layer de UI
            this.scene.getLayer('ui').addChild(container);

            // Guardar referencia
            const key = edificio.id || edificio.label;
            this.contadores.set(key, container);
        });
    }

    clearContadores() {
        if (!this.contadores) return;

        this.contadores.forEach((container, key) => {
            container.destroy({ children: true });
        });
        this.contadores.clear();
    }

    clearAll() {
        this.clearEtiquetas();
        this.clearVertices();
        this.clearContadores();
    }
}

window.UIRenderer = UIRenderer;
console.log('✓ UIRenderer cargado');
