"""Record the unchanged v1 Python analyzer as the native analyzer oracle.

Run: uv run --with pandas==2.3.3 --with scipy==1.16.3 \
  --with matplotlib==3.10.7 python scripts/generate-analyzer-fixtures.py
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path

os.environ["MPLBACKEND"] = "Agg"
root = Path(__file__).resolve().parents[1]
target = root / "crates/ca-analysis/tests/fixtures"
target.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location(
    "legacy", root / "apps/v1/src/python/analizador.py"
)
legacy = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(legacy)

# All five states, equal peaks, midnight, signed generation, quantiles,
# and rounding ties.
metrics = {key: [] for key in [
    "timestamps", "density", "throughput", "netGeneration", "speed", "entropy"
]}
for i in range(160):
    second = (86340 + i * 30) % 86400
    metrics["timestamps"].append(
        f"{second // 3600:02}:{second // 60 % 60:02}:{second % 60:02}"
    )
    metrics["density"].append([10, 40, 45, 70, 90, 2, 0.5, 1, 1.5, 3][i % 10])
    metrics["throughput"].append([0.5, 2, 3, 1, 0.2][i % 5])
    metrics["netGeneration"].append((i % 17 - 8) / 10)
    metrics["speed"].append([95, 60, 75, 25, 10][i % 5])
    metrics["entropy"].append((i % 13) / 4)
content = json.dumps({"metrics": metrics}, ensure_ascii=False, indent=2) + "\n"
(target / "input.json").write_text(content)
analyzer = legacy.AnalizadorTraficoFLUVI(content, tipo="json")
for method in [
    "analisis_estadistico_basico", "analisis_por_dia", "analisis_correlaciones",
    "analisis_capacidad", "detectar_eventos_criticos", "clustering_estados",
    "analisis_temporal",
]:
    getattr(analyzer, method)()
expected = legacy._serializar_resultado_analisis(analyzer.resultados)
(target / "expected.json").write_text(
    json.dumps(expected, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
)
