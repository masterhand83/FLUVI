import { readFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { findChrome } from './helpers/simulator.mjs'

let browser
let page
const root = new URL('../', import.meta.url)

beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: findChrome(), headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] })
})
afterAll(async () => { await browser?.close() })
beforeEach(async () => {
    await page?.close()
    page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const html = await readFile(new URL('index.html', root), 'utf8')
    const modal = html.slice(html.indexOf('  <!-- Modal: Analizador de Métricas -->'), html.indexOf('</body>'))
    await page.setContent(`<button id="btnAnalizarMetricas">Analyze</button>${modal}`)
    await page.addStyleTag({ path: new URL('src/bootstrap-5.0.2-dist/css/bootstrap.min.css', root).pathname })
    await page.addScriptTag({ path: new URL('src/bootstrap-5.0.2-dist/js/bootstrap.bundle.min.js', root).pathname })
    await page.evaluate(() => {
        window.alert = () => {}
        window.testJobs = []
        window.destroyedJobs = []
        window.testLoads = 0
        window.loadPyodide = async () => {
            window.testLoads++
            return {
                loadPackage: async () => {},
                runPythonAsync: async code => {
                    if (!code.includes("resultados['imagenes']")) return
                    return new Promise((resolve, reject) => window.testJobs.push({ code, resolve, reject }))
                },
            }
        }
        window.fetch = async () => ({ ok: true, text: async () => '# analyzer' })
        window.finishJob = (index, label) => {
            window.testJobs[index].resolve({
                toJs: () => new Map(['temporal', 'fundamentales', 'distribuciones']
                    .map(key => [key, `data:image/png;base64,${btoa(`${label}:${key}`)}`])),
                destroy: () => window.destroyedJobs.push(index),
            })
        }
    })
    await page.addScriptTag({ path: new URL('src/js/ui/analizadorMetricas.js', root).pathname })
    await page.click('#btnAnalizarMetricas')
    await page.waitForSelector('#modalAnalizadorMetricas.show')
    await page.waitForFunction(() => !bootstrap.Modal.getInstance(document.getElementById('modalAnalizadorMetricas'))._isTransitioning)
})

async function upload(name, content) {
    await page.evaluate(([name, content]) => {
        const input = document.getElementById('inputCSVAnalizador')
        const files = new DataTransfer()
        files.items.add(new File([content], name))
        input.files = files.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
    }, [name, content])
}

async function ready(index = 0, label = 'A') {
    await page.waitForFunction(count => window.testJobs.length > count, {}, index)
    await page.evaluate(([index, label]) => window.finishJob(index, label), [index, label])
    await page.waitForFunction(() => document.getElementById('resultadosAnalisis').style.display === 'block')
}

test('tabs remain mutually exclusive across repeated cycles', async () => {
    await upload('a.csv', 'A')
    await ready()
    for (let cycle = 0; cycle < 3; cycle++) {
        for (const tab of ['fundamental', 'distribuciones', 'temporal']) {
            await page.click(`#tab-${tab}`)
            await page.waitForFunction(tab => document.getElementById(`img-${tab}`).classList.contains('show'), {}, tab)
            const active = await page.evaluate(() => ({
                tabs: [...document.querySelectorAll('#tabsImagenes .active')].map(el => el.id),
                panels: [...document.querySelectorAll('#tabsImagenesContent .active')].map(el => el.id),
            }))
            expect(active).toEqual({ tabs: [`tab-${tab}`], panels: [`img-${tab}`] })
        }
    }
})

test('closing clears results and reopening preserves only the Python runtime', async () => {
    await upload('a.csv', 'A')
    await ready()
    await page.click('#tab-distribuciones')
    await page.click('#modalAnalizadorMetricas .modal-footer button')
    await page.waitForFunction(() => !document.getElementById('modalAnalizadorMetricas').classList.contains('show'))
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'))
    await page.click('#btnAnalizarMetricas')
    const state = await page.evaluate(() => ({
        file: document.getElementById('inputCSVAnalizador').value,
        name: document.getElementById('nombreArchivoCSV').textContent.trim(),
        results: document.getElementById('resultadosAnalisis').style.display,
        images: [...document.querySelectorAll('#tabsImagenesContent img')].map(img => img.getAttribute('src')),
        tab: document.querySelector('#tabsImagenes .active').id,
        status: document.getElementById('estadoCargaPython').style.display,
        progress: document.getElementById('progressBarPython').style.width,
        downloadsDisabled: [...document.querySelectorAll('#resultadosAnalisis button[id^="btnDescargar"]')].every(button => button.disabled),
    }))
    expect(state).toEqual({ file: '', name: 'Ningún archivo seleccionado (CSV o JSON de métricas)',
        results: 'none', images: ['', '', ''], tab: 'tab-temporal', status: 'none', progress: '0%', downloadsDisabled: true })
    await upload('b.json', '{"B":true}')
    await ready(1, 'B')
    expect(await page.evaluate(() => window.testLoads)).toBe(1)
})

test('replacement hides old results immediately and failure cannot restore them', async () => {
    await upload('a.csv', 'A')
    await ready()
    await upload('b.json', '{"B":true}')
    await page.waitForFunction(() => window.testJobs.length === 2)
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
    expect(await page.$eval('#imgAnalisisTemporal', el => el.getAttribute('src'))).toBe('')
    expect(await page.evaluate(() => window.destroyedJobs)).toEqual([0])
    await page.evaluate(() => window.testJobs[1].reject(new Error('Invalid B')))
    await page.waitForFunction(() => document.getElementById('estadoCargaPython').classList.contains('alert-danger'))
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
})

test('closing during analysis prevents late results from repopulating a new session', async () => {
    await upload('a.csv', 'A')
    await page.waitForFunction(() => window.testJobs.length === 1)
    await page.click('#modalAnalizadorMetricas .modal-footer button')
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'))
    await page.click('#btnAnalizarMetricas')
    await page.evaluate(() => window.finishJob(0, 'A'))
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
    expect(await page.$eval('#imgAnalisisTemporal', el => el.getAttribute('src'))).toBe('')
})

test('overlapping uploads are serialized and publish only the latest immutable file snapshot', async () => {
    await upload('a.csv', 'CSV_A')
    await page.waitForFunction(() => window.testJobs.length === 1)
    await upload('b.json', '{"JSON_B":true}')
    await page.waitForFunction(() => currentFileContent === '{"JSON_B":true}')
    expect(await page.evaluate(() => window.testJobs.length)).toBe(1)
    await page.evaluate(() => window.finishJob(0, 'A'))
    await page.waitForFunction(() => window.testJobs.length === 2)
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
    const codes = await page.evaluate(() => window.testJobs.map(job => job.code))
    expect(codes[0]).toContain('CSV_A')
    expect(codes[0]).toContain("tipo='csv'")
    expect(codes[1]).toContain('JSON_B')
    expect(codes[1]).toContain("tipo='json'")
    await ready(1, 'B')
    expect(await page.$eval('#imgAnalisisTemporal', el => el.getAttribute('src')))
        .toBe(`data:image/png;base64,${Buffer.from('B:temporal').toString('base64')}`)
    expect(await page.evaluate(() => window.destroyedJobs)).toEqual([0, 1])
})

test('uploads share initialization and a failed initialization can be retried', async () => {
    await page.evaluate(() => {
        const load = window.loadPyodide
        window.loadPyodide = () => new Promise(resolve => { window.releaseLoad = async () => resolve(await load()) })
    })
    await upload('a.csv', 'A')
    await page.waitForFunction(() => typeof window.releaseLoad === 'function')
    await upload('b.json', '{"B":true}')
    await page.waitForFunction(() => currentFileType === 'json' && currentFileContent === '{"B":true}')
    await page.evaluate(() => window.releaseLoad())
    await ready(0, 'B')
    expect(await page.evaluate(() => window.testLoads)).toBe(1)
    expect(await page.evaluate(() => window.testJobs[0].code)).toContain("tipo='json'")

    await page.evaluate(() => {
        pyodideInitialized = false
        window.loadPyodide = async () => pyodideInstance
        window.fetch = async () => ({ ok: false })
    })
    await upload('c.csv', 'C')
    await page.waitForFunction(() => document.getElementById('estadoCargaPython').classList.contains('alert-danger'))
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
    await page.evaluate(() => {
        window.loadPyodide = async () => pyodideInstance
        window.fetch = async () => ({ ok: true, text: async () => '# analyzer' })
    })
    await upload('c.csv', 'C')
    await ready(1, 'C')
})

test('current-image download follows the active tab and fallback downloads cannot cross sessions', async () => {
    await upload('a.csv', 'A')
    await ready()
    await page.evaluate(() => {
        window.downloads = []
        HTMLAnchorElement.prototype.click = function () { window.downloads.push({ href: this.href, name: this.download }) }
    })
    await page.click('#tab-fundamental')
    await page.waitForFunction(() => document.getElementById('img-fundamental').classList.contains('show'))
    await page.click('#btnDescargarImagenActual')
    expect(await page.evaluate(() => window.downloads)).toEqual([{
        href: `data:image/png;base64,${Buffer.from('A:fundamentales').toString('base64')}`,
        name: 'diagrama_fundamental.png',
    }])
    await page.click('#btnDescargarTodasImagenes')
    await upload('b.csv', 'B')
    await ready(1, 'B')
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(await page.evaluate(() => window.downloads.length)).toBe(2)
    expect(await page.$eval('#btnDescargarTodasImagenes', el => el.disabled)).toBe(false)
})

test('ZIP uses current results and does not download after its session is replaced', async () => {
    await upload('a.csv', 'A')
    await ready()
    await page.evaluate(() => {
        window.zipFiles = []
        window.downloads = []
        HTMLAnchorElement.prototype.click = function () { window.downloads.push(this.download) }
        window.fetch = async url => ({ blob: async () => new Blob([atob(url.split(',')[1])]) })
        window.JSZip = class {
            folder(name) { window.zipFolder = name; return this }
            file(name, blob) { window.zipFiles.push({ name, blob }) }
            generateAsync() { return new Promise(resolve => { window.finishZip = () => resolve(new Blob(['zip'])) }) }
        }
    })
    await page.click('#btnDescargarTodasImagenes')
    await page.waitForFunction(() => typeof window.finishZip === 'function')
    const contents = await page.evaluate(async () => Promise.all(window.zipFiles.map(async ({ name, blob }) => ({ name, text: await blob.text() }))))
    expect(contents).toEqual([
        { name: 'analisis_temporal.png', text: 'A:temporal' },
        { name: 'diagrama_fundamental.png', text: 'A:fundamentales' },
        { name: 'distribuciones_correlaciones.png', text: 'A:distribuciones' },
    ])
    await page.evaluate(() => window.finishZip())
    await page.waitForFunction(() => window.downloads.length === 1)
    expect(await page.evaluate(() => window.downloads)).toEqual(['analisis_metricas.zip'])
    await page.click('#btnDescargarTodasImagenes')
    await page.waitForFunction(() => window.zipFiles.length === 6)
    await upload('b.csv', 'B')
    await page.evaluate(() => window.finishZip())
    expect(await page.evaluate(() => window.downloads.length)).toBe(1)
})

test('a delayed FileReader callback cannot overwrite a newer upload', async () => {
    await page.evaluate(() => {
        const Reader = window.FileReader
        window.FileReader = class {
            readAsText() { window.finishRead = () => this.onload({ target: { result: 'OLD_CSV' } }); window.FileReader = Reader }
        }
    })
    await upload('a.csv', 'A')
    await page.waitForFunction(() => typeof window.finishRead === 'function')
    await upload('b.json', '{"NEW_JSON":true}')
    await ready(0, 'B')
    await page.evaluate(() => window.finishRead())
    expect(await page.evaluate(() => window.testJobs.length)).toBe(1)
    expect(await page.evaluate(() => currentFileContent)).toBe('{"NEW_JSON":true}')
})

test('a rejected Python job does not block a replacement or preserve old results', async () => {
    await upload('a.csv', 'A')
    await page.waitForFunction(() => window.testJobs.length === 1)
    await upload('b.csv', 'B')
    await page.waitForFunction(() => currentFileContent === 'B')
    await page.evaluate(() => window.testJobs[0].reject(new Error('Stale A failure')))
    await ready(1, 'B')
    expect(await page.$eval('#estadoCargaPython', el => el.classList.contains('alert-danger'))).toBe(false)
    expect(await page.$eval('#imgAnalisisTemporal', el => el.getAttribute('src')))
        .toBe(`data:image/png;base64,${Buffer.from('B:temporal').toString('base64')}`)
})

test('closing during initialization keeps the runtime but never starts the old analysis', async () => {
    await page.evaluate(() => {
        const load = window.loadPyodide
        window.loadPyodide = () => new Promise(resolve => { window.releaseLoad = async () => resolve(await load()) })
    })
    await upload('a.csv', 'A')
    await page.waitForFunction(() => typeof window.releaseLoad === 'function')
    await page.click('#modalAnalizadorMetricas .modal-footer button')
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'))
    await page.evaluate(() => window.releaseLoad())
    await page.waitForFunction(() => pyodideInitialized)
    expect(await page.evaluate(() => window.testJobs.length)).toBe(0)
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
    await page.click('#btnAnalizarMetricas')
    await upload('b.json', '{"B":true}')
    await ready(0, 'B')
    expect(await page.evaluate(() => window.testLoads)).toBe(1)
})

test('empty replacement clears previous results and permits selecting the same file again', async () => {
    await upload('a.csv', 'A')
    await ready()
    await upload('b.csv', '')
    await page.waitForFunction(() => document.getElementById('estadoCargaPython').classList.contains('alert-danger'))
    expect(await page.$eval('#resultadosAnalisis', el => el.style.display)).toBe('none')
    expect(await page.$eval('#inputCSVAnalizador', el => el.value)).toBe('')
    expect(await page.$eval('#btnDescargarImagenActual', el => el.disabled)).toBe(true)
    await upload('b.csv', 'B')
    await ready(1, 'B')
})
