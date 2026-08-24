/**
 * ClickActionManager.js - Sistema de Gestión de Acciones de Click
 * Permite seleccionar y ejecutar diferentes acciones cuando se hace click en el canvas
 */

class ClickActionManager {
    constructor() {
        // Acción activa por defecto
        this.activeAction = 'toggle';

        // Registro de acciones disponibles
        this.actions = {
            'toggle': {
                name: 'Agregar/Quitar',
                description: 'Alterna entre agregar y quitar vehículos',
                icon: '🔄',
                execute: this.toggleVehicle.bind(this)
            },
            'add': {
                name: 'Solo Agregar',
                description: 'Solo agrega vehículos (no quita)',
                icon: '➕',
                execute: this.addVehicle.bind(this)
            },
            'remove': {
                name: 'Solo Quitar',
                description: 'Solo quita vehículos (no agrega)',
                icon: '➖',
                execute: this.removeVehicle.bind(this)
            }
            // Espacio para futuras acciones:
            // 'changeType': { ... }  - Cambiar tipo de vehículo
            // 'changeColor': { ... } - Cambiar color/textura
            // 'inspect': { ... }     - Inspeccionar propiedades
        };

        console.log('🖱️ ClickActionManager inicializado');
    }

    /**
     * Establece la acción activa
     * @param {string} actionKey - Clave de la acción (ej: 'toggle', 'add', 'remove')
     */
    setActiveAction(actionKey) {
        if (this.actions[actionKey]) {
            this.activeAction = actionKey;
            console.log(`🖱️ Acción de click cambiada a: ${this.actions[actionKey].name}`);

            // Disparar evento personalizado para que la UI se actualice
            window.dispatchEvent(new CustomEvent('clickActionChanged', {
                detail: { action: actionKey, actionData: this.actions[actionKey] }
            }));
        } else {
            console.warn(`⚠️ Acción de click no encontrada: ${actionKey}`);
        }
    }

    /**
     * Obtiene la acción activa actual
     * @returns {object} Objeto con los datos de la acción activa
     */
    getActiveAction() {
        return this.actions[this.activeAction];
    }

    /**
     * Obtiene todas las acciones disponibles
     * @returns {object} Objeto con todas las acciones registradas
     */
    getAllActions() {
        return this.actions;
    }

    /**
     * Ejecuta la acción activa sobre una celda
     * @param {object} cellData - Datos de la celda: { calle, carril, indice }
     * @returns {boolean} true si se realizó algún cambio, false si no
     */
    executeAction(cellData) {
        const action = this.actions[this.activeAction];
        if (action && action.execute) {
            return action.execute(cellData);
        }
        return false;
    }

    /**
     * Registra una nueva acción personalizada
     * @param {string} key - Clave única para la acción
     * @param {object} actionData - Datos de la acción: { name, description, icon, execute }
     */
    registerAction(key, actionData) {
        if (this.actions[key]) {
            console.warn(`⚠️ Sobrescribiendo acción existente: ${key}`);
        }

        // Validar que tenga los campos requeridos
        if (!actionData.name || !actionData.execute || typeof actionData.execute !== 'function') {
            console.error(`❌ Error registrando acción "${key}": debe tener name y execute (function)`);
            return false;
        }

        this.actions[key] = {
            name: actionData.name,
            description: actionData.description || '',
            icon: actionData.icon || '🔧',
            execute: actionData.execute
        };

        console.log(`✅ Acción "${key}" registrada: ${actionData.name}`);

        // Disparar evento para que la UI se actualice
        window.dispatchEvent(new CustomEvent('clickActionRegistered', {
            detail: { key, actionData: this.actions[key] }
        }));

        return true;
    }

    // ==================== ACCIONES PREDEFINIDAS ====================

    /**
     * Acción: Alternar vehículo (agregar si está vacío, quitar si está ocupado)
     * @param {object} cellData - { calle, carril, indice }
     * @returns {boolean} true si se realizó un cambio
     */
    toggleVehicle(cellData) {
        const { calle, carril, indice } = cellData;

        if (calle.arreglo[carril] === undefined) {
            console.warn('⚠️ ClickActionManager: Carril no existe');
            return false;
        }

        const currentValue = calle.arreglo[carril][indice];
        // console.log(`🔄 ClickActionManager.toggleVehicle - Valor actual: ${currentValue} (tipo: ${typeof currentValue})`);

        if (currentValue === 0 || currentValue === undefined) {
            // Celda vacía -> Agregar vehículo
            // Generar tipo aleatorio (1-6 para diferentes texturas)
            const nuevoValor = Math.floor(Math.random() * 6) + 1;
            calle.arreglo[carril][indice] = nuevoValor;
            // console.log(`➕ Vehículo agregado: ${nuevoValor}`);
            return true;
        } else {
            // Celda ocupada -> Quitar vehículo
            calle.arreglo[carril][indice] = 0;
            // console.log(`➖ Vehículo quitado (era: ${currentValue})`);
            return true;
        }
    }

    /**
     * Acción: Solo agregar vehículo
     * @param {object} cellData - { calle, carril, indice }
     * @returns {boolean} true si se agregó un vehículo
     */
    addVehicle(cellData) {
        const { calle, carril, indice } = cellData;

        if (calle.arreglo[carril] === undefined) {
            return false;
        }

        const currentValue = calle.arreglo[carril][indice];

        if (currentValue === 0) {
            // Solo agregar si está vacío
            calle.arreglo[carril][indice] = Math.floor(Math.random() * 6) + 1;
            return true;
        }

        return false; // Ya hay un vehículo, no hacer nada
    }

    /**
     * Acción: Solo quitar vehículo
     * @param {object} cellData - { calle, carril, indice }
     * @returns {boolean} true si se quitó un vehículo
     */
    removeVehicle(cellData) {
        const { calle, carril, indice } = cellData;

        if (calle.arreglo[carril] === undefined) {
            return false;
        }

        const currentValue = calle.arreglo[carril][indice];

        if (currentValue !== 0) {
            // Solo quitar si hay un vehículo
            calle.arreglo[carril][indice] = 0;
            return true;
        }

        return false; // Ya está vacío, no hacer nada
    }
}

// Crear instancia global singleton
window.clickActionManager = new ClickActionManager();

// Exponer globalmente para compatibilidad
window.ClickActionManager = ClickActionManager;

console.log('✓ ClickActionManager cargado');
