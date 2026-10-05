import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('traffic profile lifecycle', () => {
    it.each([false, true, undefined])('map replacement honors the profile preference (%s) in real generation', async (savedPreference) => {
        const simulator = await openSimulator();
        try {
            await simulator.page.evaluate((savedPreference) => {
                togglePerfiles(false);
                window.confirm = () => true;
                const data = {
                    nombre: 'Profile regression',
                    calles: [{ nombre: 'Profile generator', tamano: 8, tipo: 'generador', x: 0, y: 0,
                        angulo: 0, carriles: 1, probabilidadGeneracion: 1, probabilidadSaltoDeCarril: 0 }],
                    edificios: [], conexiones: [],
                    configuracionTiempo: { diaActual: 0, horaActual: 0, usarPerfiles: savedPreference },
                };
                cargarSimulacion({ target: { files: [new File([JSON.stringify(data)], 'profiles.json')], value: '' } });
            }, savedPreference);
            await simulator.page.waitForFunction(() => calles.length === 1 && calles[0].nombre === 'Profile generator');
            const result = await simulator.page.evaluate(() => {
                const road = calles[0];
                const checkbox = document.getElementById('togglePerfilesDinamicos');
                const loaded = { enabled: configuracionTiempo.usarPerfiles, checked: checkbox.checked,
                    hour: configuracionTiempo.horaActual, day: configuracionTiempo.diaActual };
                document.getElementById('btnPaso').click();
                const spawned = road.arreglo.flat().some(value => value >= 1 && value <= 6);
                road.arreglo.forEach(lane => lane.fill(0));
                checkbox.click();
                document.getElementById('btnPaso').click();
                return { loaded, spawned, afterClick: road.arreglo.flat().some(value => value >= 1 && value <= 6) };
            });
            const enabled = savedPreference === true;
            expect(result).toEqual({ loaded: { enabled, checked: enabled, hour: 0, day: 0 }, spawned: !enabled, afterClick: enabled });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('disabling profiles immediately removes their multiplier and upcoming changes', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                document.getElementById('btnPauseResume').click();
                configuracionTiempo.horaActual = 8;
                document.getElementById('btnPaso').click();
                document.getElementById('togglePerfilesDinamicos').click();
                return {
                    enabled: configuracionTiempo.usarPerfiles,
                    multiplier: obtenerMultiplicadorTrafico(),
                    displayed: document.getElementById('infoTrafficMultiplier').textContent,
                    upcoming: obtenerProximoCambio(),
                };
            });
            expect(result).toEqual({ enabled: false, multiplier: 1, displayed: '1.0×', upcoming: null });
        } finally {
            await simulator.close();
        }
    }, 30000);

    it.each([false, true])('loading a saved profile state (%s) synchronizes the checkbox and next click', async (enabled) => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate((enabled) => {
                tiempoFromJSON({ usarPerfiles: enabled, diaActual: 1, horaActual: 8 });
                const checkbox = document.getElementById('togglePerfilesDinamicos');
                const loaded = { enabled: configuracionTiempo.usarPerfiles, checked: checkbox.checked,
                    displayed: document.getElementById('infoTrafficMultiplier').textContent };
                checkbox.click();
                return { loaded, afterClick: configuracionTiempo.usarPerfiles };
            }, enabled);
            expect(result).toEqual({ loaded: { enabled, checked: enabled, displayed: enabled ? '1.4×' : '1.0×' }, afterClick: !enabled });
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('loading legacy clock data does not silently re-enable disabled profiles or replace midnight', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                document.getElementById('togglePerfilesDinamicos').click();
                tiempoFromJSON({ diaActual: 0, horaActual: 0 });
                return { enabled: configuracionTiempo.usarPerfiles, day: configuracionTiempo.diaActual,
                    hour: configuracionTiempo.horaActual, multiplier: obtenerMultiplicadorTrafico() };
            });
            expect(result).toEqual({ enabled: false, day: 0, hour: 0, multiplier: 1 });
        } finally {
            await simulator.close();
        }
    }, 30000);
});
