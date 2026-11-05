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
        const isPolygon = edificio.geometryType === 'polygon';
        if (isPolygon && !window.edificioPolygonGeometry?.validate(edificio.vertices).valid) {
            const existingSprite = this.scene.edificioSprites.get(edificio);
            if (existingSprite) existingSprite.visible = false;
            return null;
        }

        // Si ya existe, actualizar
        if (this.scene.edificioSprites.has(edificio)) {
            return this.updateEdificioSprite(edificio);
        }

        let sprite;

        if (edificio.appearanceMode === 'uploaded-image' && edificio.imageElement?.naturalWidth) {
            // Private texture, not a shared AssetLoader/cache resource. Release it
            // when this scene-owned sprite is destroyed (including map reset).
            const texture = new PIXI.Texture(new PIXI.BaseTexture(edificio.imageElement));
            sprite = new PIXI.Sprite(texture);
            sprite.on('destroyed', () => texture.destroy(true));
            sprite._uploadedImage = edificio.imageElement;
            sprite.width = edificio.width;
            sprite.height = edificio.height;
            sprite.anchor.set(0.5);
            sprite.hitArea = new PIXI.Rectangle(-texture.width / 2, -texture.height / 2, texture.width, texture.height);
        }

        // Intentar usar imagen del edificio basada en label (case-insensitive)
        // Buscar tanto en edificio.imagen como edificio.label
        const imagenKey = edificio.imagen || edificio.label;

        if (!sprite && !isPolygon && edificio.appearanceMode !== 'uploaded-image' && imagenKey) {
            const imagenLower = imagenKey.toLowerCase();
            if (this.assets.hasTexture(imagenLower)) {
                const texture = this.assets.getTexture(imagenLower);
                sprite = new PIXI.Sprite(texture);

                // Usar las dimensiones exactas del edificio (sin mantener aspect ratio)
                sprite.width = edificio.width || 100;
                sprite.height = edificio.height || 100;
                sprite.anchor.set(0.5);
                sprite._bundledImageKey = imagenLower;
                sprite.hitArea = new PIXI.Rectangle(-texture.width / 2, -texture.height / 2, texture.width, texture.height);
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
            if (isPolygon) {
                const points = edificio.vertices.flatMap(point => [point.x, point.y]);
                graphics.drawPolygon(points);
                graphics.hitArea = new PIXI.Polygon(points);
                graphics._edificioPolygon = true;
                graphics._polygonSignature = `${edificio.color}|${edificio.vertices.map(point => `${point.x},${point.y}`).join(';')}`;
            } else {
                // Dibujar desde 0,0 (luego ajustaremos el pivot)
                const width = edificio.width || 100;
                const height = edificio.height || 100;
                graphics.drawRect(0, 0, width, height);
                // Establecer el pivot en el centro para que la rotación funcione correctamente
                graphics.pivot.set(width / 2, height / 2);
            }
            graphics.endFill();
            sprite = graphics;
        }

        sprite.x = isPolygon ? 0 : edificio.x;
        sprite.y = isPolygon ? 0 : edificio.y;

        if (!isPolygon && edificio.angle) {
            sprite.rotation = edificio.appearanceMode === 'uploaded-image' && edificio.imageRotationConvention !== 'legacy'
                ? edificio.angle * Math.PI / 180 : CoordinateConverter.degreesToRadians(edificio.angle);
        }

        // 📱 OPTIMIZACIÓN MÓVIL: Lazy loading (culling de viewport)
        if (this.viewportCullingEnabled) {
            sprite.visible = isPolygon
                ? this.isPolygonInViewport(edificio.vertices)
                : this.isInViewport(edificio.x, edificio.y, edificio.width || 100, edificio.height || 100, edificio.angle || 0);
        } else {
            sprite.visible = true;
        }

        // Agregar nombre del edificio si tiene label
        if (edificio.label && edificio.label !== "CONO") {
            this.addBuildingLabel(sprite, edificio);
        }
        sprite._buildingLabel = edificio.label;

        // Agregar borde si está seleccionado
        if (window.edificioSeleccionado === edificio) {
            this.addSelectionBorder(sprite, edificio);
        }
        this.updateFunctionalParkingBorder(sprite, edificio);

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

        const uploadedImage = edificio.appearanceMode === 'uploaded-image' && edificio.imageElement?.naturalWidth
            ? edificio.imageElement : null;
        const imageKey = edificio.imagen || edificio.label;
        const bundledImageKey = edificio.geometryType !== 'polygon' && edificio.appearanceMode !== 'uploaded-image' &&
            typeof imageKey === 'string' && this.assets.hasTexture(imageKey.toLowerCase())
            ? imageKey.toLowerCase() : null;
        if ((sprite._uploadedImage || null) !== uploadedImage || (sprite._bundledImageKey || null) !== bundledImageKey) {
            this.removeEdificioSprite(edificio);
            return this.renderEdificio(edificio);
        }
        if (uploadedImage || bundledImageKey) {
            // Labels/outlines must not affect image sizing or its rectangular hit area.
            sprite.scale.set((edificio.width || 100) / sprite.texture.width, (edificio.height || 100) / sprite.texture.height);
        }

        const isPolygon = edificio.geometryType === 'polygon';
        if (isPolygon) {
            const validation = window.edificioPolygonGeometry?.validate(edificio.vertices);
            if (!validation?.valid) {
                sprite.visible = false;
                return;
            }
            const signature = `${edificio.color}|${edificio.vertices.map(point => `${point.x},${point.y}`).join(';')}`;
            if (sprite._polygonSignature !== signature && sprite instanceof PIXI.Graphics) {
                sprite.clear();
                const color = typeof edificio.color === 'string'
                    ? parseInt(edificio.color.replace('#', '').slice(0, 6), 16)
                    : (edificio.color ?? 0x808080);
                sprite.beginFill(Number.isFinite(color) ? color : 0x808080);
                const points = edificio.vertices.flatMap(point => [point.x, point.y]);
                sprite.drawPolygon(points);
                sprite.endFill();
                sprite.hitArea = new PIXI.Polygon(points);
                sprite._polygonSignature = signature;
                const parkingBorder = sprite.getChildByName?.('functionalParkingBorder');
                if (parkingBorder) {
                    sprite.removeChild(parkingBorder);
                    parkingBorder.destroy();
                    this.addFunctionalParkingBorder(sprite, edificio);
                }
            }
            sprite.x = 0;
            sprite.y = 0;
            sprite.rotation = 0;
        } else {
            sprite.x = edificio.x;
            sprite.y = edificio.y;
        }

        if (!isPolygon && edificio.angle !== undefined) {
            sprite.rotation = edificio.appearanceMode === 'uploaded-image' && edificio.imageRotationConvention !== 'legacy'
                ? edificio.angle * Math.PI / 180 : CoordinateConverter.degreesToRadians(edificio.angle);
        }

        // 📱 OPTIMIZACIÓN MÓVIL: Lazy loading (culling de viewport)
        if (this.viewportCullingEnabled) {
            sprite.visible = isPolygon
                ? this.isPolygonInViewport(edificio.vertices)
                : this.isInViewport(edificio.x, edificio.y, edificio.width || 100, edificio.height || 100, edificio.angle || 0);
        } else {
            sprite.visible = true;
        }

        // Actualizar posición de la etiqueta (si existe)
        if (sprite._buildingLabel !== edificio.label) {
            const oldLabel = this.etiquetasEdificios.get(edificio);
            if (oldLabel) {
                oldLabel.destroy({ children: true });
                this.etiquetasEdificios.delete(edificio);
            }
            if (edificio.label && edificio.label !== 'CONO') this.addBuildingLabel(sprite, edificio);
            sprite._buildingLabel = edificio.label;
        }
        const etiqueta = this.etiquetasEdificios.get(edificio);
        if (etiqueta) {
            const center = isPolygon
                ? window.edificioPolygonGeometry.center(edificio.vertices)
                : { x: edificio.x, y: edificio.y };
            etiqueta.x = center.x;
            etiqueta.y = center.y;
            etiqueta.scale.set(1 / (window.escala || 1));
            etiqueta.visible = etiquetasVisibles('buildings');
            etiqueta.labelText.style = estiloEtiqueta();
            actualizarFondoEtiqueta(etiqueta);
        }

        // Actualizar borde de selección
        this.updateSelectionBorder(sprite, edificio);
        this.updateFunctionalParkingBorder(sprite, edificio);
    }

    addBuildingLabel(sprite, edificio) {
        // Limpiar etiqueta anterior si existe
        const etiquetaAnterior = this.etiquetasEdificios.get(edificio);
        if (etiquetaAnterior) {
            etiquetaAnterior.destroy({ children: true });
            this.etiquetasEdificios.delete(edificio);
        }

        // Crear container para la etiqueta (en capa UI, no como hijo del sprite)
        const container = crearEtiquetaPixi(edificio.label);

        // Posicionar en el centro del edificio (coordenadas globales)
        const center = edificio.geometryType === 'polygon'
            ? window.edificioPolygonGeometry.center(edificio.vertices)
            : { x: edificio.x, y: edificio.y };
        container.x = center.x;
        container.y = center.y;
        container.scale.set(1 / (window.escala || 1));

        // NO aplicar rotación - mantener siempre horizontal
        container.rotation = 0;

        container.visible = etiquetasVisibles('buildings');

        // Agregar a la capa UI (no al sprite del edificio)
        this.scene.getLayer('ui').addChild(container);

        // Guardar referencia para poder actualizarla/eliminarla después
        this.etiquetasEdificios.set(edificio, container);
    }

    addSelectionBorder(sprite, edificio) {
        const graphics = new PIXI.Graphics();

        if (edificio.geometryType === 'polygon') {
            const points = edificio.vertices.flatMap(point => [point.x, point.y]);
            graphics.lineStyle(2, 0xFFD700);
            graphics.drawPolygon(points);
            graphics.name = 'selectionBorder';
            sprite.addChild(graphics);
            return;
        }

        // Usar las dimensiones REALES del sprite, no las del objeto edificio
        // porque el sprite puede haber sido redimensionado
        let width, height;

        if (sprite instanceof PIXI.Sprite && sprite.texture) {
            // Para imágenes (Sprite), necesitamos compensar la escala del sprite
            // porque el graphics hereda la transformación del padre

            // El graphics se escala con el sprite, así que necesitamos compensar
            // dibujando en coordenadas de la textura (sin escala)
            const textureWidth = sprite.texture.width;
            const textureHeight = sprite.texture.height;
            const scaleX = Math.abs(sprite.scale.x) || 1;
            const scaleY = Math.abs(sprite.scale.y) || 1;
            graphics.lineStyle(2 / Math.max(scaleX, scaleY), 0xFFD700);

            // Dibujar en coordenadas de la textura original (se escalará automáticamente con el sprite)
            graphics.drawRect(
                -textureWidth / 2 + 4 / scaleX,
                -textureHeight / 2 + 4 / scaleY,
                textureWidth - 8 / scaleX,
                textureHeight - 8 / scaleY
            );
        } else {
            // Para Graphics (figuras geométricas), usar las dimensiones del edificio
            width = edificio.width || 100;
            height = edificio.height || 100;
            graphics.lineStyle(2, 0xFFD700);
            // Para Graphics, dibujar desde 0, 0
            graphics.drawRect(4, 4, width - 8, height - 8);
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
        }

        if (window.edificioSeleccionado === edificio) {
            this.addSelectionBorder(sprite, edificio);
        }
    }

    isFunctionalParking(edificio) {
        return window.edificioTieneConexionesEstacionamientoFuncionales?.(edificio) === true;
    }

    addFunctionalParkingBorder(sprite, edificio) {
        const graphics = new PIXI.Graphics();

        if (edificio.geometryType === 'polygon') {
            const points = edificio.vertices.flatMap(point => [point.x, point.y]);
            graphics.lineStyle(6, 0x0066FF, 1);
            graphics.drawPolygon(points);
            graphics.name = 'functionalParkingBorder';
            sprite.addChild(graphics);
            // The wider blue polygon stroke surrounds, rather than covers,
            // the gold selection stroke on the same footprint.
            const selection = sprite.getChildByName('selectionBorder');
            if (selection) sprite.setChildIndex(selection, sprite.children.length - 1);
            return;
        }

        // Use image texture coordinates for sprites so the outline follows the
        // sprite's scale and rotation. Expand it beyond the separate gold
        // selection border so both remain visible when selected.
        if (sprite instanceof PIXI.Sprite && sprite.texture) {
            const width = sprite.texture.width;
            const height = sprite.texture.height;
            const scaleX = Math.abs(sprite.scale.x) || 1;
            const scaleY = Math.abs(sprite.scale.y) || 1;
            graphics.lineStyle(4 / Math.max(scaleX, scaleY), 0x0066FF, 1);
            graphics.drawRect(-width / 2 - 2 / scaleX, -height / 2 - 2 / scaleY, width + 4 / scaleX, height + 4 / scaleY);
        } else {
            const width = edificio.width || 100;
            const height = edificio.height || 100;
            graphics.lineStyle(4, 0x0066FF, 1);
            graphics.drawRect(-2, -2, width + 4, height + 4);
        }

        graphics.name = 'functionalParkingBorder';
        sprite.addChild(graphics);
    }

    updateFunctionalParkingBorder(sprite, edificio) {
        const oldBorder = sprite.getChildByName ? sprite.getChildByName('functionalParkingBorder') : null;
        const shouldHaveBorder = this.isFunctionalParking(edificio);

        // Avoid rebuilding Pixi Graphics every frame; only react to parking
        // activation/deactivation transitions.
        if (shouldHaveBorder && !oldBorder) {
            this.addFunctionalParkingBorder(sprite, edificio);
        } else if (!shouldHaveBorder && oldBorder) {
            sprite.removeChild(oldBorder);
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
    updateLabelsVisibility() {
        this.etiquetasEdificios.forEach((container) => {
            container.visible = etiquetasVisibles('buildings');
            container.labelText.style = estiloEtiqueta();
            actualizarFondoEtiqueta(container);
            container.scale.set(1 / (window.escala || 1));
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

    isInViewport(worldX, worldY, width = 0, height = 0, angle = 0) {
        const bounds = this.getViewportBounds();

        // Calcular los límites del edificio (considerando su tamaño)
        const radians = angle * Math.PI / 180;
        const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
        const halfWidth = (width * cos + height * sin) / 2;
        const halfHeight = (width * sin + height * cos) / 2;

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

    isPolygonInViewport(vertices) {
        const polygonBounds = window.edificioPolygonGeometry.bounds(vertices);
        if (!polygonBounds) return false;
        const bounds = this.getViewportBounds();
        return polygonBounds.maxX >= bounds.left && polygonBounds.minX <= bounds.right &&
            polygonBounds.maxY >= bounds.top && polygonBounds.minY <= bounds.bottom;
    }
}

window.EdificioRenderer = EdificioRenderer;
console.log('✓ EdificioRenderer cargado');
