import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { openSimulator } from './helpers/simulator.mjs';

const source = readFileSync(new URL('../src/js/core/trafico.js', import.meta.url), 'utf8');

function setup() {
    const elements = Object.fromEntries(['inputGeneracionGlobal', 'toggleGeneracionGlobal'].map(id => [id, {
        value: '', checked: false, listeners: {}, invalid: false,
        classList: { toggle(_name, value) { elements[id].invalid = value; } },
        setAttribute() {}, focus() {},
        addEventListener(event, callback) { this.listeners[event] = callback; },
    }]));
    const context = {
        window: {}, document: { getElementById: id => elements[id] },
        TIPOS: { GENERADOR: 'generador' }, Math: Object.create(Math),
        getLaneEntryCell: (road, lane) => road.laneDirections?.[lane] === -1 ? 2 : 0,
    };
    context.Math.random = () => 0.4;
    runInNewContext(source.slice(source.indexOf('const generacionGlobal ='), source.indexOf('function actualizarCalle(')) +
        '\ninicializarGeneracionGlobal(); this.generate = generarCelulas;', context);
    const input = elements.inputGeneracionGlobal;
    input.value = String(input.value); // DOM input values are always strings.
    const toggle = elements.toggleGeneracionGlobal;
    const setValue = value => { input.value = String(value); input.listeners.input(); };
    const activate = active => { toggle.checked = active; toggle.listeners.change(); };
    const road = probability => ({ tipo: 'generador', probabilidadGeneracion: probability, carriles: 2,
        laneDirections: [1, -1], arreglo: [[0, 0, 0], [0, 0, 0]] });
    return { context, input, toggle, setValue, activate, road };
}

describe('global generator percentage', () => {
    it('wires the real sidebar controls to generation in the running app', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                const input = document.getElementById('inputGeneracionGlobal');
                const toggle = document.getElementById('toggleGeneracionGlobal');
                const street = calles.find(street => street.tipo === TIPOS.GENERADOR);
                const original = street.probabilidadGeneracion;
                window.configuracionTiempo.usarPerfiles = false;
                const setValue = value => {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                const clear = () => street.arreglo.forEach(lane => lane.fill(0));
                setValue('0');
                toggle.click();
                clear();
                generarCelulas(street);
                const zeroStopsGeneration = street.arreglo.every(lane => lane.every(cell => cell === 0));
                setValue('100');
                generarCelulas(street);
                const allLanesGenerate = street.arreglo.every((lane, index) => lane[getLaneEntryCell(street, index)] > 0);
                toggle.click();
                return {
                    inSidebar: Boolean(input.closest('#collapseConfig') && toggle.closest('#collapseConfig')),
                    zeroStopsGeneration, allLanesGenerate,
                    individualUnchanged: street.probabilidadGeneracion === original,
                    disabled: !generacionGlobal.activa,
                };
            });
            expect(result).toEqual({ inSidebar: true, zeroStopsGeneration: true, allLanesGenerate: true,
                individualUnchanged: true, disabled: true });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('defaults off and restores individual percentages without mutating them', () => {
        const { context, setValue, activate, road, toggle } = setup();
        expect(toggle.checked).toBe(false);
        const low = road(0.1);
        const high = road(0.9);
        context.generate(low);
        expect(low.arreglo[0][0]).toBe(0);
        setValue(100);
        activate(true);
        for (const street of [low, high, road(0)]) {
            context.generate(street);
            expect(street.arreglo[0][0]).toBeGreaterThan(0);
            expect(street.arreglo[1][2]).toBeGreaterThan(0);
        }
        expect(low.probabilidadGeneracion).toBe(0.1);
        expect(high.probabilidadGeneracion).toBe(0.9);
        activate(false);
        low.arreglo.forEach(lane => lane.fill(0));
        context.generate(low);
        expect(low.arreglo[0][0]).toBe(0);
        context.generate(high);
        expect(high.arreglo[0][0]).toBeGreaterThan(0);
    });

    it('applies live changes, respects occupied cells and does not affect non-generators', () => {
        const { context, setValue, activate, road } = setup();
        activate(true);
        setValue(0);
        const street = road(1);
        context.generate(street);
        expect(street.arreglo[0][0]).toBe(0);
        setValue(100);
        street.arreglo[0][0] = 7;
        context.generate(street);
        expect(street.arreglo[0][0]).toBe(7);
        expect(street.arreglo[1][2]).toBeGreaterThan(0);
        const connection = { ...road(1), tipo: 'conexion' };
        context.generate(connection);
        expect(connection.arreglo[0][0]).toBe(0);
    });

    it('keeps hourly profiles as multipliers of the overridden percentage', () => {
        const { context, setValue, activate, road } = setup();
        context.window.configuracionTiempo = { usarPerfiles: true };
        context.window.obtenerMultiplicadorTrafico = () => 0.5;
        setValue(60);
        activate(true);
        const street = road(1);
        context.generate(street);
        expect(street.arreglo[0][0]).toBe(0);
        context.window.configuracionTiempo.usarPerfiles = false;
        context.generate(street);
        expect(street.arreglo[0][0]).toBeGreaterThan(0);
    });

    it('rejects invalid values and prevents activating an invalid percentage', () => {
        const { context, input, toggle, setValue, activate, road } = setup();
        for (const value of ['', -1, 101, 'abc']) {
            setValue(value);
            expect(input.invalid).toBe(true);
            activate(true);
            expect(toggle.checked).toBe(false);
        }
        setValue(0);
        activate(true);
        setValue(101);
        const street = road(1);
        context.generate(street);
        expect(street.arreglo[0][0]).toBe(0); // last valid value remains effective
        setValue(100);
        expect(input.invalid).toBe(false);
        context.generate(street);
        expect(street.arreglo[0][0]).toBeGreaterThan(0);
    });
});
