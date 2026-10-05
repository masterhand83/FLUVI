import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('generation across clock changes', () => {
    it('keeps spawning on the built-in map through 250 generations with profiles off', async () => {
        const simulator = await openSimulator();
        try {
            const spawns = await simulator.page.evaluate(() => {
                document.getElementById('btnPauseResume').click();
                document.getElementById('btnBorrar').click();
                configuracionTiempo.usarPerfiles = false;
                const generate = generarCelulas;
                let spawns = 0;
                generarCelulas = road => {
                    const before = road.arreglo.map((lane, i) => lane[getLaneEntryCell(road, i)]);
                    generate(road);
                    spawns += before.filter((value, i) => value === 0 && road.arreglo[i][getLaneEntryCell(road, i)] > 0).length;
                };
                for (let step = 0; step < 250; step++) {
                    if (step === 200) spawns = 0;
                    document.getElementById('btnPaso').click();
                }
                generarCelulas = generate;
                return spawns;
            });
            expect(spawns).toBeGreaterThan(0);
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it.each([false, true])('continues past generation 100 and midnight (profiles %s)', async (profiles) => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate((profiles) => {
                document.getElementById('btnPauseResume').click();
                document.getElementById('btnBorrar').click();
                Object.assign(configuracionTiempo, { usarPerfiles: profiles, diaActual: 1,
                    horaActual: 23, minutoActual: 59, segundoActual: 58 });
                MULTIPLICADORES_POR_DIA_HORA[1][23] = 1;
                MULTIPLICADORES_POR_DIA_HORA[2][0] = 1;
                generacionGlobal.activa = true;
                generacionGlobal.probabilidad = 1;
                const street = calles.find(c => c.tipo === TIPOS.GENERADOR);
                let spawns = 0;
                const generate = generarCelulas;
                generarCelulas = (road) => {
                    generate(road);
                    if (road === street && road.arreglo[0][getLaneEntryCell(road, 0)] > 0) spawns++;
                };
                for (let step = 0; step < 150; step++) {
                    // An open inlet distinguishes stopped generation from traffic congestion.
                    street.arreglo[0][getLaneEntryCell(street, 0)] = 0;
                    document.getElementById('btnPaso').click();
                }
                generarCelulas = generate;
                return { spawns, day: configuracionTiempo.diaActual, hour: configuracionTiempo.horaActual };
            }, profiles);
            expect(result).toEqual({ spawns: 150, day: 2, hour: 0 });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it.each([false, true])('applying scenario time resets traffic and resumes spawning (profiles %s)', async (profiles) => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate((profiles) => {
                document.getElementById('btnPauseResume').click();
                configuracionTiempo.usarPerfiles = profiles;
                generacionGlobal.activa = true;
                generacionGlobal.probabilidad = 1;
                for (let step = 0; step < 110; step++) document.getElementById('btnPaso').click();
                // Simulate a congested generator before resetting the time.
                const street = calles.find(c => c.tipo === TIPOS.GENERADOR);
                street.arreglo.forEach(lane => lane.fill(1));
                street.arreglo[0][street.tamano - 1] = 7;
                street.celulasEsperando[0][0] = true;
                conexiones[0].bloqueada = true;
                const parking = { esEstacionamiento: true, vehiculosActuales: 3, label: 'Reset fixture' };
                window.edificios.push(parking);
                document.getElementById('selectDiaSemanaModal').value = '1';
                document.getElementById('inputHoraModal').value = '8';
                document.getElementById('inputMinutosModal').value = '12';
                document.getElementById('btnConfirmarTiempo').click();
                const reset = {
                    generation: document.getElementById('infoGeneration').textContent,
                    vehicles: calles.reduce((sum, road) => sum + road.arreglo.flat().filter(v => v >= 1 && v <= 6).length, 0),
                    hour: configuracionTiempo.horaActual,
                    minute: configuracionTiempo.minutoActual,
                    second: configuracionTiempo.segundoActual,
                    paused: window.isPaused,
                    blocker: street.arreglo[0][street.tamano - 1],
                    waiting: street.celulasEsperando[0][0],
                    blockedLink: conexiones[0].bloqueada,
                    parking: parking.vehiculosActuales,
                    history: completeMetricsHistory.timestamps.length,
                };
                document.getElementById('btnPaso').click();
                return { reset, spawned: street.arreglo.flat().some(v => v >= 1 && v <= 6) };
            }, profiles);
            expect(result.reset).toEqual({ generation: '0', vehicles: 0, hour: 8, minute: 12, second: 0, paused: true,
                blocker: 7, waiting: false, blockedLink: false, parking: 0, history: 0 });
            expect(result.spawned).toBe(true);
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);
});
