import { describe, it, expect } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

describe('editable linear enlace lane pairs', () => {
    for (const usePixi of [false, true]) {
        it(`chooses, adds, removes and edits directed lane pairs (${usePixi ? 'Pixi' : 'Canvas'})`, async () => {
            const sim = await openSimulator({ usePixi, freezeFrames: false })
            const { page } = sim
            const row = '#linkMappingRows [data-testid="link-mapping-row"]'
            const set = async (key, value, index = 0) => page.$$eval(row, (rows, key, value, index) => {
                const input = rows[index].querySelector(`[data-testid="${key}"]`)
                input.value = value
                input.dispatchEvent(new Event('input', { bubbles: true }))
            }, key, String(value), index)
            try {
                if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager)
                await page.evaluate(() => {
                    document.getElementById('loadingScreen').style.display = 'none'
                    window.streetEditPause?.()
                    const s = window.crearCalle('Lane pair source', 6, window.TIPOS.CONEXION, -600, -600, 0, 0, 3, 0)
                    const d = window.crearCalle('Lane pair target', 6, window.TIPOS.CONEXION, -600, -300, 0, 0, 2, 0)
                    s.laneDirections = [1, -1, 1]
                    d.laneDirections = [1, -1]
                })
                const count = await page.evaluate(() => window.conexiones.length)
                const open = async () => {
                    await page.click('#createLinkButton')
                    await page.select('#linkSourceStreet', 'Lane pair source')
                    await page.select('#linkDestinationStreet', 'Lane pair target')
                }
                await open()
                await set('source-lane', 2)
                await set('destination-lane', 1)
                await page.click('#linkAddExit')
                expect(await page.$$eval(row, rows => rows.length)).toBe(3)
                await page.$$eval(row, rows => rows[1].querySelector('button').click())
                expect(await page.$$eval(row, rows => rows.length)).toBe(2)
                expect(await page.evaluate(() => window.conexiones.length)).toBe(count)
                await page.click('#linkSaveButton')
                expect(await page.evaluate(() => window.conexiones.slice(-2).map(l => [l.carrilOrigen, l.posOrigen, l.carrilDestino, l.posDestino]))).toEqual([[2, 5, 1, 5], [0, 5, 0, 0]])
                expect(await page.evaluate(() => {
                    const l = window.conexiones.at(-2)
                    l.origen.arreglo[2][5] = 1
                    return [l.transferir(), l.origen.arreglo[2][5], l.destino.arreglo[1][5]]
                })).toEqual([true, 0, 1])
                await page.evaluate(() => window.createLinkTool.edit(window.conexiones.at(-2)))
                await set('source-lane', 1)
                await set('destination-lane', 0)
                await page.click('#linkSaveButton')
                expect(await page.evaluate(() => {
                    const l = window.conexiones.at(-2)
                    return [l.carrilOrigen, l.posOrigen, l.carrilDestino, l.posDestino, l.origen.conexionesSalida[2].includes(l), l.origen.conexionesSalida[1].includes(l)]
                })).toEqual([1, 0, 0, 0, false, true])
                await page.evaluate(() => window.createLinkTool.edit(window.conexiones.at(-2)))
                await set('destination-lane', 1)
                await page.click('#linkCancelButton')
                expect(await page.evaluate(() => window.conexiones.at(-2).carrilDestino)).toBe(0)
                await open()
                await set('source-lane', 2)
                await set('destination-lane', 0)
                await set('source-lane', 2, 1)
                await set('destination-lane', 0, 1)
                await page.click('#linkSaveButton')
                expect(await page.$eval('#linkDraftMessage', el => el.textContent)).toMatch(/idéntica/)
                expect(await page.evaluate(() => window.conexiones.length)).toBe(count + 2)
                await page.click('#linkCancelButton')
                await open()
                await set('source-lane', 1)
                await set('destination-lane', 0)
                await page.click('#linkSaveButton')
                expect(await page.$eval('#linkDraftMessage', el => el.textContent)).toMatch(/idéntica/)
                expect(await page.evaluate(() => window.conexiones.length)).toBe(count + 2)
                await set('source-lane', 99)
                await page.click('#linkSaveButton')
                expect(await page.$eval('#linkDraftMessage', el => el.textContent)).toMatch(/fuera de rango/)
                await page.click('#linkCancelButton')
                await open()
                await page.$$eval(row, rows => rows[0].querySelector('button').click())
                await page.$$eval(row, rows => rows[0].querySelector('button').click())
                await page.click('#linkSaveButton')
                expect(await page.$eval('#linkDraftMessage', el => el.textContent)).toMatch(/al menos/)
                await page.click('#linkCancelButton')
                expect(await page.evaluate(() => window.conexiones.length)).toBe(count + 2)
            } finally {
                await sim.close()
            }
        }, 60000)
    }
})
