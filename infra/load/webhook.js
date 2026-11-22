// Carga no webhook de entrada (k6): mensagens assinadas como a Meta assinaria, ids e contatos distintos, direto no
// messaging-webhook pela rede do compose (o api-gateway limita a 600 por minuto por IP e não é o alvo aqui).
// Dentro do compose: docker run --rm --network whatsapp-booking-net -v "$PWD/infra/load:/scripts:ro" \
//   grafana/k6:1.0.0 run /scripts/webhook.js
import { hmac } from 'k6/crypto';
import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.WEBHOOK_URL || 'http://messaging-webhook:8080/webhooks/cloud-api';
const SECRET = __ENV.WHATSAPP_APP_SECRET || 'dev-only-change-me-app-secret';

export const options = {
  scenarios: {
    // Muitos alunos, cada mensagem de um contato diferente: capacidade do webhook e do agente.
    mensagens: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '20s', preAllocatedVUs: 50, maxVUs: 200, exec: 'muitosContatos' },
    // Rajada de um aluno só: o lock por contato adia as mensagens sem gastar tentativa nem ir para a DLQ.
    rajada: { executor: 'shared-iterations', vus: 20, iterations: 20, maxDuration: '30s', exec: 'mesmoContato' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
    checks: ['rate>0.99'],
  },
};

const pad = (value, width) => String(value).padStart(width, '0');

export function muitosContatos() {
  send(`5511${pad(__VU, 3)}${pad(__ITER, 5)}`);
}

export function mesmoContato() {
  send('5511999990000');
}

function send(contact) {
  const id = `wamid.LOAD${contact}-${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '200000000000001',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000001', phone_number_id: '100000000000001' },
              contacts: [{ profile: { name: 'Aluna Exemplo' }, wa_id: contact }],
              messages: [{ from: contact, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'oi' } }],
            },
          },
        ],
      },
    ],
  });
  const response = http.post(TARGET, body, {
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${hmac('sha256', SECRET, body, 'hex')}` },
  });
  check(response, { 'webhook aceitou (200)': (r) => r.status === 200 });
}
