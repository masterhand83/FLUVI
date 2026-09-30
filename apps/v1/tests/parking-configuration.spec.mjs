import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = readFileSync(new URL('../src/js/core/estacionamientos.js', import.meta.url), 'utf8');
const constructor = readFileSync(new URL('../src/js/ui/constructor.js', import.meta.url), 'utf8');
let context, window, road, building;
const pair = (a = 0, b = 1) => [
    { tipo: 'entrada', calleId: 'road', carril: 0, indice: a },
    { tipo: 'salida', calleId: 'road', carril: 0, indice: b },
];

beforeEach(() => {
    road = { id: 'road', nombre: 'Calle', arreglo: [Array(30).fill(0)] };
    building = { id: 'building', label: 'Edificio', vehiculosActuales: 0 };
    window = { calles: [road], edificios: [building], renderizarCanvas: vi.fn() };
    context = vm.createContext({ window, console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(core, context);
});

describe('atomic parking configuration', () => {
    it.each([
        [null, 50], [[], 50], [[pair()[0]], 50],
        [[...pair(), { ...pair()[0], tipo: 'invalid' }], 50],
        [pair(), 0], [pair(), -1], [pair(), 1.5], [pair(), '50'],
        [[{ ...pair()[0], calleId: 'missing' }, pair()[1]], 50],
        [[{ ...pair()[0], carril: -1 }, pair()[1]], 50],
        [[{ ...pair()[0], carril: 0.5 }, pair()[1]], 50],
        [[{ ...pair()[0], indice: '0' }, pair()[1]], 50],
        [[{ ...pair()[0], indice: 30 }, pair()[1]], 50],
        [pair(0, 0), 50],
        [Array.from({ length: 11 }, (_, i) => pair(i * 2, i * 2 + 1)).flat(), 50],
    ])('rejects invalid enable drafts without mutating live state (%j, %j)', (connections, capacity) => {
        window.configurarEstacionamiento(building, pair(25, 26), 50);
        const oldConnections = building.conexiones;
        const oldMappings = [...road.conexionesEstacionamiento];
        expect(window.validarConfiguracionEstacionamiento(building, connections, capacity)).toEqual(expect.any(String));
        if (connections?.length === 0) return; // configure([]) is the legacy disable API.
        expect(window.configurarEstacionamiento(building, connections, capacity)).toBe(false);
        expect(building.conexiones).toBe(oldConnections);
        expect([...road.conexionesEstacionamiento]).toEqual(oldMappings);
        expect(building.capacidadMaxima).toBe(50);
    });

    it('replaces owned maps only, preserves occupancy and copies drafts', () => {
        window.configurarEstacionamiento(building, pair(), 50);
        building.vehiculosActuales = 8;
        const other = { id: 'other' };
        road.conexionesEstacionamiento.set('0-9', { edificio: other });
        const draft = pair(2, 3);
        expect(window.configurarEstacionamiento(building, draft, 8)).toBe(true);
        expect([...road.conexionesEstacionamiento.keys()]).toEqual(['0-9', '0-2', '0-3']);
        expect(building.vehiculosActuales).toBe(8);
        expect(draft[0]).not.toHaveProperty('edificioId');
        expect(window.configurarEstacionamiento(building, pair(4, 5), 7)).toBe(false);
        expect(building.capacidadMaxima).toBe(8);
    });

    it('rejects aliases, other owners and building endpoints even without a map', () => {
        const duplicate = pair(); duplicate[1] = { ...duplicate[1], calleId: 'Calle', indice: 0 };
        expect(window.configurarEstacionamiento(building, duplicate, 50)).toBe(false);
        const other = { id: 'other', esEstacionamiento: true, conexiones: pair(2, 3) };
        window.edificios.push(other);
        expect(window.configurarEstacionamiento(building, pair(2, 4), 50)).toBe(false);
        road.conexionesEstacionamiento = new Map([['0-0', { edificio: other }]]);
        expect(window.configurarEstacionamiento(building, pair(), 50)).toBe(false);
        building.conexiones = pair();
        window.limpiarConexionesEdificio(building);
        expect(road.conexionesEstacionamiento.get('0-0').edificio).toBe(other);
    });

    it.each(['rectangle', 'polygon', 'uploaded-image'])('enables ten pairs on %s and disables with immediate renderer refresh', appearanceMode => {
        building.appearanceMode = appearanceMode;
        const scene = { edificioRenderer: { updateEdificioSprite: vi.fn() },
            conexionRenderer: { renderEstacionamientos: vi.fn() }, renderContadores: vi.fn(), clearContadores: vi.fn() };
        window.USE_PIXI = true; window.mostrarContadores = true; window.pixiApp = { sceneManager: scene };
        expect(window.configurarEstacionamiento(building, Array.from({ length: 10 }, (_, i) => pair(i * 2, i * 2 + 1)).flat(), 20)).toBe(true);
        const parkingGraphic = { destroy: vi.fn() };
        const roadGraphic = { destroy: vi.fn() };
        scene.conexionGraphics = new Map([['estacionamiento_old', parkingGraphic], ['road-link', roadGraphic]]);
        building.vehiculosActuales = 12;
        expect(window.configurarEstacionamiento(building, [])).toBe(true);
        expect(building).toMatchObject({ appearanceMode, esEstacionamiento: false, conexiones: [], vehiculosActuales: 0 });
        expect(road.conexionesEstacionamiento.size).toBe(0);
        expect(scene.edificioRenderer.updateEdificioSprite).toHaveBeenCalledTimes(2);
        expect(scene.conexionRenderer.renderEstacionamientos).toHaveBeenCalledTimes(2);
        expect(scene.renderContadores).toHaveBeenCalledTimes(2);
        expect(window.renderizarCanvas).toHaveBeenCalledTimes(2);
        expect(parkingGraphic.destroy).toHaveBeenCalledOnce();
        expect(roadGraphic.destroy).not.toHaveBeenCalled();
        expect([...scene.conexionGraphics.keys()]).toEqual(['road-link']);
    });
});

describe('parking JSON boundary', () => {
    beforeEach(() => {
        vm.runInContext(constructor.slice(constructor.indexOf('function serializarEdificio('), constructor.indexOf('async function decodificarImagenEdificio(')), context);
    });

    it.each(['rectangle', 'polygon', 'uploaded-image'])('round trips explicit functional %s parking after roads exist', appearanceMode => {
        building.appearanceMode = appearanceMode;
        if (appearanceMode === 'polygon') building.geometryType = 'polygon';
        window.configurarEstacionamiento(building, pair(), 50);
        building.vehiculosActuales = 7;
        context.building = building;
        const saved = JSON.parse(vm.runInContext('JSON.stringify(serializarEdificio(building))', context));
        window.edificios = [saved]; road.conexionesEstacionamiento.clear();
        restore();
        expect(saved.esEstacionamiento).toBe(true);
        expect(saved.vehiculosActuales).toBe(7);
        expect(road.conexionesEstacionamiento.size).toBe(2);
        expect(road.conexionesEstacionamiento.get('0-0').edificio).toBe(saved);
    });

    it('never enables decorative names/images or partially restores invalid/conflicting saved parking', () => {
        const base = { capacidadMaxima: 50, conexiones: pair(), vehiculosActuales: 3 };
        window.edificios = [
            { ...base, id: 'decorative', label: 'Estacionamiento', imagen: 'estacionamiento' },
            { ...base, id: 'bad', esEstacionamiento: true, conexiones: [pair()[0], { ...pair()[1], indice: 99 }] },
            { ...base, id: 'valid', esEstacionamiento: true },
            { ...base, id: 'conflict', esEstacionamiento: true },
        ];
        restore();
        expect(window.edificios.map(b => b.esEstacionamiento)).toEqual([false, false, true, false]);
        expect(road.conexionesEstacionamiento.size).toBe(2);
        expect(road.conexionesEstacionamiento.get('0-0').edificio.id).toBe('valid');
        for (const b of window.edificios.filter(b => !b.esEstacionamiento)) {
            expect(b.conexiones).toEqual([]); expect(b.vehiculosActuales).toBe(0);
        }
        context.building = { ...base, esEstacionamiento: true, capacidadMaxima: 1 };
        expect(vm.runInContext('serializarEdificio(building).esEstacionamiento', context)).toBe(false);
    });
});

function restore() {
    const start = constructor.indexOf('const parkingGuardado =');
    const end = constructor.indexOf('// IMPORTANTE: Actualizar selector de edificios después de cargar', start);
    vm.runInContext(constructor.slice(start, end), context);
}
