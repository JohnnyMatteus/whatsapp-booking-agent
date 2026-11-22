# ADR 0011: Serviço de processamento de mídias

**Status:** Aceito. Substitui o `transcription-worker` do ADR 0001.

## Contexto

O `transcription-worker` só transcrevia áudio e baixava a mídia direto da Cloud API, o que o amarrava a um provedor. O produto também recebe imagens (hoje respondidas como mídia sem suporte) e precisa validar tipo e tamanho antes de guardar qualquer coisa.

## Decisão

`services/media-processor` (Python) substitui o `transcription-worker`: o pacote foi renomeado (`media_processor`) e o caso de uso passou de `TranscribeAudio` para `ProcessMedia`.

1. **Entrada**: fila RabbitMQ `media-processor.media`, mensagem `inbound.media_received` (`kind` `audio` ou `image`, `mediaId`, `mimeType`). Substitui `inbound.audio_received` (contrato interno, só o gateway publicava e só este serviço consumia).
2. **Mídia pelo messaging-gateway**: porta `MediaSource` com adaptador HTTP para `GET /internal/media/{tenant}/{mediaId}` (token de serviço). O serviço não conhece provedor de WhatsApp. A leitura é em streaming e para ao passar do limite.
3. **Validação**: tipo declarado contra a lista por tipo (áudio: ogg, mpeg, mp4, aac, amr; imagem: jpeg, png, webp), **tipo real pelos primeiros bytes** (o declarado não é confiável) e tamanho (áudio 16 MB, imagem 5 MB). Rejeição vira `MediaProcessed` com `status: rejected` e motivo (`unsupported_type`, `too_large`, `type_mismatch`, `corrupt`, `unavailable`); o aluno recebe a orientação de mídia sem suporte.
4. **Armazenamento** em MinIO/S3: `media/<estúdio>/<AAAA-MM-DD>/<mediaId>`, com o id sanitizado; ciclo de vida de 30 dias (dado pessoal).
5. **Imagem**: miniatura JPEG de até 256 px (Pillow, com correção de orientação EXIF), gerada antes de guardar: imagem que não decodifica não fica armazenada.
6. **Áudio**: transcrição pela porta `Transcriber` (faster-whisper local; nos testes e em desenvolvimento, `FakeTranscriber`). O texto sai como `inbound.message_received` com o mesmo `messageId`, como antes.
7. **Saída**: `media.processed` (MidiaProcessada) com `storageKey`, `thumbnailKey`, `sizeBytes` e `transcribed`, mais `inbound.message_received` para o agente. Imagem aceita gera `message_received` do tipo `unsupported` (o agente não interpreta imagem).

## Consequências

- Mídia nova (documento, vídeo) entra por `kind` e uma regra em `ALLOWED_MIME_PREFIXES`, sem tocar nos provedores.
- O processamento é independente do atendimento: uma rajada de áudios não atrasa o agente.
- O booking-agent consome `media.processed` (binding na fila `booking-agent.inbound`) e guarda uma anotação por `messageId` no Redis (30 dias). A leitura da conversa junta a anotação à mensagem do aluno, então a ordem de chegada entre o evento e o texto não importa. O painel mostra a miniatura (`GET /api/tenants/:t/media/:messageId/thumbnail`, mesma autenticação e tenant das outras rotas) ou o motivo da recusa. A chave do armazenamento fica no servidor: o cliente só informa o `messageId`, a chave precisa começar por `media/<estúdio>/`, e o media-processor só entrega chaves de miniatura (`*.thumb.jpg`) por padrão fechado, em `GET /internal/thumbnails` com token de serviço e sem rota no api-gateway.
- O consumo segue a topologia do ADR 0006: falha transitória (gateway 5xx, S3, broker) vai para `media-processor.media.retry` (TTL) e volta, até `CONSUMER_MAX_ATTEMPTS`; depois, ou direto se o corpo estiver fora do contrato, vai para `media-processor.media.dlq` com o motivo e só o tipo do erro nos headers. O reencaminhamento acontece antes do ack. A decisão está em `retry_policy.py` e `consumer.py`, testadas sem broker; o declare da fila repete os argumentos do `@wba/messaging` (senão o RabbitMQ recusa a redeclaração).
- Métricas Prometheus na porta 8083 (`wba_queue_messages_total`, que alimenta o alerta de DLQ, `wba_media_processed_total`, `wba_media_processing_seconds`), também usada como healthcheck.
- Publicações parciais: se o `message_received` falhar depois do `media.processed`, o retry republica os dois; o agente deduplica pelo `messageId`, e o `media.processed` não tem consumidor ainda.

## Alternativas

- **Manter o worker e criar outro serviço para imagem**: duplicaria download, validação e armazenamento.
- **Gerar a miniatura no gateway**: acoplaria CPU de imagem ao serviço que precisa responder o webhook em milissegundos.
