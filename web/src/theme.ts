// Tema "Recado" (direção de identidade, seção 5): cobalto para a fala humana, ardósia para o bot,
// amarelo-recado só para "aguardando humano".
import { createVuetify, type ThemeDefinition } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';

const recadoLight: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F4F5FA',
    surface: '#FFFFFF',
    'surface-light': '#EEF0F7',
    'surface-variant': '#E6E8F2',
    'on-surface-variant': '#161A2E',
    'on-background': '#161A2E',
    'on-surface': '#161A2E',
    primary: '#3242B8',
    'on-primary': '#FFFFFF',
    secondary: '#575B73',
    'on-secondary': '#FFFFFF',
    accent: '#F5C24C',
    'on-accent': '#3A2A00',
    success: '#1F7A55',
    warning: '#9A5B00',
    error: '#C0362C',
    info: '#3242B8',
    'lane-bot': '#575B73',
    'lane-human': '#3242B8',
  },
  variables: { 'border-color': '#161A2E', 'border-opacity': 0.12, 'medium-emphasis-opacity': 0.7, 'disabled-opacity': 0.4, 'hover-opacity': 0.05, 'focus-opacity': 0.12 },
};

const recadoDark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#10121C',
    surface: '#171A28',
    'surface-light': '#1E2233',
    'surface-variant': '#262A3D',
    'on-surface-variant': '#E8EAF6',
    'on-background': '#E8EAF6',
    'on-surface': '#E8EAF6',
    primary: '#A9B4FF',
    'on-primary': '#111A66',
    secondary: '#B9BCD3',
    'on-secondary': '#1C1F33',
    accent: '#F5C24C',
    'on-accent': '#3A2A00',
    success: '#7DDBB0',
    warning: '#FFC870',
    error: '#FF9E94',
    info: '#A9B4FF',
    'lane-bot': '#B9BCD3',
    'lane-human': '#A9B4FF',
  },
  variables: { 'border-color': '#E8EAF6', 'border-opacity': 0.12, 'medium-emphasis-opacity': 0.7, 'disabled-opacity': 0.4, 'hover-opacity': 0.07, 'focus-opacity': 0.14 },
};

export function createRecadoVuetify() {
  return createVuetify({
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
    theme: { defaultTheme: 'recadoLight', themes: { recadoLight, recadoDark } },
    defaults: {
      VBtn: { rounded: 'lg', variant: 'flat', class: 'text-none', height: 40 },
      VCard: { rounded: 'lg', variant: 'flat', elevation: 0 },
      VChip: { rounded: 'pill', variant: 'tonal', size: 'small', label: false },
      VTextField: { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg' },
      VTextarea: { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg' },
      VList: { density: 'default', lines: 'two' },
      VListItem: { minHeight: 64, rounded: 0 },
      VAppBar: { flat: true, height: 56, color: 'surface', border: 'b' },
      VSnackbar: { rounded: 'lg', location: 'bottom right' },
      VDivider: { opacity: 0.12 },
    },
  });
}
