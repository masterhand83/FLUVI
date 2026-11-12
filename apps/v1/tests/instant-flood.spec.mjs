import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('instant flood', () => {
    it('floods a percentage of empty cells immediately and leaves occupied cells untouched', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                window.inicializarEscenarios();
                if (!window.isPaused) document.getElementById('btnPauseResume').click();
                window.conexiones.length = 0;
                window.estadoEscenarios.celdasBloqueadas.clear();
                const road = (name, cells) => {
                    const street = window.crearCalle(name, cells.length, TIPOS.CONEXION, 0, 0, 0, 0, 1, 0);
                    street.arreglo[0] = cells;
                    return street;
                };
                const long = road('Long', Array(10).fill(0));
                const short = road('Short:street', [0]);
                const occupied = road('Occupied', [1, 7, 8, 9]);
                window.calles.splice(0, window.calles.length, long, short, occupied);

                const input = document.getElementById('porcentajeInundacionInstantanea');
                const setPercentage = value => {
                    input.value = String(value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                const apply = () => document.getElementById('btnInundacionInstantanea').click();
                const floods = () => window.exportarBloqueos().filter(cell => cell.tipo === 'inundacion').length;

                Math.random = () => 0;
                setPercentage(50);
                apply();
                const half = {
                    long: [...long.arreglo[0]],
                    short: [...short.arreglo[0]],
                    occupied: [...occupied.arreglo[0]],
                    floods: floods(),
                    label: document.getElementById('porcentajeInundacionInstantaneaValor').textContent
                };

                setPercentage(100);
                apply();
                const all = {
                    long: [...long.arreglo[0]],
                    short: [...short.arreglo[0]],
                    occupied: [...occupied.arreglo[0]],
                    floods: floods()
                };

                const full = road('Full', [7, 7]);
                window.calles.splice(0, window.calles.length, full);
                const before = floods();
                apply();
                return {
                    half,
                    all,
                    noEmpty: { before, after: floods() }
                };
            });

            // 15 total cells and 50% means 8 floods; Math.random() = 0 picks scan order.
            expect(result.half.long).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 0, 0]);
            expect(result.half.short).toEqual([0]);
            expect(result.half.occupied).toEqual([1, 7, 8, 9]);
            expect(result.half.floods).toBe(8);
            expect(result.half.label).toBe('50%');

            // 100% floods every remaining empty cell and still preserves occupied cells.
            expect(result.all.long).toEqual(Array(10).fill(7));
            expect(result.all.short).toEqual([7]);
            expect(result.all.occupied).toEqual([1, 7, 8, 9]);
            expect(result.all.floods).toBe(11);

            // A map with no empty cells is a no-op.
            expect(result.noEmpty).toEqual({ before: 11, after: 11 });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);
});
