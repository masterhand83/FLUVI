/**
 * EdificioRenderer.js - Renderizador de edificios
 * Maneja la visualización de edificios y objetos estáticos
 */

class EdificioRenderer {
    constructor(sceneManager, assetLoader) {
        this.scene = sceneManager;
        this.assets = assetLoader;
        this.etiquetasEdificios = new Map(); // Map<edificio, Container> - etiquetas de edificios

        // 📱 OPTIMIZACIÓN MÓVIL: Lazy loading de edificios distantes
        this.isMobile = window.pixiApp && window.pixiApp.isMobile;
        this.viewportCullingEnabled = this.isMobile; // Solo en móviles
        this.viewportPadding = 500; // Píxeles extra para edificios (más grande que vehículos)
    }

    // Función auxiliar para detectar si un color es oscuro
    esColorOscuro(colorHex) {
        // Si es número hexadecimal de PixiJS (0xRRGGBB)
        let r, g, b;

        if (typeof colorHex === 'number') {
            r = (colorHex >> 16) & 0xFF;
            g = (colorHex >> 8) & 0xFF;
            b = colorHex & 0xFF;
        } else if (typeof colorHex === 'string') {
            // Si es string tipo "#RRGGBB" o "#RRGGBBaa"
            const hex = colorHex.replace('#', '');
            r = parseInt(hex.substr(0, 2), 16);
            g = parseInt(hex.substr(2, 2), 16);
            b = parseInt(hex.substr(4, 2), 16);
        } else {
            return true; // Por defecto asumir oscuro (texto blanco)
        }

        // Calcular luminosidad
        const luminosidad = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminosidad < 0.5;
    }

    renderAll(edificios) {
        if (!edificios) return;

        edificios.forEach(edificio => {
            try {
                this.renderEdificio(edificio);
            } catch (error) {
                console.error(`Error renderizando edificio:`, edificio, error);
                // Continuar con el siguiente edificio sin detener la simulación
            }
        });
    }

    renderEdificio(edificio) {
        // Si ya existe, actualizar
        if (this.scene.edificioSprites.has(edificio)) {
            return this.updateEdificioSprite(edificio);
        }

        let sprite;

        // Intentar usar imagen del edificio basada en label (case-insensitive)
        // Buscar tanto en edificio.imagen como edificio.label
        const imagenKey = edificio.imagen || edificio.label;

        if (imagenKey) {
            const imagenLower = imagenKey.toLowerCase();
            if (this.assets.hasTexture(imagenLower)) {
                const texture = this.assets.getTexture(imagenLower);
                sprite = new PIXI.Sprite(texture);

                // Usar las dimensiones exactas del edificio (sin mantener aspect ratio)
                sprite.width = edificio.width || 100;
                sprite.height = edificio.height || 100;
                sprite.anchor.set(0.5);
            }
        }

        // Si no se pudo crear con imagen, usar rectángulo de color
        if (!sprite) {
            // Usar rectángulo de color
            const graphics = new PIXI.Graphics();

            // Convertir color de forma segura
            let color = 0x808080; // Gris por defecto

            try {
                if (edificio.color) {
                    if (typeof edificio.color === 'string') {
                        // Si es string tipo "#RRGGBB" o "#RRGGBBaa"
                        let colorStr = edificio.color.replace('#', '');

                        // Si tiene alpha (8 caracteres), tomar solo los 6 primeros (RGB)
                        if (colorStr.length === 8) {
                            colorStr = colorStr.substring(0, 6);
                        }

                        color = parseInt('0x' + colorStr);

                        // Validar que el color esté en rango válido (0x000000 a 0xFFFFFF)
                        if (isNaN(color) || color < 0 || color > 0xFFFFFF) {
                            console.warn(`Color inválido en edificio ${edificio.label || 'sin nombre'}: ${edificio.color}, usando gris por defecto`);
                            color = 0x808080;
                        }
                    } else if (typeof edificio.color === 'number') {
                        // Si ya es un número, validar que esté en rango
                        if (edificio.color >= 0 && edificio.color <= 0xFFFFFF) {
                            color = edificio.color;
                        } else {
                            console.warn(`Color numérico fuera de rango en edificio: ${edificio.color}, usando gris por defecto`);
                            color = 0x808080;
                        }
                    }
                }
            } catch (error) {
                console.error(`Error procesando color de edificio:`, edificio, error);
                color = 0x808080;
            }

            graphics.beginFill(color);
            // Dibujar desde 0,0 (luego ajustaremos el pivot)
            const width = edificio.width || 100;
            const height = edificio.height || 100;
            graphics.drawRect(0, 0, width, height);
            graphics.endFill();

            // Establecer el pivot en el centro para que la rotación funcione correctamente
            graphics.pivot.set(width / 2, height / 2);
            sprite = graphics;
        }

        sprite.x = edificio.x;
        sprite.y = edificio.y;

        if (edificio.angle) {
            sprite.rotation = CoordinateConverter.degreesToRadians(edificio.angle);
        }

        // 📱 OPTIMIZACIÓN MÓVIL: Lazy loading (culling de viewport)
        if (this.viewportCullingEnabled) {
            sprite.visible = this.isInViewport(edificio.x, edificio.y, edificio.width || 100, edificio.height || 100);
        } else {
            sprite.visible = true;
        }

        // Agregar nombre del edificio si tiene label
        if (edificio.label && edificio.label !== "CONO") {
            this.addBuildingLabel(sprite, edificio);
        }

        // El estacionamiento funcional conserva su borde independientemente de la selección.
        this.updateFunctionalParkingBorder(sprite, edificio);

        // Agregar borde si está seleccionado
        if (window.edificioSeleccionado === edificio) {
            this.addSelectionBorder(sprite, edificio);
        }

        // Guardar referencia
        this.scene.edificioSprites.set(edificio, sprite);

        // Determinar la capa donde se va a renderizar
        // Si el edificio tiene layer: 'background', usar capa background, sino usar buildings
        const targetLayer = edificio.layer === 'background' ? this.scene.getLayer('background') : this.scene.getLayer('buildings');
        targetLayer.addChild(sprite);

        // Hacer interactivo solo si no está marcado como no interactivo (PixiJS v7+ API)
        // Si edificio.interactive es false, no agregar eventos
        const isInteractive = edificio.interactive !== false;

        if (isInteractive) {
            sprite.eventMode = 'static';
            sprite.cursor = 'pointer';
            sprite.on('pointerdown', (e) => this.onEdificioClick(edificio, e));
            sprite.on('pointerover', () => this.onEdificioHover(edificio, sprite));
            sprite.on('pointerout', () => this.onEdificioOut(edificio, sprite));
        } else {
            // Asegurar que el sprite no capture eventos
            sprite.eventMode = 'none';
            sprite.interactiveChildren = false;
        }

        return sprite;
    }

    updateEdificioSprite(edificio) {
        const sprite = this.scene.edificioSprites.get(edificio);
        if (!sprite) return;

        sprite.x = edificio.x;
        sprite.y = edificio.y;

        if (edificio.angle !== undefined) {
            sprite.rotation = CoordinateConverter.degreesToRadians(edificio.angle);
        }

        // 📱 OPTIMIZACIÓN MÓVIL: Lazy loading (culling de viewport)
        if (this.viewportCullingEnabled) {
            sprite.visible = this.isInViewport(edificio.x, edificio.y, edificio.width || 100, edificio.height || 100);
        } else {
            sprite.visible = true;
        }

        // Actualizar posición de la etiqueta (si existe)
        const etiqueta = this.etiquetasEdificios.get(edificio);
        if (etiqueta) {
            etiqueta.x = edificio.x;
            etiqueta.y = edificio.y;
        }

        // El estado de estacionamiento puede cambiar sin recrear el sprite.
        this.updateFunctionalParkingBorder(sprite, edificio);

        // Actualizar borde de selección
        this.updateSelectionBorder(sprite, edificio);
    }

    addBuildingLabel(sprite, edificio) {
        // Limpiar etiqueta anterior si existe
        const etiquetaAnterior = this.etiquetasEdificios.get(edificio);
        if (etiquetaAnterior) {
            etiquetaAnterior.destroy({ children: true });
            this.etiquetasEdificios.delete(edificio);
        }

        // Crear container para la etiqueta (en capa UI, no como hijo del sprite)
        const container = new PIXI.Container();

        // Posicionar en el centro del edificio (coordenadas globales)
        container.x = edificio.x;
        container.y = edificio.y;

        // NO aplicar rotación - mantener siempre horizontal
        container.rotation = 0;

        // Determinar color del texto basándose en el color de fondo del edificio
        const backgroundColor = edificio.color || 0x808080;
        const esOscuro = this.esColorOscuro(backgroundColor);
        const colorTexto = esOscuro ? 0xFFFFFF : 0x000000; // Blanco para fondos oscuros, negro para claros

        // Crear texto del label con tamaño más grande
        const text = new PIXI.Text(edificio.label, {
            fontFamily: 'Arial',
            fontSize: 14,
            fill: colorTexto,
            align: 'center',
            fontWeight: 'bold'
        });

        text.anchor.set(0.5);
        text.resolution = 1; // Resolución normal para mantener rendimiento

        // Crear fondo gris semi-transparente (como las etiquetas de calles)
        const padding = 4;
        const colorFondo = 0x808080; // Gris
        const bg = new PIXI.Graphics();
        bg.beginFill(colorFondo, 0.8); // 0.8 de opacidad
        bg.drawRoundedRect(
            -text.width / 2 - padding,
            -text.height / 2 - padding / 2,
            text.width + padding * 2,
            text.height + padding,
            3 // radio de esquinas redondeadas
        );
        bg.endFill();

        // Agregar fondo y texto al container
        container.addChild(bg);
        container.addChild(text);

        // Controlar visibilidad según configuración global
        container.visible = window.mostrarEtiquetas !== false;

        // Agregar a la capa UI (no al sprite del edificio)
        this.scene.getLayer('ui').addChild(container);

        // Guardar referencia para poder actualizarla/eliminarla después
        this.etiquetasEdificios.set(edificio, container);
    }

    isFunctionalParking(edificio) {
        return window.esEstacionamientoFuncional?.(edificio) === true;
    }

    getBorderRect(sprite, edificio, margin = 0) {
        if (sprite instanceof PIXI.Sprite && sprite.texture) {
            // Los hijos de Sprite usan coordenadas de la textura y heredan su escala.
            const textureWidth = sprite.texture.width;
            const textureHeight = sprite.texture.height;
            const scaleX = Math.abs(sprite.scale.x) || 1;
            const scaleY = Math.abs(sprite.scale.y) || 1;
            const marginX = margin / scaleX;
            const marginY = margin / scaleY;

            return {
                x: -textureWidth / 2 - marginX,
                y: -textureHeight / 2 - marginY,
                width: textureWidth + marginX * 2,
                height: textureHeight + marginY * 2
            };
        }

        // Graphics se dibuja desde 0,0 y centra su rotación mediante pivot.
        const width = edificio.width || 100;
        const height = edificio.height || 100;
        return {
            x: -margin,
            y: -margin,
            width: width + margin * 2,
            height: height + margin * 2
        };
    }

    drawBorderRect(graphics, sprite, edificio, margin = 0) {
        const rect = this.getBorderRect(sprite, edificio, margin);
        graphics.drawRect(rect.x, rect.y, rect.width, rect.height);
    }

    getBorderLineWidth(sprite, screenWidth) {
        if (!(sprite instanceof PIXI.Sprite)) return screenWidth;

        // La escala de la imagen también afecta a sus hijos. Compensar por la
        // escala menor garantiza el grosor mínimo aun con imágenes deformadas.
        const scaleX = Math.abs(sprite.scale.x) || 1;
        const scaleY = Math.abs(sprite.scale.y) || 1;
        return screenWidth / Math.min(scaleX, scaleY);
    }

    addFunctionalParkingBorder(sprite, edificio) {
        const graphics = new PIXI.Graphics();

        // El halo claro separa el azul tanto de imágenes como de rellenos #0066FF.
        graphics.lineStyle(this.getBorderLineWidth(sprite, 8), 0xFFFFFF, 0.95);
        this.drawBorderRect(graphics, sprite, edificio);
        graphics.lineStyle(this.getBorderLineWidth(sprite, 4), 0x0066FF, 1);
        this.drawBorderRect(graphics, sprite, edificio);
        graphics.name = 'functionalParkingBorder';
        sprite.addChild(graphics);
    }

    updateFunctionalParkingBorder(sprite, edificio) {
        const oldBorder = sprite.getChildByName ? sprite.getChildByName('functionalParkingBorder') : null;
        if (oldBorder) {
            sprite.removeChild(oldBorder);
            oldBorder.destroy();
        }

        if (this.isFunctionalParking(edificio)) {
            this.addFunctionalParkingBorder(sprite, edificio);
        }
    }

    addSelectionBorder(sprite, edificio) {
        const graphics = new PIXI.Graphics();

        if (this.isFunctionalParking(edificio)) {
            // La selección queda fuera del borde de estacionamiento y conserva su identidad.
            graphics.lineStyle(this.getBorderLineWidth(sprite, 9), 0x000000, 0.8);
            this.drawBorderRect(graphics, sprite, edificio, 7);
            graphics.lineStyle(this.getBorderLineWidth(sprite, 5), 0xFFD700, 1);
            this.drawBorderRect(graphics, sprite, edificio, 7);
        } else {
            // Conservar el aspecto de selección existente para edificios decorativos.
            graphics.lineStyle(this.getBorderLineWidth(sprite, 6), 0xFFD700);
            this.drawBorderRect(graphics, sprite, edificio);
        }

        graphics.name = 'selectionBorder';

        if (sprite instanceof PIXI.Container || sprite instanceof PIXI.Sprite) {
            sprite.addChild(graphics);
        }
    }

    updateSelectionBorder(sprite, edificio) {
        const oldBorder = sprite.getChildByName ? sprite.getChildByName('selectionBorder') : null;
        if (oldBorder) {
            sprite.removeChild(oldBorder);
            oldBorder.destroy();
        }

        if (window.edificioSeleccionado === edificio) {
            this.addSelectionBorder(sprite, edificio);
        }
    }

    removeEdificioSprite(edificio) {
        const sprite = this.scene.edificioSprites.get(edificio);
        if (sprite) {
            sprite.destroy({ children: true });
            this.scene.edificioSprites.delete(edificio);
        }

        // También eliminar la etiqueta si existe
        const etiqueta = this.etiquetasEdificios.get(edificio);
        if (etiqueta) {
            etiqueta.destroy({ children: true });
            this.etiquetasEdificios.delete(edificio);
        }
    }

    // Actualizar visibilidad de etiquetas de todos los edificios
    updateLabelsVisibility(visible) {
        this.etiquetasEdificios.forEach((container) => {
            container.visible = visible;
        });
    }

    // Event handlers
    onEdificioClick(edificio, event) {
        // IMPORTANTE: Detener la propagación para que CameraController no capture este evento
        event.stopPropagation();

        if (event.data.originalEvent.ctrlKey || event.data.originalEvent.metaKey) {
            console.log('🖱️ Clic en edificio:', edificio.label || 'Sin nombre');

            // Guardar edificio previamente seleccionado
            const previousSelection = window.edificioSeleccionado;

            // Si se clickeó el mismo edificio, deseleccionar
            if (previousSelection === edificio) {
                console.log('🔄 Deseleccionando edificio:', edificio.label || 'Sin nombre');
                window.edificioSeleccionado = null;

                // Remover borde de selección
                const sprite = this.scene.edificioSprites.get(edificio);
                if (sprite) {
                    const border = sprite.getChildByName ? sprite.getChildByName('selectionBorder') : null;
                    if (border) {
                        sprite.removeChild(border);
                        border.destroy();
                    }
                }

                // Resetear selector de edificios
                const selectEdificio = document.getElementById('selectEdificio');
                if (selectEdificio) {
                    selectEdificio.selectedIndex = 0;
                }

                // Actualizar UI
                if (window.editorCalles) {
                    window.editorCalles.actualizarInputsPosicion();
                }

                return;
            }

            // NUEVO: Limpiar TODOS los bordes existentes primero
            if (window.pixiApp && window.pixiApp.sceneManager && window.pixiApp.sceneManager.calleRenderer) {
                window.pixiApp.sceneManager.calleRenderer.clearAllSelectionBorders();
            }

            // Actualizar selección global
            window.edificioSeleccionado = edificio;
            window.calleSeleccionada = null;

            // Agregar borde al edificio seleccionado
            const currentSprite = this.scene.edificioSprites.get(edificio);
            if (currentSprite) {
                this.addSelectionBorder(currentSprite, edificio);
            }

            // Actualizar selector de tipo de objeto en Constructor
            const selectTipoObjeto = document.getElementById('selectTipoObjeto');
            if (selectTipoObjeto) {
                selectTipoObjeto.value = 'edificio';
                // Disparar evento change para mostrar el selector correcto
                selectTipoObjeto.dispatchEvent(new Event('change'));
            }

            // Actualizar selector de edificios
            const selectEdificio = document.getElementById('selectEdificio');
            if (selectEdificio && window.edificios) {
                const edificioIndex = window.edificios.indexOf(edificio);
                if (edificioIndex !== -1) {
                    selectEdificio.value = edificioIndex;
                    selectEdificio.dispatchEvent(new Event('change'));
                }
            }

            // Resetear AMBOS selectores de calle
            const selectCalle = document.getElementById('selectCalle');
            const selectCalleEditor = document.getElementById('selectCalleEditor');
            if (selectCalle) {
                selectCalle.value = '';
            }
            if (selectCalleEditor) {
                selectCalleEditor.value = '';
            }

            // Actualizar UI
            if (window.editorCalles) {
                window.editorCalles.actualizarInputsPosicion();

                // Si estamos en modo edición, recrear handles para el nuevo objeto
                if (window.editorCalles.modoEdicion && window.editorHandles) {
                    console.log('🔄 Cambiando handles al nuevo objeto (edificio) en modo edición');
                    window.editorHandles.clearHandles();
                    window.editorHandles.createHandles(edificio, 'edificio');
                }
            }

            // Renderizar Canvas 2D si es necesario
            if (window.renderizarCanvas) {
                window.renderizarCanvas();
            }
        }
    }

    onEdificioHover(edificio, sprite) {
        sprite.alpha = 0.9;

        // Mostrar tooltip con el nombre/label del edificio
        const tooltip = document.getElementById('canvasTooltip');
        if (tooltip && edificio.label) {
            tooltip.textContent = edificio.label;
            tooltip.style.display = 'block';

            // Actualizar posición del tooltip siguiendo el mouse
            const updateTooltipPosition = (e) => {
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top = (e.clientY + 15) + 'px';
            };

            // Guardar la función para poder removerla después
            sprite._tooltipMoveHandler = updateTooltipPosition;

            // Agregar listener de movimiento del mouse
            document.addEventListener('mousemove', updateTooltipPosition);
        }
    }

    onEdificioOut(edificio, sprite) {
        sprite.alpha = 1.0;

        // Ocultar tooltip
        const tooltip = document.getElementById('canvasTooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }

        // Remover listener de movimiento del mouse
        if (sprite._tooltipMoveHandler) {
            document.removeEventListener('mousemove', sprite._tooltipMoveHandler);
            sprite._tooltipMoveHandler = null;
        }
    }

    // 📱 OPTIMIZACIÓN MÓVIL: Viewport culling helpers
    getViewportBounds() {
        // Obtener dimensiones del canvas y transformaciones actuales
        const canvas = this.scene.app.view;
        const escala = window.escala || 1;
        const offsetX = window.offsetX || 0;
        const offsetY = window.offsetY || 0;

        // Convertir de coordenadas de pantalla a coordenadas del mundo
        const left = (-offsetX / escala) - this.viewportPadding;
        const top = (-offsetY / escala) - this.viewportPadding;
        const right = (canvas.width - offsetX) / escala + this.viewportPadding;
        const bottom = (canvas.height - offsetY) / escala + this.viewportPadding;

        return { left, top, right, bottom };
    }

    isInViewport(worldX, worldY, width = 0, height = 0) {
        const bounds = this.getViewportBounds();

        // Calcular los límites del edificio (considerando su tamaño)
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const edificioLeft = worldX - halfWidth;
        const edificioRight = worldX + halfWidth;
        const edificioTop = worldY - halfHeight;
        const edificioBottom = worldY + halfHeight;

        // Verificar si el edificio intersecta con el viewport
        return edificioRight >= bounds.left &&
               edificioLeft <= bounds.right &&
               edificioBottom >= bounds.top &&
               edificioTop <= bounds.bottom;
    }
}

window.EdificioRenderer = EdificioRenderer;
console.log('✓ EdificioRenderer cargado');
