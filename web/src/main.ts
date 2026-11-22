import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/onest';
import 'vuetify/styles';
import './styles/main.css';
import { createApp } from 'vue';
import App from './App.vue';
import { installPlugins } from './plugins';
import { createAppRouter } from './router';

const app = createApp(App);
installPlugins(app, createAppRouter());
app.mount('#app');
