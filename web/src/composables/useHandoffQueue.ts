// Fila de atendimento com TanStack Query: cache por estúdio, atualização periódica e
// invalidação depois de devolver uma conversa ao bot.
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { inject, type InjectionKey } from 'vue';
import { createHandoffApi, type HandoffApi } from '../api/handoffs';

export const HANDOFF_API: InjectionKey<HandoffApi> = Symbol('handoff-api');
export const REFRESH_MS = 10_000;

export function useHandoffQueue(tenantId: string) {
  const api = inject(HANDOFF_API, createHandoffApi());
  const queryClient = useQueryClient();
  const queryKey = ['handoffs', tenantId] as const;

  const queue = useQuery({ queryKey, queryFn: () => api.list(tenantId), refetchInterval: REFRESH_MS });

  const resume = useMutation({
    mutationFn: (conversationId: string) => api.resume(tenantId, conversationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { queue, resume };
}
