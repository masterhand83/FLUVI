"""Exercise the real analyzer in both languages.

Usage:
  python analyze_language.py --analizador <analizador.py> \
      --legacy-csv <file> --legacy-json <file>

Prints one JSON object with numerical summaries, captured plot text, and the
user-visible errors produced by the real Python entry points.
"""

import argparse
import contextlib
import importlib.util
import inspect
import io
import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

# Importing the analyzer must not leave build artefacts in the application sources.
sys.dont_write_bytecode = True

NUMERIC_COLUMNS = [
    "Densidad",
    "Flujo",
    "Generacion",
    "Velocidad",
    "Entropia",
    "Tiempo_seg",
    "Dia_Numero",
]


def load_analizador(path):
    spec = importlib.util.spec_from_file_location("fluvi_analizador", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize(value):
    if isinstance(value, dict):
        return {str(key): normalize(entry) for key, entry in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(entry) for entry in value]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def frame_snapshot(frame):
    return normalize(frame.round(6).to_dict(orient="list"))


def figure_texts(fig):
    texts = []
    if fig._suptitle:
        texts.append(fig._suptitle.get_text())
    for axis in fig.axes:
        texts.extend([axis.get_title(), axis.get_xlabel(), axis.get_ylabel()])
        for label in axis.get_xticklabels() + axis.get_yticklabels():
            value = label.get_text()
            if value:
                texts.append(value)
        legend = axis.get_legend()
        if legend:
            texts.extend(entry.get_text() for entry in legend.get_texts())
    return [text for text in texts if text]


def run_analysis(module, path, kind, idioma=None):
    content = Path(path).read_text(encoding="utf-8")
    if idioma is None:
        analyzer = (
            module.AnalizadorTraficoFLUVI(content, tipo="json")
            if kind == "json"
            else module.AnalizadorTraficoFLUVI(io.StringIO(content), tipo="csv")
        )
    else:
        analyzer = (
            module.AnalizadorTraficoFLUVI(content, tipo="json", idioma=idioma)
            if kind == "json"
            else module.AnalizadorTraficoFLUVI(
                io.StringIO(content),
                tipo="csv",
                idioma=idioma,
            )
        )

    presentation = []

    def capture(fig):
        presentation.extend(figure_texts(fig))
        plt.close(fig)
        return "data:image/png;base64,figure"

    analyzer.fig_to_base64 = capture
    resultados = analyzer.ejecutar_analisis_completo()
    return {
        "idioma": analyzer.idioma,
        "rows": int(len(analyzer.df)),
        "columns": list(analyzer.df.columns),
        "numeric": {
            "data": frame_snapshot(analyzer.df[NUMERIC_COLUMNS]),
            "estadisticas": frame_snapshot(resultados["estadisticas"]),
            "correlaciones": frame_snapshot(resultados["correlaciones"]),
            "capacidad": normalize(resultados["capacidad"]),
            "eventosCriticos": normalize(resultados["eventos_criticos"]),
            "estadisticasEstados": frame_snapshot(
                resultados["clustering"]["estadisticas"],
            ),
            "temporal": frame_snapshot(resultados["temporal"]),
        },
        "resultKeys": list(resultados.keys()),
        "presentation": presentation,
    }


def capture_error(module, content, kind, idioma=None):
    archivo = io.StringIO(content) if kind == "csv" else content
    try:
        if idioma is None:
            module.AnalizadorTraficoFLUVI(archivo, tipo=kind)
        else:
            module.AnalizadorTraficoFLUVI(archivo, tipo=kind, idioma=idioma)
    except ValueError as error:
        return str(error)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--analizador", required=True)
    parser.add_argument("--legacy-csv", required=True)
    parser.add_argument("--legacy-json", required=True)
    args = parser.parse_args()

    with contextlib.redirect_stdout(io.StringIO()):
        module = load_analizador(args.analizador)
        result = {
            "csv": {
                "es": run_analysis(module, args.legacy_csv, "csv", "es"),
                "en": run_analysis(module, args.legacy_csv, "csv", "en"),
                "default": run_analysis(module, args.legacy_csv, "csv"),
            },
            "json": {
                "es": run_analysis(module, args.legacy_json, "json", "es"),
                "en": run_analysis(module, args.legacy_json, "json", "en"),
                "default": run_analysis(module, args.legacy_json, "json"),
            },
            "errors": {
                "missingMetrics": {
                    language: capture_error(
                        module,
                        '{"nope": true}',
                        "json",
                        None if language == "default" else language,
                    )
                    for language in ("es", "en", "default")
                },
                "missingKey": {
                    language: capture_error(
                        module,
                        json.dumps({
                            "metrics": {
                                "timestamps": [],
                                "density": [],
                                "throughput": [],
                                "netGeneration": [],
                                "entropy": [],
                            },
                        }),
                        "json",
                        None if language == "default" else language,
                    )
                    for language in ("es", "en", "default")
                },
                "invalidJson": {
                    language: capture_error(
                        module,
                        "{not json",
                        "json",
                        None if language == "default" else language,
                    )
                    for language in ("es", "en", "default")
                },
                "readFailed": {
                    language: capture_error(
                        module,
                        "\n".join(["x"] * 6 + ["a,b"]),
                        "csv",
                        None if language == "default" else language,
                    )
                    for language in ("es", "en", "default")
                },
            },
            "wrapperDefaults": {
                name: (
                    inspect.signature(getattr(module, name))
                    .parameters["idioma"]
                    .default
                )
                for name in (
                    "analizar_csv_web",
                    "analizar_json_web",
                    "analizar_archivo_web",
                )
            },
        }
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
