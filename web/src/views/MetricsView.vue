<script setup lang="ts">
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { computed, ref } from 'vue';
import VChart from 'vue-echarts';
import { useTheme } from 'vuetify';
import { useMetrics } from '../composables/panel';
import { REASON_LABEL } from '../lib/labels';
import { indicatorsOf } from '../lib/metrics';
import type { HandoffReason } from '../api/schemas';

use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const days = ref(7);
const metrics = useMetrics(days);
const theme = useTheme();
const color = (name: string): string => String(theme.current.value.colors[name] ?? '#888');

const indicators = computed(() => (metrics.data.value ? indicatorsOf(metrics.data.value) : []));

const hourlyOption = computed(() => {
  const hourly = metrics.data.value?.hourly ?? [];
  const text = color('on-surface');
  return {
    textStyle: { color: text },
    tooltip: { trigger: 'axis' },
    legend: { data: ['Resolvidas pelo bot', 'Transferidas'], textStyle: { color: text } },
    grid: { left: 36, right: 12, top: 36, bottom: 28 },
    xAxis: { type: 'category', boundaryGap: false, data: hourly.map((h) => `${String(h.hour).padStart(2, '0')}h`) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: 'Resolvidas pelo bot', type: 'line', stack: 'total', areaStyle: {}, showSymbol: false, itemStyle: { color: color('success') }, data: hourly.map((h) => h.resolved) },
      { name: 'Transferidas', type: 'line', stack: 'total', areaStyle: {}, showSymbol: false, itemStyle: { color: color('accent') }, data: hourly.map((h) => h.handedOff) },
    ],
  };
});

const reasons = computed(() =>
  (Object.entries(metrics.data.value?.handoffsByReason ?? {}) as [HandoffReason, number][]).sort((a, b) => b[1] - a[1]),
);
const reasonsOption = computed(() => ({
  textStyle: { color: color('on-surface') },
  tooltip: { trigger: 'item' },
  grid: { left: 150, right: 24, top: 8, bottom: 24 },
  xAxis: { type: 'value', minInterval: 1 },
  yAxis: { type: 'category', inverse: true, data: reasons.value.map(([r]) => REASON_LABEL[r]) },
  series: [{ type: 'bar', itemStyle: { color: color('primary') }, data: reasons.value.map(([, n]) => n) }],
}));
</script>

<template>
  <v-container
    class="py-6"
    style="max-width: 1100px"
  >
    <div class="d-flex align-center justify-space-between mb-4">
      <h1>Métricas</h1>
      <v-btn-toggle
        v-model="days"
        mandatory
        density="comfortable"
        variant="outlined"
        aria-label="Período"
      >
        <v-btn :value="7">
          7 dias
        </v-btn>
        <v-btn :value="30">
          30 dias
        </v-btn>
      </v-btn-toggle>
    </div>

    <v-alert
      v-if="metrics.isError.value"
      type="error"
    >
      Não foi possível carregar as métricas.
    </v-alert>
    <template v-else-if="metrics.data.value">
      <div class="indicators mb-6">
        <v-card
          v-for="i in indicators"
          :key="i.key"
          border
          class="pa-4"
          data-test="indicator"
          :data-tone="i.tone"
        >
          <div class="meta">
            {{ i.label }}
          </div>
          <div
            class="display tnum"
            style="font-size: 36px; line-height: 40px"
            :style="{ color: `rgb(var(--v-theme-${i.tone}))` }"
          >
            {{ i.value }}
          </div>
          <div class="meta">
            {{ i.goal }}
          </div>
          <div class="mt-2">
            {{ i.action }}
          </div>
        </v-card>
      </div>

      <h2 class="text-h6 mb-2">
        Por hora do dia
      </h2>
      <v-chart
        class="chart mb-6"
        :option="hourlyOption"
        autoresize
        aria-label="Conversas resolvidas pelo bot e transferidas, por hora do dia"
      />

      <h2 class="text-h6 mb-2">
        Motivos de transferência
      </h2>
      <p
        v-if="reasons.length === 0"
        class="meta mb-6"
        data-test="no-handoffs"
      >
        Nenhuma transferência no período.
      </p>
      <v-chart
        v-else
        class="chart chart--short mb-6"
        :option="reasonsOption"
        autoresize
        aria-label="Transferências por motivo"
      />

      <h2 class="text-h6 mb-2">
        Mensagens proativas
      </h2>
      <p class="tnum">
        {{ metrics.data.value.proactive.reminders }} lembretes de aula e {{ metrics.data.value.proactive.waitlistPromotions }} vagas liberadas avisadas por template.
      </p>
    </template>
    <v-progress-linear
      v-else
      indeterminate
    />
  </v-container>
</template>

<style scoped>
.indicators { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.chart { height: 260px; }
.chart--short { height: 160px; }
</style>
