"""Parse metric exports with the application's real Python reader.

Usage:
  python read_metrics_export.py --analizador <analizador.py> \
      --legacy-csv <file> --legacy-json <file> \
      --new-csv <file> --new-json <file>

Prints one JSON object with a compact summary of each parsed file.
"""

import argparse
import contextlib
import importlib.util
import io
import json
import sys
from pathlib import Path

# Importing the analyzer must not leave build artefacts in the application sources.
sys.dont_write_bytecode = True


def load_analizador(path):
    spec = importlib.util.spec_from_file_location("fluvi_analizador", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def summarize(module, path, kind):
    content = Path(path).read_text(encoding="utf-8")
    if kind == "json":
        analyzer = module.AnalizadorTraficoFLUVI(content, tipo="json")
    else:
        analyzer = module.AnalizadorTraficoFLUVI(io.StringIO(content), tipo="csv")

    df = analyzer.df
    return {
        "rows": int(len(df)),
        "columns": list(df.columns),
        "timestamps": df["Marca_Tiempo"].astype(str).tolist(),
        "days": df["Dia_Semana"].tolist(),
        "density": [float(value) for value in df["Densidad"]],
        "tiempoSeg": [float(value) for value in df["Tiempo_seg"]],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--analizador", required=True)
    parser.add_argument("--legacy-csv", required=True)
    parser.add_argument("--legacy-json", required=True)
    parser.add_argument("--new-csv", required=True)
    parser.add_argument("--new-json", required=True)
    args = parser.parse_args()

    with contextlib.redirect_stdout(io.StringIO()):
        module = load_analizador(args.analizador)
        result = {
            "legacyCsv": summarize(module, args.legacy_csv, "csv"),
            "legacyJson": summarize(module, args.legacy_json, "json"),
            "newCsv": summarize(module, args.new_csv, "csv"),
            "newJson": summarize(module, args.new_json, "json"),
        }
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
