/**
 * DayNightCycle.js - Sistema de ciclo día/noche optimizado
 * Maneja transiciones suaves de color de fondo basado en la hora simulada
 * Sistema continuo: 12 AM (medianoche) = más oscuro, 12 PM (mediodía) = más claro
 *
 * También administra el color de fondo elegido por el usuario. El preset "sky"
 * conserva la paleta animada original; los demás presets y el color
 * personalizado usan su color base y se aclaran u oscurecen con el mismo ritmo
 * del cielo simulado.
 */

class DayNightCycle {
    // Colores base de los presets. "sky" no aparece aquí: usa la paleta animada.
    static PRESET_COLORS = Object.freeze({
        blue: 0x1E3A8A,
        guinda: 0x7A1F3D,
        grey: 0xC6CBCD,
        white: 0xFFFFFF
    });

    static DEFAULT_PRESET = 'sky';

    constructor() {
        // Paleta de colores clave para las 24 horas (puntos de control)
        // Interpolación continua entre estos puntos
this.colorKeyframes = [
  { hour: 0,  color: 0x12163A}, // 12:00 AM - Inicio de ciclo (madrugada)
  { hour: 1,  color: 0x121843 }, // 1:00 AM - Madrugada
  { hour: 2,  color: 0x121B4C }, // 2:00 AM - Madrugada
  { hour: 3,  color: 0x111D56 }, // 3:00 AM - Madrugada
  { hour: 4,  color: 0x0F205F }, // 4:00 AM - Madrugada
  { hour: 5,  color: 0x0C2269 }, // 5:00 AM - Pre-amanecer
  { hour: 6,  color: 0xBED5F9 }, // 6:00 AM - Amanecer
  { hour: 7,  color: 0x90B8F4 }, // 7:00 AM - Amanecer avanzado
  { hour: 8,  color: 0x6AA0F0 }, // 8:00 AM - Mañana temprana
  { hour: 9,  color: 0x6AA0F0 }, // 9:00 AM - Mañana
  { hour: 10, color: 0x6AA0F0 }, // 10:00 AM - Media mañana
  { hour: 11, color: 0x6AA0F0 }, // 11:00 AM - Pre-mediodía
  { hour: 12, color: 0x6AA0F0 }, // 12:00 PM - Mediodía
  { hour: 13, color: 0x6AA0F0 }, // 1:00 PM - Tarde temprana
  { hour: 14, color: 0x6AA0F0 }, // 2:00 PM - Tarde
  { hour: 15, color: 0x6AA0F0 }, // 3:00 PM - Media tarde
  { hour: 16, color: 0x6AA0F0 }, // 4:00 PM - Tarde avanzada
  { hour: 17, color: 0x6190D8 }, // 5:00 PM - Pre-atardecer
  { hour: 18, color: 0x0C2269 }, // 6:00 PM - Atardecer
  { hour: 19, color: 0x0F205F }, // 7:00 PM - Atardecer avanzado
  { hour: 20, color: 0x111D56 }, // 8:00 PM - Noche temprana
  { hour: 21, color: 0x121B4C }, // 9:00 PM - Noche temprana
  { hour: 22, color: 0x121843 }, // 10:00 PM - Noche
  { hour: 23, color: 0x12163A }, // 11:00 PM - Noche profunda
  { hour: 24, color: 0x121331 }  // 12:00 AM - Medianoche (cierra el ciclo)
];

        // Cache para evitar recálculos innecesarios
        this.lastHour = -1;
        this.lastMinute = -1;
        this.preset = DayNightCycle.DEFAULT_PRESET;
        this.customColor = null;
        this.currentColor = this.colorKeyframes[12].color; // Empezar con color del mediodía

        console.log('🌅 DayNightCycle inicializado (sistema continuo 24h)');
    }

    static isValidPreset(value) {
        return value === 'sky'
            || value === 'custom'
            || Object.prototype.hasOwnProperty.call(DayNightCycle.PRESET_COLORS, value);
    }

    /**
     * Acepta un número 0xRRGGBB o una cadena "#RRGGBB" / "RRGGBB".
     * @returns {number|null} Color normalizado o null si es inválido.
     */
    static parseColor(value) {
        if (typeof value === 'number') {
            return Number.isInteger(value) && value >= 0 && value <= 0xFFFFFF ? value : null;
        }
        if (typeof value !== 'string') return null;
        const normalized = value.trim().replace(/^#/, '');
        return /^[0-9a-fA-F]{6}$/.test(normalized) ? Number.parseInt(normalized, 16) : null;
    }

    static colorToCss(color) {
        return `#${color.toString(16).padStart(6, '0')}`;
    }

    /**
     * Cambia el fondo del mapa. Un preset desconocido vuelve a "sky" y un color
     * personalizado inválido también vuelve a "sky".
     * @returns {{preset: string, color: string}} Preferencia normalizada.
     */
    setBackgroundPreset(preset, customColor) {
        const parsedCustom = DayNightCycle.parseColor(customColor);
        let nextPreset = DayNightCycle.isValidPreset(preset)
            ? preset
            : DayNightCycle.DEFAULT_PRESET;

        if (nextPreset === 'custom' && parsedCustom === null) {
            nextPreset = DayNightCycle.DEFAULT_PRESET;
        }

        this.preset = nextPreset;
        if (parsedCustom !== null) {
            this.customColor = parsedCustom;
        }
        this.invalidateCache();
        return this.getPreference();
    }

    getBaseColor() {
        if (this.preset === 'custom' && this.customColor !== null) {
            return this.customColor;
        }
        const presetColor = DayNightCycle.PRESET_COLORS[this.preset];
        if (presetColor !== undefined) return presetColor;
        return this.colorKeyframes[12].color; // Cielo de mediodía
    }

    getPreference() {
        return { preset: this.preset, color: DayNightCycle.colorToCss(this.getBaseColor()) };
    }

    toJSON() {
        return this.getPreference();
    }

    fromJSON(data) {
        if (!data || typeof data !== 'object') {
            return this.setBackgroundPreset(DayNightCycle.DEFAULT_PRESET, null);
        }
        return this.setBackgroundPreset(data.preset, data.color);
    }

    invalidateCache() {
        this.lastHour = -1;
        this.lastMinute = -1;
    }

    /**
     * Fecha simulada compartida por ambos renderizadores.
     * @returns {Date|null} Fecha simulada o null si aún no existe.
     */
    getSimulatedDate() {
        if (typeof window !== 'undefined' && window.configuracionTiempo) {
            const simulatedDate = new Date();
            simulatedDate.setHours(Math.floor(window.configuracionTiempo.horaActual));
            simulatedDate.setMinutes(Math.floor(window.configuracionTiempo.minutoActual));
            simulatedDate.setSeconds(Math.floor(window.configuracionTiempo.segundoActual));
            return simulatedDate;
        }
        if (typeof window !== 'undefined' && window.simulatedCurrentDate) {
            return window.simulatedCurrentDate;
        }
        return null;
    }

    /**
     * Obtiene el color de fondo basado en la hora simulada.
     * @param {Date} [simulatedDate] - Fecha y hora simulada.
     * @returns {number} Color en formato hexadecimal (0xRRGGBB)
     */
    getBackgroundColor(simulatedDate) {
        const date = simulatedDate || this.getSimulatedDate();
        if (!date) return this.getBaseColor();

        const hour = date.getHours();
        const minute = date.getMinutes();

        // Solo recalcular si cambió la hora o minuto (optimización)
        if (hour === this.lastHour && minute === this.lastMinute) {
            return this.currentColor;
        }

        const hourChanged = hour !== this.lastHour;

        this.lastHour = hour;
        this.lastMinute = minute;

        if (hourChanged) {
            console.log(`🌅 Ciclo día/noche: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} - ${this.getTimeOfDayDescription(date)}`);
        }

        const skyColor = this.getSkyColor(hour, minute);
        this.currentColor = this.preset === 'sky'
            ? skyColor
            : this.shadeColor(this.getBaseColor(), skyColor);
        return this.currentColor;
    }

    /**
     * Color CSS del fondo actual, listo para Canvas 2D.
     * @param {Date} [simulatedDate]
     * @returns {string} "#RRGGBB"
     */
    getBackgroundColorCss(simulatedDate) {
        return DayNightCycle.colorToCss(this.getBackgroundColor(simulatedDate));
    }

    /**
     * Interpola la paleta animada del cielo para la hora indicada.
     * @param {number} hour - Hora 0-23
     * @param {number} minute - Minuto 0-59
     * @returns {number} Color (0xRRGGBB)
     */
    getSkyColor(hour, minute) {
        // Calcular tiempo exacto en horas (con fracciones de minutos)
        const exactHour = hour + (minute / 60);

        // Encontrar los dos keyframes entre los cuales interpolar
        let keyframe1 = this.colorKeyframes[0];
        let keyframe2 = this.colorKeyframes[1];

        for (let i = 0; i < this.colorKeyframes.length - 1; i++) {
            if (exactHour >= this.colorKeyframes[i].hour && exactHour <= this.colorKeyframes[i + 1].hour) {
                keyframe1 = this.colorKeyframes[i];
                keyframe2 = this.colorKeyframes[i + 1];
                break;
            }
        }

        // Calcular progreso entre los dos keyframes (0 a 1)
        const hourRange = keyframe2.hour - keyframe1.hour;
        const progress = hourRange > 0 ? (exactHour - keyframe1.hour) / hourRange : 0;

        return this.interpolateColors(keyframe1.color, keyframe2.color, progress);
    }

    /**
     * Ajusta un color base con el brillo relativo del cielo simulado, de modo
     * que todos los presets compartan el mismo ritmo día/noche.
     * @param {number} baseColor - Color base (0xRRGGBB)
     * @param {number} skyColor - Color del cielo para la misma hora
     * @returns {number} Color ajustado (0xRRGGBB)
     */
    shadeColor(baseColor, skyColor) {
        const noonSky = this.colorKeyframes[12].color;
        const noonLuminance = this.relativeLuminance(noonSky);
        const ratio = noonLuminance > 0
            ? this.relativeLuminance(skyColor) / noonLuminance
            : 1;
        // 0.35 en la noche profunda y 1.0 al mediodía.
        const shade = 0.35 + (0.65 * Math.max(0, Math.min(1, ratio)));

        const r = Math.round(((baseColor >> 16) & 0xFF) * shade);
        const g = Math.round(((baseColor >> 8) & 0xFF) * shade);
        const b = Math.round((baseColor & 0xFF) * shade);
        return (r << 16) | (g << 8) | b;
    }

    relativeLuminance(color) {
        const r = (color >> 16) & 0xFF;
        const g = (color >> 8) & 0xFF;
        const b = color & 0xFF;
        return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    }

    /**
     * Interpola linealmente entre dos colores
     * @param {number} color1 - Color inicial (0xRRGGBB)
     * @param {number} color2 - Color final (0xRRGGBB)
     * @param {number} t - Progreso de 0 a 1
     * @returns {number} Color interpolado (0xRRGGBB)
     */
    interpolateColors(color1, color2, t) {
        // Extraer componentes RGB
        const r1 = (color1 >> 16) & 0xFF;
        const g1 = (color1 >> 8) & 0xFF;
        const b1 = color1 & 0xFF;

        const r2 = (color2 >> 16) & 0xFF;
        const g2 = (color2 >> 8) & 0xFF;
        const b2 = color2 & 0xFF;

        // Interpolar cada componente
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);

        // Combinar en un solo valor hexadecimal
        return (r << 16) | (g << 8) | b;
    }

    /**
     * Obtiene una descripción textual del momento del día
     * @param {Date} simulatedDate - Fecha y hora simulada
     * @returns {string} Descripción del momento del día
     */
    getTimeOfDayDescription(simulatedDate) {
        if (!simulatedDate) return 'Mediodía';

        const hour = simulatedDate.getHours();

        if (hour === 0) return 'Medianoche';
        if (hour >= 1 && hour < 5) return 'Madrugada';
        if (hour >= 5 && hour < 7) return 'Amanecer';
        if (hour >= 7 && hour < 12) return 'Mañana';
        if (hour === 12) return 'Mediodía';
        if (hour >= 13 && hour < 18) return 'Tarde';
        if (hour >= 18 && hour < 21) return 'Atardecer';
        if (hour >= 21 && hour < 24) return 'Noche';
        return 'Noche';
    }

    /**
     * Resetea el cache de color (útil al reiniciar la simulación).
     * Conserva el preset elegido.
     */
    reset() {
        this.invalidateCache();
        this.currentColor = this.colorKeyframes[12].color;
    }
}

// Instancia compartida por Pixi y por el fallback Canvas.
window.DayNightCycle = DayNightCycle;
window.mapBackgroundCycle = new DayNightCycle();
console.log('✓ DayNightCycle cargado');
