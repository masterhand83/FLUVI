/**
 * CarroRenderer.js - Renderizador de vehículos
 * Maneja la visualización y actualización eficiente de sprites de carros
 */

class CarroRenderer {
    constructor(sceneManager, assetLoader) {
        this.scene = sceneManager;
        this.assets = assetLoader;
        this.celda_tamano = window.celda_tamano || 5;

        // Object pool para reutilizar sprites
        this.spritePool = [];
        this.maxPoolSize = 1000;

        // Dirty tracking: solo actualizar vehículos que cambiaron
        this.lastVehicleState = new Map(); // Map<id, tipo>
        this.updateCounter = 0;
        this.fullUpdateInterval = 60; // Full update cada 60 frames (~1 segundo a 60 FPS)

        // 📱 OPTIMIZACIÓN MÓVIL: Viewport culling (desactivar sprites fuera de pantalla)
        this.isMobile = window.pixiApp && window.pixiApp.isMobile;
        this.viewportCullingEnabled = this.isMobile; // Solo en móviles
        this.viewportPadding = 200; // Píxeles extra alrededor del viewport
    }

    renderAll(calles) {
        if (!calles || calles.length === 0) return;

        // console.log(`🚗 CarroRenderer: Renderizando vehículos de ${calles.length} calles`);

        calles.forEach(calle => {
            this.renderCalleVehiculos(calle);
        });

        // Limpiar sprites de carros que ya no existen
        this.cleanupUnusedSprites(calles);
    }

    updateAll(calles) {
        // OPTIMIZACIÓN: Usar dirty tracking para actualizar solo lo que cambió
        this.updateCounter++;

        // Cada N frames, hacer un full update para asegurar consistencia
        const isFullUpdate = (this.updateCounter % this.fullUpdateInterval) === 0;

        if (isFullUpdate) {
            // Full update: revisar todo
            calles.forEach(calle => {
                this.updateCalleVehiculosFull(calle);
            });
        } else {
            // Incremental update: solo lo que cambió
            calles.forEach(calle => {
                this.updateCalleVehiculosIncremental(calle);
            });
        }
    }

    renderCalleVehiculos(calle) {
        if (!calle.arreglo) return;

        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                this.createOrUpdateCarroSprite(calle, carril, indice);
            }
        }
    }

    updateCalleVehiculosFull(calle) {
        if (!calle.arreglo) return;

        // Full update: revisar todas las celdas
        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                const id = this.getCarroId(calle, carril, indice);
                const tipo = calle.arreglo[carril][indice];

                // Guardar estado actual
                this.lastVehicleState.set(id, tipo);

                if (tipo === 0) {
                    this.removeCarroSprite(id);
                } else {
                    this.createOrUpdateCarroSprite(calle, carril, indice);
                }
            }
        }
    }

    updateCalleVehiculosIncremental(calle) {
        if (!calle.arreglo) return;

        // OPTIMIZACIÓN CRÍTICA: Solo actualizar celdas que cambiaron
        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                const id = this.getCarroId(calle, carril, indice);
                const tipoActual = calle.arreglo[carril][indice];
                const tipoAnterior = this.lastVehicleState.get(id);

                // Solo actualizar si el estado cambió
                if (tipoActual !== tipoAnterior) {
                    this.lastVehicleState.set(id, tipoActual);

                    if (tipoActual === 0) {
                        this.removeCarroSprite(id);
                    } else {
                        this.createOrUpdateCarroSprite(calle, carril, indice);
                    }
                }
            }
        }
    }

    createOrUpdateCarroSprite(calle, carril, indice) {
        const id = this.getCarroId(calle, carril, indice);
        const tipo = calle.arreglo[carril][indice];

        if (tipo === 0) {
            // No hay vehículo
            this.removeCarroSprite(id);
            return;
        }

        // Obtener coordenadas globales
        const coords = calle.esCurva && window.obtenerCoordenadasGlobalesCeldaConCurva
            ? window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice)
            : this.obtenerCoordenadasBasicas(calle, carril, indice);

        let sprite = this.scene.carroSprites.get(id);
        const needsRecreate = sprite && sprite.userData && sprite.userData.tipo !== tipo;

        // Si el sprite existe pero cambió de tipo, eliminarlo y recrearlo
        if (needsRecreate) {
            this.removeCarroSprite(id);
            sprite = null;
        }

        if (!sprite) {
            // Para tipo 7 (bloqueo), verificar metadata para determinar textura
            if (tipo === 7) {
                // IMPORTANTE: Usar la misma lógica que en escenarios.js
                const calleId = calle.id || calle.nombre;
                const celdaKey = `${calleId}:${carril}:${indice}`;
                const metadata = window.estadoEscenarios?.celdasBloqueadas.get(celdaKey);

                sprite = this.acquireSprite();

                if (metadata && metadata.texture) {
                    // Usar textura específica (inundacion, bache, trabajador)
                    const texture = this.assets.getTexture(metadata.texture);
                    sprite.texture = texture;
                    sprite.anchor.set(0.5);
                    sprite.width = this.celda_tamano;
                    sprite.height = this.celda_tamano;
                    sprite.tint = 0xFFFFFF; // Sin tinte
                    sprite.alpha = 1.0; // Opaco
                } else {
                    // Bloqueo por defecto: textura de carretera con tinte rojo
                    const texture = this.assets.getTexture('carretera');
                    sprite.texture = texture;
                    sprite.anchor.set(0.5);
                    sprite.width = this.celda_tamano;
                    sprite.height = this.celda_tamano;
                    sprite.tint = 0xFF0000; // Rojo
                    sprite.alpha = 0.6; // Translúcido
                }

                sprite.zIndex = 1;
                sprite.eventMode = 'none';
                sprite.userData = { tipo: 7 }; // Guardar tipo para detectar cambios
            } else if (tipo === 8 || tipo === 9) {
                // Tipos 8 y 9: Conexiones de estacionamiento
                // YA NO se renderizan como cuadros de colores
                // Las conexiones se dibujan como líneas en ConexionRenderer
                // Simplemente no crear sprite para estos tipos
                return;
            } else {
                // Para vehículos normales (tipo 1-6)
                sprite = this.acquireSprite();
                const texture = this.assets.getTexture(`carro${tipo}`);
                sprite.texture = texture;
                sprite.anchor.set(0.5);
                sprite.width = this.celda_tamano;
                sprite.height = this.celda_tamano;
                sprite.tint = 0xFFFFFF; // Blanco (sin tinte)
                sprite.alpha = 1.0; // Opaco
                sprite.zIndex = 1;
                sprite.eventMode = 'none';
                sprite.userData = { tipo: tipo }; // Guardar tipo para detectar cambios
            }

            this.scene.carroSprites.set(id, sprite);
            this.scene.getLayer('vehicles').addChild(sprite);
        }

        // Actualizar posición y rotación
        sprite.x = coords.x;
        sprite.y = coords.y;
        sprite.rotation = CoordinateConverter.degreesToRadians(coords.angulo || calle.angulo);

        // 📱 OPTIMIZACIÓN MÓVIL: Viewport culling
        if (this.viewportCullingEnabled) {
            sprite.visible = this.isInViewport(coords.x, coords.y);
        } else {
            sprite.visible = true;
        }
    }

    obtenerCoordenadasBasicas(calle, carril, indice) {
        const angle = -calle.angulo * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const localX = indice * this.celda_tamano + this.celda_tamano / 2;
        const localY = carril * this.celda_tamano + this.celda_tamano / 2;

        return {
            x: calle.x + (localX * cos - localY * sin),
            y: calle.y + (localX * sin + localY * cos),
            angulo: calle.angulo
        };
    }

    removeCarroSprite(id) {
        const sprite = this.scene.carroSprites.get(id);
        if (sprite) {
            this.releaseSprite(sprite);
            this.scene.carroSprites.delete(id);
        }
    }

    cleanupUnusedSprites(calles) {
        // Construir set de IDs válidos
        const validIds = new Set();
        calles.forEach(calle => {
            if (!calle.arreglo) return;

            for (let carril = 0; carril < calle.carriles; carril++) {
                for (let indice = 0; indice < calle.tamano; indice++) {
                    if (calle.arreglo[carril][indice] !== 0) {
                        const id = this.getCarroId(calle, carril, indice);
                        validIds.add(id);
                    }
                }
            }
        });

        // Eliminar sprites que ya no son válidos
        const idsToRemove = [];
        this.scene.carroSprites.forEach((sprite, id) => {
            if (!validIds.has(id)) {
                idsToRemove.push(id);
            }
        });

        idsToRemove.forEach(id => this.removeCarroSprite(id));
    }

    getCarroId(calle, carril, indice) {
        // OPTIMIZACIÓN: Usar concatenación en lugar de template strings
        // Template strings son más lentos que concatenación simple
        // Esta función se llama ~180,000 veces por segundo
        return calle.nombre + '_' + carril + '_' + indice;
    }

    // Object pooling para performance
    acquireSprite() {
        if (this.spritePool.length > 0) {
            return this.spritePool.pop();
        }
        const sprite = new PIXI.Sprite();
        // IMPORTANTE: Configurar desde el inicio para evitar capturar eventos
        sprite.eventMode = 'none';
        return sprite;
    }

    releaseSprite(sprite) {
        sprite.visible = false;
        sprite.parent?.removeChild(sprite);

        if (this.spritePool.length < this.maxPoolSize) {
            this.spritePool.push(sprite);
        } else {
            sprite.destroy();
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

    isInViewport(worldX, worldY) {
        const bounds = this.getViewportBounds();
        return worldX >= bounds.left &&
               worldX <= bounds.right &&
               worldY >= bounds.top &&
               worldY <= bounds.bottom;
    }

    clearAll() {
        this.scene.carroSprites.forEach((sprite, id) => {
            this.releaseSprite(sprite);
        });
        this.scene.carroSprites.clear();
    }
}

window.CarroRenderer = CarroRenderer;
console.log('✓ CarroRenderer cargado');
