// Formatação de horários sempre a partir dos dados das ferramentas, no fuso do estúdio.
// É o único lugar que transforma um instante em texto para o aluno (ver citation-guard.ts).

const parts = (iso: string, timezone: string) => {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(formatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return {
    weekday: String(map.weekday ?? '').replace('.', ''),
    date: `${String(map.day)}/${String(map.month)}`,
    time: `${String(map.hour)}:${String(map.minute)}`,
  };
};

/** "ter 03/03 18:00" */
export function formatSlotStart(iso: string, timezone: string): string {
  const p = parts(iso, timezone);
  return `${p.weekday} ${p.date} ${p.time}`;
}

/** Datas e horas (dd/mm e HH:mm) que um instante pode gerar no texto, para o guard conferir. */
export function citableTokens(iso: string, timezone: string): readonly string[] {
  const p = parts(iso, timezone);
  return [p.date, p.time];
}

/** Data local (YYYY-MM-DD) de um instante no fuso informado. */
export function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}
