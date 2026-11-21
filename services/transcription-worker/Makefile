# Alvos do worker de transcrição (usados localmente e pelo CI).
VENV ?= .venv
PY := $(VENV)/bin/python

.PHONY: install lint test

$(PY):
	python3 -m venv $(VENV)

install: $(PY) ## Ambiente de desenvolvimento (sem o modelo de transcrição)
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -e ".[dev]"

lint: ## ruff + mypy estrito no núcleo
	$(PY) -m ruff check src tests
	$(PY) -m ruff format --check src tests
	$(PY) -m mypy

test: ## Testes unitários com transcritor falso
	$(PY) -m pytest -q
