import { QueryClient } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createHandoffApi, waitingTime, type HandoffApi, type HandoffTicket } from '../src/api/handoffs';
import { HANDOFF_API } from '../src/composables/useHandoffQueue';
import { installPlugins } from '../src/plugins';
import HandoffQueueView from '../src/views/HandoffQueueView.vue';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const ticket: HandoffTicket = {
  conversationId: 'estudio-lotus:5511900000001',
  contact: '*********0001',
  reason: 'sensitive_topic',
  requestedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

function render(api: HandoffApi) {
  return mount(HandoffQueueView, {
    props: { tenantId: 'estudio-lotus' },
    global: {
      plugins: [{ install: (app) => installPlugins(app, new QueryClient({ defaultOptions: { queries: { retry: false } } })) }],
      provide: { [HANDOFF_API as symbol]: api },
    },
  });
}

describe('fila de atendimento', () => {
  it('lista quem aguarda, com motivo e tempo de espera', async () => {
    const wrapper = render({ list: vi.fn().mockResolvedValue([ticket]), resume: vi.fn() });
    await flushPromises();

    expect(wrapper.findAll('[data-test="ticket"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('Tema sensível · há 5 min');
    expect(wrapper.text()).toContain('*********0001');
  });

  it('devolver ao bot chama a API e recarrega a fila', async () => {
    const list = vi.fn().mockResolvedValueOnce([ticket]).mockResolvedValueOnce([]);
    const resume = vi.fn().mockResolvedValue(undefined);
    const wrapper = render({ list, resume });
    await flushPromises();

    await wrapper.find('[data-test="ticket"] button').trigger('click');
    await flushPromises();

    expect(resume).toHaveBeenCalledWith('estudio-lotus', 'estudio-lotus:5511900000001');
    expect(list).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="empty"]').exists()).toBe(true);
  });

  it('mostra erro quando a API falha', async () => {
    const wrapper = render({ list: vi.fn().mockRejectedValue(new Error('500')), resume: vi.fn() });
    await flushPromises();

    expect(wrapper.find('[data-test="error"]').exists()).toBe(true);
  });
});

describe('cliente da API', () => {
  it('codifica o id da conversa na URL e falha com o status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));

    await expect(createHandoffApi(fetchImpl).resume('estudio-lotus', 'estudio-lotus:5511900000001')).rejects.toThrow('409');
    expect(fetchImpl).toHaveBeenCalledWith('/api/tenants/estudio-lotus/handoffs/estudio-lotus%3A5511900000001/resume', { method: 'POST' });
  });

  it('formata o tempo de espera', () => {
    const now = new Date('2026-03-02T12:00:00Z');
    expect(waitingTime('2026-03-02T11:59:40Z', now)).toBe('agora');
    expect(waitingTime('2026-03-02T09:30:00Z', now)).toBe('há 2 h');
  });
});
