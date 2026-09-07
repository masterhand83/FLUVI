# Listas de chequeo de la línea base (tráfico y escenario)

Documenta la verificación de comportamiento **antes** de modularizar
`src/js/core/trafico.js` (ver `.scratch/split-trafico-js/spec.md`). Cualquier
cambio observable durante la extracción debe hacer fallar estas pruebas o
obligar a re-grabar la línea base con una explicación en el PR.

> *Racional de la infraestructura:* el spec pide "pruebas de lógica sin DOM
> completo"; el monolito actual ejecuta `getContext('2d')`, `new Image()` y
> listeners de carga en su evaluación inicial y comparte bindings globales
> léxicos entre scripts clásicos, por lo que la menor aproximación fiel es
> Chrome headless (puppeteer-core) con el DOM mínimo que ya trae `index.html`,
> no un jsdom reconstruido. La lógica del motor se ejercita sin intervención
> humana: semilla fija, bucle rAF congelado y pasos disparados por el propio
> botón ⏭ de la interfaz.

## 1. Invariantes del escenario público

Grabadas en [`baseline.json`](./baseline.json) (`pnpm --filter v1
test:baseline:record`, requiere Chrome; `CHROME_PATH` para otra ruta):

| Invariante | Valor registrado |
| --- | --- |
| Calles totales | 85 |
| Calles por tipo | 7 generador · 74 conexión · 4 devorador |
| Calles con curva activa | 16 (lista de nombres en `baseline.json`) |
| Conexiones totales | 203 |
| Conexiones por tipo | 35 lineal · 81 probabilística · 87 incorporación |
| Límites del mapa | x ∈ [-164.84, 3608], y ∈ [-493.43, 2902.62] |
| Celdas (carriles × tamaño) | 8,425 |

## 2. Comportamiento de tráfico determinista

`tests/baseline/baseline.spec.mjs` carga la app real en Chrome headless con
`Math.random` reemplazado por un PRNG sembrado (mulberry32), pausa la
simulación, borra celdas, resiembra con la semilla de pasos y avanza 400 pasos
reales por el botón ⏭. Aserciones: totales de vehículos, distribución por
tipo, conteo por calle, reloj virtual y hash SHA-256 de la ocupación completa.

Semillas grabadas: `loadSeed=1`, `trafficSeed=12345`, `steps=400` → 723
vehículos tras 400 pasos (ver `baseline.json`).

Para re-grabar tras un cambio *intencionado*: `pnpm --filter v1
test:baseline:record` y revisar el diff de `baseline.json`.

## 3. Lista de chequeo manual

Sirve **por entrega** de la initiative de modularización. Modo automático:
`pnpm --filter v1 test:smoke` (Chrome; sin `CHROME_PATH` usa
`/usr/bin/google-chrome`) y deja capturas en `tests/smoke/evidence/`. Última
ejecución automática: **10/10 OK (2026-09-06)**. Modo manual: `pnpm --filter v1
dev` → `http://127.0.0.1:5173`, recorrer los ítems y anotar el resultado.

| # | Área | Pasos manuales | Resultado esperado | Automático |
| --- | --- | --- | --- | --- |
| 1 | Arranque Canvas 2D | `localStorage.setItem('usePixi','false')`, recargar | Pantalla de carga desaparece; mapa con calles/curvas/edificios; tráfico animado | ✅ `01-canvas2d` |
| 2 | Arranque PixiJS | Cleared `usePixi`, recargar | Escena inicial completa tras el fin de la carga (garantía: escenario existe antes del render) | ✅ `02-pixi` |
| 3 | Controles | ⏸ → ⏭ repetido; slider de velocidad; 🎲; ️; 🔗//🏷️ |  se habilita solo en pausa y avanza exactamente un paso; la velocidad cambia el ritmo; 🎲 llena; 🗑️ vacía; toggles repintan | ✅ (ambos motores para pausa/paso/velocidad) |
| 4 | Selección y editor | Ctrl+Clic sobre una calle → 🔒 modo edición → arrastrar handle y vértices de una curva | La calle queda seleccionada y configurable; el handle mueve la calle en tiempo real | ✅ calle arrastrada (vértices: manual) |
| 5 | Constructor | Abrir sección Constructor; dibujar/crear una calle corta y eliminarla | El objeto nuevo aparece en `window.calles` y es usado por el motor al instante | ✅ apertura de panel (flujo completo: manual) |
| 6 | Minimapa | Arrastrar el rectángulo rojo (PixiJS) | La vista se reposiciona | ✅ `pan=true` bajo PixiJS |
| 7 | Minimapa (Canvas 2D) | Ídem con `usePixi=false` | *Comportamiento actual:* el arrastre **no** mueve la vista (defecto, §4) | ✅ defecto fijado |
| 8 | Zoom y paneo | Rueda del ratón; arrastre del lienzo | `window.escala`/offset cambian suavemente | ✅ |
| 9 | Táctil (móvil) | Un dedo arrastra; dos dedos pellizcan (o `Input.dispatchTouchEvent` en escritorio) | Paneo y zoom; debug móvil muestra `TOUCHMOVE OK` / `PINCH` | ✅ pan y pinch 1.10→3.96 |

## 4. Defectos preexistentes observados (no se corrigen en esta iniciativa)

- `trafico.js:4752` y `:4767` (mouseup/mouseleave del canvas) asignan sobre
  `controlandoVertice`/`verticeSeleccionado`, declarados `const` en
  `curvas.js:11-12` → `TypeError: Assignment to constant variable` en cada
  mouseup sobre el canvas; el `renderizarCanvas()` final del handler queda
  saltado. La UI lo disimula porque el bucle de animación repinta igualmente.
- Arrastrar el minimapa en modo fallback Canvas 2D no mueve la vista (ver §3).
- `consoleControl.js` silencia `console.log` del sitio por defecto: las
  pruebas no deben depender de mensajes de consola de la app.
- Cambiar el viewport táctil después de cargar recarga el renderer (Chrome);
  la emulación táctil debe activarse antes de la navegación.
