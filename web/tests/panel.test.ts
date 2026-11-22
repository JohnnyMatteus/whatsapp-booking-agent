import { QueryClient } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type PanelApi } from '../src/api/client';
import type { ConversationDetail, ConversationList, Metrics } from '../src/api/schemas';
import { PANEL_API, TENANT_ID } from '../src/composables/panel';
import { deadlineOf } from '../src/lib/time';
import { indicatorsOf } from '../src/lib/metrics';
import { installPlugins } from '../src/plugins';
import { createAppRouter } from '../src/router';
import InboxView from '../src/views/InboxView.vue';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const ID = 'estudio-lotus:5511900000001';
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const citation = { sessionId: 's1', title: 'Pilates', instructorName: 'Ana', startsAt: '2026-03-03T21:00:00Z', endsAt: '2026-03-03T22:00:00Z', timezone: 'America/Sao_Paulo', capacity: 8, confirmedCount: 3, waitlistCount: 0, fetchedAt: '2026-03-01T12:41:00Z', tool: 'listar_aulas' };

const list: ConversationList = {
  data: [
    { conversationId: 'b', contact: '*********0002', status: 'bot_active', handoff: null, lastMessage: { author: 'bot', preview: 'Tem vaga amanhã', at: at(1) }, updatedAt: at(1) },
    { conversationId: ID, contact: '*********0001', status: 'handed_off', handoff: { reason: 'sensitive_topic', at: at(2) }, lastMessage: { author: 'student', preview: 'Quero o reembolso', at: at(5) }, updatedAt: at(5) },
  ],
  meta: { waiting: 1, botActive: 1 },
};

const detail: ConversationDetail = {
  conversationId: ID,
  contact: '*********0001',
  status: 'handed_off',
  handoff: { reason: 'sensitive_topic', at: at(5) },
  correlationId: 'corr-1',
  consecutiveFailures: 0,
  lastInboundAt: at(5),
  serviceWindowEndsAt: null,
  timeline: [
    { id: '1', kind: 'student', at: at(9), text: 'Quais aulas amanhã?', transcribed: false, messageId: 'm1', action: null },
    { id: '2', kind: 'bot', at: at(9), text: 'Amanhã tem Pilates às 18:00.', choices: [], citations: [citation], outcome: 'answered' },
    { id: '3', kind: 'handoff', at: at(5), reason: 'sensitive_topic' },
    { id: '4', kind: 'student', at: at(5), text: 'Quero o reembolso', transcribed: false, messageId: 'm2', action: null },
  ],
  context: { offeredAt: null, offeredSlots: [], bookings: [], linked: true },
};

function fakeApi(overrides: Partial<PanelApi> = {}): PanelApi {
  return {
    conversations: vi.fn().mockResolvedValue(list),
    conversation: vi.fn().mockResolvedValue(detail),
    send: vi.fn().mockResolvedValue({ id: '5', kind: 'attendant', at: at(0), text: 'oi' }),
    resume: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockRejectedValue(new Error('sem métricas')),
    scope: vi.fn(),
    ...overrides,
  };
}

async function render(api: PanelApi, conversationId?: string) {
  const router = createAppRouter(createMemoryHistory());
  const wrapper = mount(InboxView, {
    props: { conversationId },
    global: {
      plugins: [{ install: (app) => installPlugins(app, router, new QueryClient({ defaultOptions: { queries: { retry: false } } })) }],
      provide: { [PANEL_API as symbol]: api, [TENANT_ID as symbol]: 'estudio-lotus' },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('fila', () => {
  it('mostra o contador, o selo de recado só em quem espera e o anel de prazo', async () => {
    const wrapper = await render(fakeApi());

    expect(wrapper.get('[data-test="queue-counter"]').text()).toContain('1');
    const items = wrapper.findAll('[data-test="queue-item"]');
    expect(items[0]?.attributes('data-status')).toBe('handed_off');
    expect(items[0]?.find('[data-test="badge-recado"]').exists()).toBe(true);
    expect(items[1]?.find('[data-test="badge-recado"]').exists()).toBe(false);
    expect(items[0]?.find('[data-test="wait-ring"]').attributes('data-status')).toBe('ok');
  });

  it('estado vazio explica que o bot atende sozinho', async () => {
    const empty = fakeApi({ conversations: vi.fn().mockResolvedValue({ data: [], meta: { waiting: 0, botActive: 3 } }) });
    const wrapper = await render(empty);

    expect(wrapper.get('[data-test="queue-counter"]').text()).toContain('Nenhuma conversa esperando. O bot está atendendo sozinho.');
    expect(wrapper.text()).toContain('3 conversas ativas');
  });

  it('erro da API aparece na fila', async () => {
    const wrapper = await render(fakeApi({ conversations: vi.fn().mockRejectedValue(new Error('500')) }));
    expect(wrapper.find('[data-test="list-error"]').exists()).toBe(true);
  });
});

describe('conversa', () => {
  it('mostra a costura de transferência e o carimbo de fonte da chamada de ferramenta', async () => {
    const wrapper = await render(fakeApi(), ID);

    expect(wrapper.get('[data-test="seam"]').text()).toContain('Transferida · tema sensível');
    expect(wrapper.get('[data-test="source-stamp"]').text()).toContain('fonte: agenda');
    expect(wrapper.find('[data-test="correlation-id"]').text()).toBe('corr-1');
  });

  it('envia a resposta do atendente', async () => {
    const api = fakeApi();
    const wrapper = await render(api, ID);

    await wrapper.get('[data-test="composer"] input').setValue('Já resolvo isso');
    await wrapper.get('[data-test="composer"]').trigger('submit');
    await flushPromises();

    expect(api.send).toHaveBeenCalledWith(ID, 'Já resolvo isso');
  });

  it('mostra a mensagem em português quando a janela de 24 h fechou', async () => {
    const api = fakeApi({ send: vi.fn().mockRejectedValue(new ApiError(409, 'customer_service_window_closed')) });
    const wrapper = await render(api, ID);

    await wrapper.get('[data-test="composer"] input').setValue('Oi');
    await wrapper.get('[data-test="composer"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-test="action-error"]').text()).toContain('24 h');
  });

  it('devolver ao bot pede confirmação em uma linha antes de chamar a API', async () => {
    const api = fakeApi();
    const wrapper = await render(api, ID);

    await wrapper.get('[data-test="resume"]').trigger('click');
    expect(api.resume).not.toHaveBeenCalled();
    await wrapper.get('[data-test="resume-yes"]').trigger('click');
    await flushPromises();

    expect(api.resume).toHaveBeenCalledWith(ID);
  });

  it('sem conversa escolhida, orienta a escolher na fila', async () => {
    const wrapper = await render(fakeApi());
    expect(wrapper.find('[data-test="no-selection"]').exists()).toBe(true);
  });
});

describe('prazo e indicadores', () => {
  it('prazo: verde, âmbar e vermelho conforme a meta de 5 min', () => {
    const now = new Date();
    expect(deadlineOf(at(1), now, 300).status).toBe('ok');
    expect(deadlineOf(at(4), now, 300).status).toBe('soon');
    expect(deadlineOf(at(6), now, 300).status).toBe('overdue');
  });

  it('todo indicador traz meta e ação', () => {
    const m: Metrics = {
      period: { from: 'a', to: 'b' },
      totals: { turns: 10, answered: 6, refused: 1, handedOff: 3, failed: 0 },
      botResolutionRate: 0.6,
      goals: { botResolutionRate: 0.7, avgWaitSeconds: 300 },
      avgWaitSeconds: 240,
      deliveryFailures: 2,
      handoffsByReason: { explicit_request: 3, repeated_failure: 0, sensitive_topic: 0 },
      hourly: [],
      proactive: { reminders: 0, waitlistPromotions: 0 },
    };
    const [resolution, wait, delivery] = indicatorsOf(m);

    expect(resolution).toMatchObject({ value: '60%', goal: 'meta 70%', tone: 'warning' });
    expect(wait).toMatchObject({ value: '4 min', goal: 'meta 5 min', tone: 'success' });
    expect(delivery).toMatchObject({ value: '2', tone: 'error' });
    for (const i of [resolution, wait, delivery]) expect(i?.action).not.toBe('');
  });
});
