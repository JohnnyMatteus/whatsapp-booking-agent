#!/usr/bin/env python3
"""Transforma o log de passos que falharam em anotações ::error do GitHub Actions.

Uso: ci-annotate.py <título> <log> [<log> ...]

Emite no máximo 5 anotações, com as linhas que importam (FALHA, erro, exit) ou, se não houver,
o fim do log. Sai sempre com 0: quem falha é o passo original, não este diagnóstico.
Não imprime variáveis de ambiente; o conteúdo do log é o que o próprio passo escreveu.
"""

import os
import re
import sys

MAX_ANNOTATIONS = 5
MAX_CHARS = 1000  # antes do escape; no pior caso (tudo `%`) fica bem abaixo de 4 KB
IMPORTANT = re.compile(r"FALHA|rror|erro|fail|FAIL|exit|unhealthy|panic", re.IGNORECASE)


def escape(text: str) -> str:
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def escape_property(text: str) -> str:
    return escape(text).replace(":", "%3A").replace(",", "%2C")


def pick_lines(path: str) -> list[str]:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            lines = [line.rstrip() for line in handle if line.strip()]
    except OSError:
        return []
    important = []
    for line in lines:
        if IMPORTANT.search(line) and line not in important:
            important.append(line)
    return important or lines[-MAX_ANNOTATIONS:]


def main() -> int:
    if len(sys.argv) < 3:
        print("uso: ci-annotate.py <título> <log> [<log> ...]", file=sys.stderr)
        return 0
    title = escape_property(sys.argv[1])
    emitted = 0
    for path in sys.argv[2:]:
        if not os.path.exists(path):
            continue
        for line in pick_lines(path):
            if emitted >= MAX_ANNOTATIONS:
                return 0
            message = escape(line[:MAX_CHARS])
            print(f"::error title={title}::{message}")
            emitted += 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
