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
- Nada consome `media.processed` ainda; é o ponto de extensão para o painel mostrar miniaturas.
- O laço de consumo continua mínimo (nack com requeue): retry com TTL e DLQ iguais aos serviços Node seguem em Próximos passos.

## Alternativas

- **Manter o worker e criar outro serviço para imagem**: duplicaria download, validação e armazenamento.
- **Gerar a miniatura no gateway**: acoplaria CPU de imagem ao serviço que precisa responder o webhook em milissegundos.
