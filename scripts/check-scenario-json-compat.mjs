// Independent compatibility check: use the unchanged v1 scenario codec.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('apps/v1/src/js/core/escenarios.js', root), 'utf8');
const names = ['crearEscenarioJSON', 'validarEscenario', 'cargarEscenarioDesdeJSON',
    'resultadoEscenarioError', 'lluviaAleatoriaToJSON', 'lluviaAleatoriaFromJSON'];
const functions = names.map(name => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Missing ${name}`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');
const fixture = new URL('crates/ca-core/tests/fixtures/scenario-v1.json', root);
const record = process.argv.includes('--record');
const input = record ? null : JSON.parse(readFileSync(process.argv[2] ?? fixture, 'utf8'));
const result = runInNewContext(`
    const estadoEscenarios = {
        lluviaAleatoria: {activa:true, probabilidad:37},
        celdasBloqueadas: new Map([
            ['Entrada:1:2',{tipo:'inundacion',texture:'inundacion'}],
            ['Salida:0:0',{tipo:'bloqueo',texture:null}],
            ...['bache','trabajador','arbol','cono'].map((texture,i) =>
                ['Salida:0:'+ (i+1),{tipo:'obstaculo',texture}])
        ])
    };
    function tr(key) { return key; }
    function actualizarControlesLluvia() {}
    function limpiarTodosLosBloqueosSilencioso() { estadoEscenarios.celdasBloqueadas.clear(); }
    ${functions}
    const saved = crearEscenarioJSON('Storm','v1 compatibility fixture');
    const loaded = cargarEscenarioDesdeJSON(input ?? saved);
    ({saved, loaded, marks: [...estadoEscenarios.celdasBloqueadas.values()],
      rain: estadoEscenarios.lluviaAleatoria});
`, {
    input, console: { log() {}, error() {}, warn() {} },
    window: { calles: ['Entrada','Salida'].map(nombre => ({
        nombre, tamano:6, carriles:2, arreglo:[Array(6).fill(0),Array(6).fill(0)]
    })) },
    document: { getElementById() { return null; } },
});
assert.equal(result.loaded.exito, true);
assert.equal(result.marks.length, 6);
assert.deepEqual(Array.from(result.marks, mark => mark.tipo).sort(),
    ['bloqueo','inundacion','obstaculo','obstaculo','obstaculo','obstaculo']);
assert.deepEqual(Array.from(result.marks, mark => mark.texture).filter(Boolean).sort(),
    ['arbol','bache','cono','inundacion','trabajador']);
assert.equal(result.rain.activa, false);
assert.equal(result.rain.probabilidad, 37);
if (record) writeFileSync(fixture, JSON.stringify(result.saved, null, 2) + '\n');
console.log('v1 scenario compatibility passed');
