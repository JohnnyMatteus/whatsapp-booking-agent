"""Métricas Prometheus (nomes e rótulos alinhados aos serviços Node, para os mesmos alertas valerem)."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Histogram


class PrometheusObserver:
    def __init__(self, registry: CollectorRegistry) -> None:
        self._queue = Counter(
            "wba_queue_messages_total",
            "Mensagens consumidas por fila e resultado.",
            ["queue", "result"],
            registry=registry,
        )
        self._outcomes = Counter(
            "wba_media_processed_total", "Mídias tratadas por desfecho.", ["outcome"], registry=registry
        )
        self._seconds = Histogram(
            "wba_media_processing_seconds", "Duração do processamento de uma mídia.", registry=registry
        )

    def consumed(self, queue: str, result: str) -> None:
        self._queue.labels(queue=queue, result=result).inc()

    def handled(self, outcome: str, seconds: float) -> None:
        self._outcomes.labels(outcome=outcome).inc()
        self._seconds.observe(seconds)
