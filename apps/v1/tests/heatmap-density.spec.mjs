import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'

const source = readFileSync(new URL('../src/js/ui/HeatmapModal.js', import.meta.url), 'utf8')

function renderLane(values, geometryType, additionalStreets = []) {
    const cells = []
    const ctx = {
        clearRect() {}, save() {}, restore() {}, scale() {}, rotate() {},
        translate() {},
        fillRect() { cells.push({ color: this.fillStyle, alpha: this.globalAlpha }) }
    }
    const canvas = { getContext: () => ctx }
    const window = {
        calles: [{ arreglo: [values], carriles: 1, tamano: values.length, geometryType }, ...additionalStreets],
        isStreetIncluded: () => false,
        obtenerCoordenadasGlobalesCeldaConCurva: (_street, _lane, i) => ({ x: i * 15, y: 0, angulo: 0 })
    }
    const context = vm.createContext({
        window, console: { log() {} }, performance: { now: () => 0 },
        document: { getElementById: () => null, addEventListener() {} }
    })
    vm.runInContext(source, context)
    window.heatmapModal.render({ canvas, maxWidth: 500, maxHeight: 200 })
    return cells
}

test('vehicle colors represent five-cell lane occupancy, independent of vehicle type', () => {
    // The center window contains 2 vehicles / 5 physical cells = 40%.
    const first = renderLane([0, 1, 1, 0, 0])
    const otherTypes = renderLane([0, 6, 4, 0, 0])
    expect(first[2]).toEqual({ color: 'rgb(255, 233, 0)', alpha: 0.8 })
    expect(otherTypes).toEqual(first)
})

test('roundabout windows wrap while ordinary street windows stop at the endpoint', () => {
    // At cell 0: ordinary street 1/3; roundabout 3/5, including cells 5 and 6.
    const values = [1, 0, 0, 0, 0, 2, 3]
    expect(renderLane(values)[0].color).toBe('rgb(255, 253, 0)')
    expect(renderLane(values, 'roundabout')[0].color).toBe('rgb(255, 173, 0)')
})

test('short roundabouts count each physical cell once', () => {
    // Only 1 of the 3 physical cells contains a vehicle, regardless of center.
    expect(renderLane([1, 0, 0], 'roundabout')[0].color).toBe('rgb(255, 253, 0)')
    expect(renderLane([0, 1, 0], 'roundabout')[1].color).toBe('rgb(255, 253, 0)')
    expect(renderLane([6], 'roundabout')[0].color).toBe('rgb(255, 0, 0)')
})

test('empty and obstacle cells remain neutral; obstacles are not vehicles but occupy denominator cells', () => {
    const cells = renderLane([7, 1, 6, 0, 7])
    expect(cells[2]).toEqual({ color: 'rgb(255, 233, 0)', alpha: 0.8 })
    for (const index of [0, 3, 4]) {
        expect(cells[index]).toEqual({ color: 'rgb(224, 224, 224)', alpha: 0.2 })
    }
    expect(renderLane([0, 7, 0]).every(cell => cell.color === 'rgb(224, 224, 224)')).toBe(true)
})

test('density stays lane-local and renders every street regardless of metric selection', () => {
    const cells = renderLane([1, 0, 0, 0, 0], undefined, [{
        arreglo: [[1, 1, 1, 1, 1], [0, 0, 6, 0, 0]], carriles: 2, tamano: 5,
        laneDirections: [1, -1]
    }])
    expect(cells).toHaveLength(15)
    expect(cells[7].color).toBe('rgb(255, 0, 0)')
    // The neighboring full lane must not increase this lane's 1/5 occupancy.
    expect(cells[12].color).toBe('rgb(154, 255, 0)')
})
