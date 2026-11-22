// Miniaturas pela API interna do media-processor (token de serviço, só na rede interna).
import type { ThumbnailSource } from '../../application/ports.js';

export class MediaProcessorUnavailable extends Error {
  constructor(readonly status: number) {
    super(`media-processor respondeu ${String(status)}`);
    this.name = 'MediaProcessorUnavailable';
  }
}

export class HttpThumbnailSource implements ThumbnailSource {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async fetch(key: string): Promise<Uint8Array | null> {
    const url = new URL('/internal/thumbnails', this.baseUrl);
    url.searchParams.set('key', key);
    const response = await this.fetchImpl(url, { headers: { 'x-internal-token': this.token }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (response.status === 404) return null;
    if (!response.ok) throw new MediaProcessorUnavailable(response.status);
    return new Uint8Array(await response.arrayBuffer());
  }
}
