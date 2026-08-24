/**
 * DayNightCycle.js - Sistema de ciclo día/noche optimizado
 * Maneja transiciones suaves de color de fondo basado en la hora simulada
 * Sistema continuo: 12 AM (medianoche) = más oscuro, 12 PM (mediodía) = más claro
 */

class DayNightCycle {
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
        this.currentColor = this.colorKeyframes[12].color; // Empezar con color del mediodía

        console.log('🌅 DayNightCycle inicializado (sistema continuo 24h)');
    }

    /**
     * Obtiene el color de fondo basado en la hora simulada
     * Interpolación continua entre keyframes para transiciones suaves
     * @param {Date} simulatedDate - Fecha y hora simulada
     * @returns {number} Color en formato hexadecimal (0xRRGGBB)
     */
    getBackgroundColor(simulatedDate) {
        if (!simulatedDate) {
            return this.colorKeyframes[12].color; // Mediodía por defecto
        }

        const hour = simulatedDate.getHours();
        const minute = simulatedDate.getMinutes();

        // Solo recalcular si cambió la hora o minuto (optimización)
        if (hour === this.lastHour && minute === this.lastMinute) {
            return this.currentColor;
        }

        // Debug: Log cuando cambia la hora
        const hourChanged = hour !== this.lastHour;

        this.lastHour = hour;
        this.lastMinute = minute;

        if (hourChanged) {
            console.log(`🌅 Ciclo día/noche: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} - ${this.getTimeOfDayDescription(simulatedDate)}`);
        }

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

        // Interpolar entre los dos colores
        const color = this.interpolateColors(keyframe1.color, keyframe2.color, progress);

        this.currentColor = color;
        return color;
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
     * Resetea el cache (útil al reiniciar la simulación)
     */
    reset() {
        this.lastHour = -1;
        this.lastMinute = -1;
        this.currentColor = this.colors.day;
    }
}

// Exponer globalmente
window.DayNightCycle = DayNightCycle;
console.log('✓ DayNightCycle cargado');
