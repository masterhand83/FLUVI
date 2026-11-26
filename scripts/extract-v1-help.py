#!/usr/bin/env python3
"""Copy both v1 help dialogs and translations into native, offline help data."""

import json
from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


class Node:
    def __init__(self, tag="", attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def find(self, predicate):
        if predicate(self):
            return self
        for child in self.children:
            if isinstance(child, Node):
                found = child.find(predicate)
                if found is not None:
                    return found
        return None


class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img",
                       "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def clean(text):
    # Native headings use image icons. Do not require an emoji font.
    text = re.sub("[\U0001f000-\U0001faff\u2600-\u27bf\u23f1\u23f8\ufe0f\u200d\u20e3]", "", text)
    return " ".join(text.split())


def extract(language):
    catalog = json.loads(
        (ROOT / f"apps/v1/src/locales/{language}/translation.json").read_text()
    )
    parser = Parser()
    parser.feed((ROOT / "apps/v1/index.html").read_text())

    def text(node):
        if isinstance(node, str):
            return node
        key = node.attrs.get("data-i18n")
        if key:
            value = catalog
            for part in key.split("."):
                value = value[part]
            return value
        return "".join(text(child) for child in node.children)

    block_tags = {"h4", "h5", "h6", "p", "li", "pre", "tr"}

    def blocks(node):
        if node.tag in block_tags:
            if node.tag == "tr":
                yield {"kind": "row", "text": "  |  ".join(
                    clean(text(child)) for child in node.children
                    if isinstance(child, Node) and child.tag in {"th", "td"}
                )}
            else:
                kind = ("heading" if node.tag in {"h4", "h5", "h6"} else
                        "code" if node.tag == "pre" else
                        "item" if node.tag == "li" else "paragraph")
                value = text(node).strip() if kind == "code" else clean(text(node))
                if value:
                    yield {"kind": kind, "text": value}
            return
        # Include inline-only containers, such as the heatmap colour legend.
        if node.find(lambda child: child is not node and child.tag in block_tags) is None:
            value = clean(text(node))
            if value:
                yield {"kind": "paragraph", "text": value}
            return
        for child in node.children:
            if isinstance(child, Node):
                yield from blocks(child)

    result = {}
    for name, modal_id in [("information", "aboutModal"), ("guide", "instructionsModal")]:
        modal = parser.root.find(lambda node: node.attrs.get("id") == modal_id)
        body = modal.find(lambda node: "modal-body" in node.attrs.get("class", "").split())
        title = modal.find(lambda node: node.attrs.get("id") == modal_id + "Label")
        result[name] = {"title": clean(text(title)), "blocks": list(blocks(body))}
    return json.dumps(result, ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    for language in ["es", "en"]:
        path = ROOT / f"crates/ca-app/src/shell/help/{language}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(extract(language))
