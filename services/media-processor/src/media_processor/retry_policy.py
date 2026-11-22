"""Destino de uma mensagem que falhou (mesma regra do `decideOnFailure` dos serviços Node, ADR 0006)."""

from __future__ import annotations

from dataclasses import dataclass

from .contracts import ContractViolation

ATTEMPT_HEADER = "x-attempt"


@dataclass(frozen=True)
class Retry:
    next_attempt: int


@dataclass(frozen=True)
class DeadLetter:
    reason: str


Decision = Retry | DeadLetter


def decide_on_failure(error: BaseException, attempt: int, max_attempts: int) -> Decision:
    """Contrato violado não melhora com retry; o resto tenta até `max_attempts` e vai para a DLQ."""
    if isinstance(error, ContractViolation):
        return DeadLetter(type(error).__name__)
    if attempt >= max_attempts:
        return DeadLetter("max_attempts")
    return Retry(attempt + 1)
