import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = readFileSync(new URL('../src/js/core/estacionamientos.js', import.meta.url), 'utf8');
const constructorSource = readFileSync(new URL('../src/js/ui/constructor.js', import.meta.url), 'utf8');
const deletion = constructorSource.slice(constructorSource.indexOf('function eliminarObjetoSeleccionado('),
    constructorSource.indexOf('// ==================== GUARDAR SIMULACIÓN'));
let window, building, roads, confirmation, scene;

beforeEach(() => {
    roads = ['first', 'second'].map(id => ({ id, nombre: id, arreglo: [Array(10).fill(0)] }));
    building = { id: 'deleted', label: 'Parking', vehiculosActuales: 0 };
    scene = {
        edificioRenderer: { updateEdificioSprite: vi.fn(), removeEdificioSprite: vi.fn() },
        conexionGraphics: new Map(),
        conexionRenderer: { renderEstacionamientos: vi.fn() },
        renderContadores: vi.fn(), clearContadores: vi.fn(),
    };
    window = { calles: roads, edificios: [building], edificioSeleccionado: building,
        renderizarCanvas: vi.fn(), USE_PIXI: true, mostrarContadores: true,
        pixiApp: { sceneManager: scene } };
    confirmation = vi.fn(() => true);
    const context = vm.createContext({ window, confirm: confirmation, alert: vi.fn(),
        console: { log() {}, warn() {}, error() {} },
        simulacionActual: { edificios: [building] }, actualizarSelectorEdificios: vi.fn() });
    vm.runInContext(core, context);
    vm.runInContext(deletion, context);
});

const pair = [
    { tipo: 'entrada', calleId: 'first', carril: 0, indice: 2 },
    { tipo: 'salida', calleId: 'second', carril: 0, indice: 3 },
];

describe('confirmed building deletion', () => {
    it('deactivates occupied parking and releases endpoints across streets for a replacement', () => {
        expect(window.configurarEstacionamiento(building, pair, 20)).toBe(true);
        building.vehiculosActuales = 7;

        window.eliminarObjetoSeleccionado();

        expect(window.edificios).not.toContain(building);
        expect(window.edificioSeleccionado).toBeNull();
        expect(building).toMatchObject({ esEstacionamiento: false, conexiones: [], vehiculosActuales: 0 });
        expect(roads.map(road => road.conexionesEstacionamiento.size)).toEqual([0, 0]);
        const replacement = { id: 'replacement', label: 'Replacement' };
        window.edificios.push(replacement);
        expect(window.configurarEstacionamiento(replacement, pair, 20)).toBe(true);
        expect(roads[0].conexionesEstacionamiento.get('0-2').edificio).toBe(replacement);
        expect(roads[1].conexionesEstacionamiento.get('0-3').edificio).toBe(replacement);
    });

    it.each([true, false])('removes stale owned mappings even with parking enabled=%s, preserving other owners', enabled => {
        building.esEstacionamiento = enabled;
        building.conexiones = [];
        building.vehiculosActuales = 4;
        // A direct reference must take precedence over a coincident building ID.
        const other = { id: building.id, label: 'Other' };
        window.edificios.push(other);
        const otherMapping = { edificio: other, edificioId: building.id };
        roads[0].conexionesEstacionamiento = new Map([
            ['0-2', { edificio: building }],
            ['0-5', otherMapping],
        ]);
        roads[1].conexionesEstacionamiento = new Map([
            ['0-3', { edificioId: building.id }],
            ['0-6', { edificioId: 'unrelated' }],
        ]);
        roads[0].arreglo[0][2] = 3;
        roads[1].arreglo[0][3] = 5;
        const cells = roads.map(road => [...road.arreglo[0]]);

        window.eliminarObjetoSeleccionado();

        expect(roads[0].conexionesEstacionamiento.size).toBe(1);
        expect(roads[0].conexionesEstacionamiento.get('0-5')).toBe(otherMapping);
        expect([...roads[1].conexionesEstacionamiento.keys()]).toEqual(['0-6']);
        expect(window.edificios).toEqual([other]);
        expect(building).toMatchObject({ esEstacionamiento: false, conexiones: [], vehiculosActuales: 0 });
        expect(roads.map(road => road.arreglo[0])).toEqual(cells);
    });

    it.each(['cancelled', 'absent'])('leaves parking and visuals unchanged when deletion is %s', outcome => {
        window.configurarEstacionamiento(building, pair, 20);
        building.vehiculosActuales = 7;
        if (outcome === 'cancelled') confirmation.mockReturnValue(false);
        else window.edificios.splice(0, 1);
        const buildings = [...window.edificios];
        const connections = building.conexiones;
        const mappings = roads.map(road => [...road.conexionesEstacionamiento]);
        vi.clearAllMocks();

        window.eliminarObjetoSeleccionado();

        expect(window.edificios).toEqual(buildings);
        expect(window.edificioSeleccionado).toBe(building);
        expect(building.esEstacionamiento).toBe(true);
        expect(building.vehiculosActuales).toBe(7);
        expect(building.conexiones).toBe(connections);
        expect(roads.map(road => [...road.conexionesEstacionamiento])).toEqual(mappings);
        expect(window.renderizarCanvas).not.toHaveBeenCalled();
        expect(scene.edificioRenderer.removeEdificioSprite).not.toHaveBeenCalled();
        expect(scene.conexionRenderer.renderEstacionamientos).not.toHaveBeenCalled();
        expect(scene.renderContadores).not.toHaveBeenCalled();
    });

    it.each([true, false])('refreshes parking graphics and counters (visible=%s) without destroying ordinary links', visible => {
        window.configurarEstacionamiento(building, pair, 20);
        window.mostrarContadores = visible;
        const parkingGraphic = { destroy: vi.fn() };
        const roadGraphic = { destroy: vi.fn() };
        scene.conexionGraphics.set('estacionamiento_deleted', parkingGraphic);
        scene.conexionGraphics.set('road-link', roadGraphic);
        vi.clearAllMocks();

        window.eliminarObjetoSeleccionado();

        expect(parkingGraphic.destroy).toHaveBeenCalledOnce();
        expect(roadGraphic.destroy).not.toHaveBeenCalled();
        expect([...scene.conexionGraphics.keys()]).toEqual(['road-link']);
        expect(scene.conexionRenderer.renderEstacionamientos).toHaveBeenCalledOnce();
        expect(scene.renderContadores).toHaveBeenCalledTimes(visible ? 1 : 0);
        expect(scene.clearContadores).toHaveBeenCalledTimes(visible ? 0 : 1);
        expect(scene.edificioRenderer.removeEdificioSprite).toHaveBeenCalledWith(building);
        expect(window.renderizarCanvas).toHaveBeenCalled();
    });
});
