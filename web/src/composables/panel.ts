// Dados do servidor via TanStack Query. A API entra por injeção para os testes trocarem por uma falsa.
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { inject, type InjectionKey, type MaybeRefOrGetter, toValue } from 'vue';
import { createPanelApi, type PanelApi } from '../api/client';

export const TENANT_ID: InjectionKey<string> = Symbol('tenant-id');
export const PANEL_API: InjectionKey<PanelApi> = Symbol('panel-api');

export const LIST_REFRESH_MS = 10_000;
export const DETAIL_REFRESH_MS = 5_000;

export function useTenant(): string {
  return inject(TENANT_ID, import.meta.env.VITE_TENANT_ID ?? 'estudio-lotus');
}

export function usePanelApi(): { api: PanelApi; tenantId: string } {
  const tenantId = useTenant();
  return { tenantId, api: inject(PANEL_API, undefined) ?? createPanelApi(tenantId) };
}

export function useConversations() {
  const { api, tenantId } = usePanelApi();
  return useQuery({ queryKey: ['conversations', tenantId], queryFn: () => api.conversations('all'), refetchInterval: LIST_REFRESH_MS });
}

export function useConversation(conversationId: MaybeRefOrGetter<string | undefined>) {
  const { api, tenantId } = usePanelApi();
  return useQuery({
    queryKey: ['conversation', tenantId, () => toValue(conversationId)],
    queryFn: () => api.conversation(toValue(conversationId) as string),
    enabled: () => Boolean(toValue(conversationId)),
    refetchInterval: DETAIL_REFRESH_MS,
  });
}

export function useAttendantActions(conversationId: MaybeRefOrGetter<string | undefined>) {
  const { api, tenantId } = usePanelApi();
  const queryClient = useQueryClient();
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['conversations', tenantId] }), queryClient.invalidateQueries({ queryKey: ['conversation', tenantId] })]);
  const id = () => toValue(conversationId) as string;

  const send = useMutation({ mutationFn: (text: string) => api.send(id(), text), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => api.resume(id()), onSuccess: refresh });
  return { send, resume };
}

export function useThumbnail(messageId: MaybeRefOrGetter<string>) {
  const { api, tenantId } = usePanelApi();
  return useQuery({ queryKey: ['thumbnail', tenantId, () => toValue(messageId)], queryFn: () => api.thumbnail(toValue(messageId)), staleTime: Infinity, retry: false });
}

export function useMetrics(days: MaybeRefOrGetter<number>) {
  const { api, tenantId } = usePanelApi();
  return useQuery({ queryKey: ['metrics', tenantId, () => toValue(days)], queryFn: () => api.metrics(toValue(days)), refetchInterval: 60_000 });
}

export function useScope() {
  const { api, tenantId } = usePanelApi();
  return useQuery({ queryKey: ['scope', tenantId], queryFn: () => api.scope(), staleTime: Infinity });
}
