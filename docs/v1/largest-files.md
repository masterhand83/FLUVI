# Largest v1 application files

Counted on 2026-09-23. Scope: hand-authored code and markup under `apps/v1/` (`.js`, `.mjs`, `.css`, `.html`, `.py`, `.bat`); includes test code. Count is the number of **nonempty lines after trimming whitespace** (comments and markup count; whitespace-only lines do not). Excluded generated/dependency trees `.turbo/`, `dist/`, `node_modules/`, vendored `src/bootstrap-5.0.2-dist/` and `src/libs/`, binary assets, smoke evidence, and the non-code `estilos.css.txt` copy. Physical line counts are provided to orient source ranges in [the application map](application-map.md).

| Rank | File (relative to `apps/v1/`) | Nonblank lines | Physical lines |
| ---: | --- | ---: | ---: |
| 1 | `src/js/core/trafico.js` | 4,687 | 5,433 |
| 2 | `src/js/ui/constructor.js` | 2,419 | 2,906 |
| 3 | `src/css/estilos.css` | 2,417 | 2,893 |
| 4 | `index.html` | 2,398 | 2,632 |
| 5 | `src/js/core/graficas.js` | 1,501 | 1,662 |
| 6 | `src/js/ui/editor.js` | 1,284 | 1,546 |
| 7 | `src/js/renderer/renderers/CalleRenderer.js` | 1,078 | 1,317 |
| 8 | `src/js/core/escenarios.js` | 815 | 950 |
| 9 | `src/js/renderer/renderers/EditorHandles.js` | 778 | 950 |
| 10 | `src/js/core/tiempo.js` | 547 | 619 |
| 11 | `src/python/analizador.py` | 520 | 639 |
| 12 | `src/js/ui/edificioUI.js` | 443 | 526 |
| 13 | `src/js/ui/gestionEscenarios.js` | 434 | 518 |
| 14 | `src/js/renderer/renderers/EdificioRenderer.js` | 429 | 522 |
| 15 | `src/js/renderer/renderers/UIRenderer.js` | 378 | 458 |
| 16 | `src/js/ui/infoBar.js` | 363 | 421 |
| 17 | `src/js/renderer/SceneManager.js` | 351 | 418 |
| 18 | `tests/smoke/smoke.mjs` | 310 | 333 |
| 19 | `src/js/ui/analizadorMetricas.js` | 308 | 371 |
| 20 | `src/js/ui/multiplicadoresUI.js` | 285 | 327 |

Recompute from the repository root:

```sh
python3 - <<'PY'
from pathlib import Path
root = Path('apps/v1')
excluded = {'node_modules', 'dist', '.turbo', 'bootstrap-5.0.2-dist', 'libs', 'evidence'}
rows = []
for file in root.rglob('*'):
    if not file.is_file() or excluded.intersection(file.parts) or file.suffix not in {'.js', '.mjs', '.css', '.html', '.py', '.bat'}:
        continue
    lines = file.read_text(errors='replace').splitlines()
    rows.append((sum(bool(line.strip()) for line in lines), len(lines), file))
for rank, (count, physical, file) in enumerate(sorted(rows, key=lambda row: (-row[0], str(row[2])))[:20], 1):
    print(f'{rank:2}. {count:5} {physical:5} {file}')
PY
```
