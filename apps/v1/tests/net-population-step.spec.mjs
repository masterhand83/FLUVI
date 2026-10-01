import { expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

it('measures manual simulation steps even with the calendar disabled', async () => {
    const simulator = await openSimulator();
    try {
        const result = await simulator.page.evaluate(() => {
            if (!window.isPaused) document.getElementById('btnPauseResume').click();
            window.resetSimulationMetrics();
            const index = window.calles.findIndex(street => street.tamano >= 40);
            const street = window.calles[index];
            street.tipo = TIPOS.CONEXION;
            street.arreglo.forEach(lane => lane.fill(0));
            // Isolate the selected street from transfers, generation, and parking.
            window.conexiones.length = 0;
            street.conexionesEstacionamiento = new Map();
            street.arreglo[0][3] = 1;
            window.excluirTodasLasCalles();
            window.incluirCalle(index);
            configuracionTiempo.activo = false;
            const calendar = window.obtenerMillisVirtuales();
            const initial = calculateMetrics().netGeneration;
            street.arreglo[0][3] = 0;
            for (let i = 0; i < 3; i++) document.getElementById('btnPaso').click();
            return {
                initial,
                rate: calculateMetrics().netGeneration,
                calendarUnchanged: window.obtenerMillisVirtuales() === calendar
            };
        });
        expect(result).toEqual({ initial: '0.00', rate: '-0.17', calendarUnchanged: true });
        expect(simulator.pageErrors).toEqual([]);
    } finally {
        await simulator.close();
    }
}, 60000);
