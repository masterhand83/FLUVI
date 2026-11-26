"""Check source coverage and freshness of the native help copy."""

import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("extract-v1-help.py")
SPEC = importlib.util.spec_from_file_location("extract_v1_help", SCRIPT)
HELP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELP)


class HelpExtractionTests(unittest.TestCase):
    def test_embedded_documents_match_current_v1_source(self):
        for language in ["es", "en"]:
            with self.subTest(language=language):
                path = HELP.ROOT / f"crates/ca-app/src/shell/help/{language}.json"
                self.assertEqual(path.read_text(), HELP.extract(language))

    def test_every_translated_modal_fragment_is_present(self):
        parser = HELP.Parser()
        parser.feed((HELP.ROOT / "apps/v1/index.html").read_text())

        def keys(node):
            if "data-i18n" in node.attrs:
                yield node.attrs["data-i18n"]
            for child in node.children:
                if isinstance(child, HELP.Node):
                    yield from keys(child)

        for language in ["es", "en"]:
            catalog = json.loads(
                (HELP.ROOT / f"apps/v1/src/locales/{language}/translation.json").read_text()
            )
            copied = json.loads(HELP.extract(language))
            for name, modal_id in [("information", "aboutModal"), ("guide", "instructionsModal")]:
                modal = parser.root.find(lambda node: node.attrs.get("id") == modal_id)
                body = modal.find(
                    lambda node: "modal-body" in node.attrs.get("class", "").split()
                )
                all_text = "\n".join(block["text"] for block in copied[name]["blocks"])
                for key in keys(body):
                    expected = catalog
                    for part in key.split("."):
                        expected = expected[part]
                    with self.subTest(language=language, key=key):
                        self.assertIn(HELP.clean(expected), all_text)


if __name__ == "__main__":
    unittest.main()
