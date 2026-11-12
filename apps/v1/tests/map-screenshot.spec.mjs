import { afterAll, beforeAll, expect, test } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

const simulators = []

beforeAll(async () => {
    simulators.push(await openSimulator({ usePixi: false }))
    simulators.push(await openSimulator({ usePixi: true }))
}, 120000)

afterAll(async () => {
    for (const simulator of simulators) await simulator?.close()
})

test.each([
    ['Canvas 2D', 0],
    ['PixiJS', 1],
])('captures the whole map cropped to streets, buildings and reference image from %s', async (_, index) => {
    const simulator = simulators[index]
    const result = await simulator.page.evaluate(async () => {
        const button = document.getElementById('btnCapturaPantalla')
        const label = button.textContent.trim()

        const before = { escala: window.escala, offsetX: window.offsetX, offsetY: window.offsetY }
        const bounds = window.mapScreenshot.bounds({ padding: 12 })
        const canvas = window.mapScreenshot.capture()
        const after = { escala: window.escala, offsetX: window.offsetX, offsetY: window.offsetY }
        const pixiCamera = window.pixiApp?.cameraController
            ? { escala: window.pixiApp.cameraController.scale, offsetX: window.pixiApp.cameraController.offsetX, offsetY: window.pixiApp.cameraController.offsetY }
            : null

        const context = canvas.getContext('2d')
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        const corner = [pixels[0], pixels[1], pixels[2], pixels[3]]
        let colored = 0
        for (let i = 0; i < pixels.length; i += 4) {
            if (Math.abs(pixels[i] - corner[0]) > 12 ||
                Math.abs(pixels[i + 1] - corner[1]) > 12 ||
                Math.abs(pixels[i + 2] - corner[2]) > 12) colored++
        }

        const originalCreate = URL.createObjectURL
        const originalClick = HTMLAnchorElement.prototype.click
        let blob
        let downloaded = null
        URL.createObjectURL = value => { blob = value; return originalCreate(value) }
        HTMLAnchorElement.prototype.click = function () { downloaded = this.download }
        try {
            const exported = await window.mapScreenshot.download()
            const bitmap = await createImageBitmap(blob)
            const image = { width: bitmap.width, height: bitmap.height }
            bitmap.close()
            return {
                label,
                bounds,
                canvas: { width: canvas.width, height: canvas.height, colored },
                before,
                after,
                pixiCamera,
                exported: {
                    fileName: exported.fileName,
                    downloaded,
                    type: blob.type,
                    image
                }
            }
        } finally {
            URL.createObjectURL = originalCreate
            HTMLAnchorElement.prototype.click = originalClick
        }
    })

    expect(simulator.consoleErrors, simulator.consoleErrors.join('\n')).toEqual([])
    expect(result.label).toBe('📸 Captura de pantalla')
    expect(result.bounds).not.toBeNull()
    const mapAspect = (result.bounds.maxX - result.bounds.minX) / (result.bounds.maxY - result.bounds.minY)
    expect(result.canvas.width / result.canvas.height).toBeCloseTo(mapAspect, 1)
    expect(Math.max(result.canvas.width, result.canvas.height)).toBeLessThanOrEqual(2400)
    expect(result.canvas.colored).toBeGreaterThan(1000)
    expect(result.after).toEqual(result.before)
    if (result.pixiCamera) expect(result.pixiCamera).toEqual(result.before)
    expect(result.exported.fileName).toMatch(/^captura_pantalla_.*\.png$/)
    expect(result.exported.downloaded).toBe(result.exported.fileName)
    expect(result.exported.type).toBe('image/png')
    expect(result.exported.image).toEqual({ width: result.canvas.width, height: result.canvas.height })
}, 60000)

test.each([
    ['Canvas 2D', 0],
    ['PixiJS', 1],
])('blends a translucent reference image against the map background in %s', async (_, index) => {
    const simulator = simulators[index]
    const result = await simulator.page.evaluate(async () => {
        const source = document.createElement('canvas')
        source.width = 400
        source.height = 300
        const sourceContext = source.getContext('2d')
        sourceContext.fillStyle = '#ff0000'
        sourceContext.fillRect(0, 0, source.width, source.height)
        try {
            await window.setReferenceImage(source.toDataURL('image/png'))
            const reference = window.referenceImage
            reference.rotation = 0
            reference.opacity = 0.5
            reference.width = 300
            reference.height = 200
            reference.x = 700
            reference.y = -600
            const bounds = window.mapScreenshot.bounds({ padding: 0 })
            const shot = window.mapScreenshot.capture()
            const scale = Math.min(2400 / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY), 8)
            const context = shot.getContext('2d')
            const sample = (x, y) => [...context.getImageData(Math.round(x), Math.round(y), 1, 1).data]
            return {
                pixel: sample((reference.x + reference.width / 2 - bounds.minX) * scale,
                    (reference.y + reference.height / 2 - bounds.minY) * scale),
                background: sample(10, 10)
            }
        } finally {
            await window.setReferenceImage(null)
        }
    })

    const [red, green, blue, alpha] = result.pixel
    const [bgRed, bgGreen, bgBlue, bgAlpha] = result.background
    // Reference is opaque red at 50% opacity; it must darken the map
    // background by half instead of compositing against transparent black.
    expect(Math.abs(red - (255 * 0.5 + bgRed * 0.5))).toBeLessThanOrEqual(2)
    expect(Math.abs(green - bgGreen * 0.5)).toBeLessThanOrEqual(2)
    expect(Math.abs(blue - bgBlue * 0.5)).toBeLessThanOrEqual(2)
    expect(alpha).toBe(255)
    expect(bgAlpha).toBe(255)
})

test('the screenshot button downloads a PNG and reports success', async () => {
    const simulator = simulators[0]
    const result = await simulator.page.evaluate(async () => {
        const button = document.getElementById('btnCapturaPantalla')
        const originalCreate = URL.createObjectURL
        const originalClick = HTMLAnchorElement.prototype.click
        let blob
        let downloadName = null
        URL.createObjectURL = value => { blob = value; return originalCreate(value) }
        HTMLAnchorElement.prototype.click = function () { downloadName = this.download }
        try {
            button.click()
            while (button.disabled) await new Promise(resolve => setTimeout(resolve, 10))
            await new Promise(resolve => setTimeout(resolve, 50))
        } finally {
            URL.createObjectURL = originalCreate
            HTMLAnchorElement.prototype.click = originalClick
        }
        const bitmap = await createImageBitmap(blob)
        const toast = [...document.querySelectorAll('.toast .toast-body')].at(-1)
        return {
            type: blob.type,
            downloadName,
            image: { width: bitmap.width, height: bitmap.height },
            toast: toast?.textContent || '',
            expected: tr('notifications.map.screenshotSaved', { file: downloadName })
        }
    })

    expect(result.type).toBe('image/png')
    expect(result.downloadName).toMatch(/^captura_pantalla_.*\.png$/)
    expect(result.image.width).toBeGreaterThan(0)
    expect(result.image.height).toBeGreaterThan(0)
    expect(result.toast).toBe(result.expected)
})

test('bounds include buildings and only visible reference images', async () => {
    const simulator = simulators[0]
    const result = await simulator.page.evaluate(() => {
        const previousBuildings = window.edificios
        const previousReference = window.referenceImage
        try {
            const base = window.mapScreenshot.bounds({ padding: 0 })

            window.edificios = [...previousBuildings, { x: -100000, y: -100000, width: 200, height: 100, angle: 30 }]
            const withBuilding = window.mapScreenshot.bounds({ padding: 0 })

            window.edificios = previousBuildings
            window.referenceImage = { x: 100000, y: 100000, width: 300, height: 150, rotation: 45, visible: true }
            const withReference = window.mapScreenshot.bounds({ padding: 0 })

            window.referenceImage = { x: 100000, y: 100000, width: 300, height: 150, rotation: 45, visible: false }
            const hiddenReference = window.mapScreenshot.bounds({ padding: 0 })

            return { base, withBuilding, withReference, hiddenReference }
        } finally {
            window.edificios = previousBuildings
            window.referenceImage = previousReference
        }
    })

    expect(result.withBuilding.minX).toBeLessThan(-99999)
    expect(result.withBuilding.minY).toBeLessThan(-99999)
    expect(result.withReference.maxX).toBeGreaterThan(100000)
    expect(result.withReference.maxY).toBeGreaterThan(100000)
    expect(result.hiddenReference.maxX).toBe(result.base.maxX)
    expect(result.hiddenReference.maxY).toBe(result.base.maxY)
})
