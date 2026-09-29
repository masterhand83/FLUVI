import { afterAll, beforeAll, expect, it } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

let sim
beforeAll(async () => { sim = await openSimulator({ usePixi: false, freezeFrames: true }) }, 180000)
afterAll(async () => sim?.close())

it('keeps roundabout dimensions derived, clockwise, and remaps existing indexes by angle', async () => {
    const result = await sim.page.evaluate(() => {
        const street = window.crearCalle('Roundabout UI test', 26, window.TIPOS.CONEXION, 300, 300, 0, 0, 1, 0.02)
        Object.assign(street, { geometryType: 'roundabout', innerRadius: 18, startAngle: 0, esCurva: false, vertices: [] })
        const initial = window.roundaboutStreet.validate(street)
        window.editorCalles.aplicarNuevasDimensiones(street, initial.cells, 1)
        street.arreglo[0][3] = 2
        const target = window.calles.find(c => c !== street)
        const link = { origen: street, destino: target, carrilOrigen: 0, posOrigen: 3, carrilDestino: 0, posDestino: 0, tipo: 'lineal' }
        window.conexiones.push(link)
        street.conexionesSalida[0].push(link)
        window.calleSeleccionada = street
        document.dispatchEvent(new CustomEvent('street-drawn', { detail: { calle: street } }))
        const radius = document.getElementById('streetInspectorRadius')
        const before = street.tamano
        const readonly = document.getElementById('streetInspectorCells').readOnly
        const fixed = document.querySelector('#streetInspectorLaneDirections button').disabled
        radius.value = '30'
        radius.dispatchEvent(new Event('blur'))
        const mapped = Math.round((3.5 * street.tamano / before) - 0.5 + street.tamano) % street.tamano
        const resized = street.innerRadius === 30 && street.tamano === window.roundaboutStreet.validate(street).cells && street.arreglo[0][mapped] === 2 && link.posOrigen === mapped
        radius.value = '-1'
        radius.dispatchEvent(new Event('blur'))
        return { readonly, fixed, resized, invalidRejected: street.innerRadius === 30, error: document.getElementById('streetInspectorError').textContent }
    })
    expect(result).toMatchObject({ readonly: true, fixed: true, resized: true, invalidRejected: true })
    expect(result.error).toBeTruthy()
    expect(sim.pageErrors).toEqual([])
}, 180000)

it('round-trips circular geometry and ignores malformed roundabouts without shifting link indexes', async () => {
    const saved = await sim.page.evaluate(async () => {
        const oldPrompt = window.prompt, oldCreate = URL.createObjectURL
        let blob
        window.prompt = () => 'roundabout round trip'
        URL.createObjectURL = value => { blob = value; return oldCreate.call(URL, value) }
        try { window.guardarSimulacion(); return JSON.parse(await blob.text()) }
        finally { window.prompt = oldPrompt; URL.createObjectURL = oldCreate }
    })
    const original = saved.calles.find(street => street.nombre === 'Roundabout UI test')
    expect(original).toMatchObject({ geometryType: 'roundabout', innerRadius: 30, startAngle: 0, carriles: 1 })
    expect(saved.conexiones.some(link => link.origenIdx === saved.calles.indexOf(original))).toBe(true)
    const invalid = { ...original, nombre: 'Invalid ring', innerRadius: -10 }
    const index = saved.calles.findIndex(street => street.nombre === 'Roundabout UI test')
    saved.calles.splice(index, 0, invalid)
    for (const link of saved.conexiones) {
        if (link.origenIdx >= index) link.origenIdx++
        if (link.destinoIdx >= index) link.destinoIdx++
    }
    await sim.page.evaluate(payload => {
        window.__beforeRoundaboutLoad = window.calles.find(street => street.nombre === 'Roundabout UI test')
        window.__oldRoundaboutConfirm = window.confirm
        window.confirm = () => true
        window.cargarSimulacion({ target: { files: [new File([JSON.stringify(payload)], 'roundabout.json')], value: '' } })
    }, saved)
    await sim.page.waitForFunction(() => window.calles.some(street =>
        street.nombre === 'Roundabout UI test' && street !== window.__beforeRoundaboutLoad))
    await sim.page.waitForFunction(() => window.conexiones.some(link => link.origen?.nombre === 'Roundabout UI test'), { timeout: 10000 })
    const restored = await sim.page.evaluate(() => {
        window.confirm = window.__oldRoundaboutConfirm
        const street = window.calles.find(item => item.nombre === 'Roundabout UI test')
        return {
            geometryType: street.geometryType, radius: street.innerRadius, cells: street.tamano,
            expectedCells: window.roundaboutStreet.validate(street).cells,
            directions: street.laneDirections,
            invalidExists: window.calles.some(item => item.nombre === 'Invalid ring'),
            sourceLinked: window.conexiones.some(link => link.origen === street),
        }
    })
    expect(restored).toMatchObject({ geometryType: 'roundabout', radius: 30, invalidExists: false, sourceLinked: true })
    expect(restored.cells).toBe(restored.expectedCells)
    expect(restored.directions).toEqual([1])
}, 180000)
