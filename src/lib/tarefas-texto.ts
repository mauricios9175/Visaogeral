// Entende a data escrita (ou falada) numa tarefa: "trocar criativo do Kiko amanhã", "reunião com a Vidros sexta",
// "cobrar o briefing dia 20", "revisar orçamento semana que vem". Sem nada no texto: hoje.
// Não tem nada de servidor: roda também na tela, para mostrar a data antes de salvar.

import { hojeISO, somarDias } from "./datas";

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const DIAS_SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const NUMEROS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, trinta: 30 };

const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const montar = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimoDia(a, m))).padStart(2, "0")}`;

type Regra = { re: RegExp; data: (m: RegExpExecArray, hoje: string) => string | null };

// a ordem importa: "depois de amanhã" antes de "amanhã"; "próxima sexta" antes de "sexta"
const REGRAS: Regra[] = [
  { re: /\bdepois de amanha\b/, data: (_, h) => somarDias(h, 2) },
  { re: /\b(?:pra |para )?amanha\b/, data: (_, h) => somarDias(h, 1) },
  { re: /\b(?:pra |para )?hoje\b/, data: (_, h) => h },
  {
    re: /\b(?:daqui a|em|daqui)\s+(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|trinta)\s+(dias?|semanas?|mes|meses)\b/,
    data: (m, h) => {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
      if (m[2].startsWith("semana")) return somarDias(h, n * 7);
      if (m[2].startsWith("mes")) {
        const [a, mm, d] = h.split("-").map(Number);
        const t = mm - 1 + n;
        return montar(a + Math.floor(t / 12), (t % 12) + 1, d);
      }
      return somarDias(h, n);
    },
  },
  { re: /\b(?:na |pra |para a )?(?:semana que vem|proxima semana)\b/, data: (_, h) => somarDias(h, ((8 - diaDaSemana(h)) % 7) || 7) },
  {
    re: /\b(?:no |pro |para o )?(?:mes que vem|proximo mes)\b/,
    data: (_, h) => {
      const [a, m] = h.split("-").map(Number);
      return m === 12 ? montar(a + 1, 1, 1) : montar(a, m + 1, 1);
    },
  },
  {
    // "15/11", "15/11/2026", "15-11"
    re: /\b(?:dia\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/,
    data: (m, h) => {
      const d = Number(m[1]), mes = Number(m[2]);
      if (d < 1 || d > 31 || mes < 1 || mes > 12) return null;
      let a = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(h.slice(0, 4));
      if (!m[3] && montar(a, mes, d) < h) a++;
      return montar(a, mes, d);
    },
  },
  {
    // "dia 20": o próximo dia 20 (este mês ou o que vem)
    re: /\b(?:no |pro |para o |ate o )?dia\s+(\d{1,2})\b/,
    data: (m, h) => {
      const d = Number(m[1]);
      if (d < 1 || d > 31) return null;
      const [a, mes] = h.split("-").map(Number);
      const neste = montar(a, mes, d);
      return neste >= h ? neste : mes === 12 ? montar(a + 1, 1, d) : montar(a, mes + 1, d);
    },
  },
  {
    // "sexta", "na próxima segunda", "quinta-feira": o próximo (nunca hoje)
    // só vale com "na/até/próxima…", com "-feira" ou no fim da frase ("segunda versão do criativo" não é data)
    re: /\b((?:na|no|pra|para|ate)\s+)?((?:a\s+)?proxim[ao]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(-feira| feira)?\b/,
    data: (m, h) => {
      const depois = m.input.slice(m.index + m[0].length);
      const noFim = !depois.replace(/[\s.!?]/g, "");
      // "quinta às 15h", "sexta 9h30", "segunda de manhã": seguido de horário também é data
      const comHora = /^\s*(,\s*)?(as\b|das\b|de \d|entre \d|a partir|pras?\b|\d{1,2}\s*(h|:)|de (manha|tarde|noite)|(a|pela) (manha|tarde|noite))/.test(depois);
      if (!m[1] && !m[2] && !m[4] && !noFim && !comHora) return null;
      return somarDias(h, ((DIAS_SEMANA.indexOf(m[3]) - diaDaSemana(h) + 7) % 7) || 7);
    },
  },
];

/**
 * Data da tarefa a partir do texto e o título sem a parte da data.
 * `data` null = o texto não falou de data (quem chama decide: hoje).
 */
export function dataDoTexto(texto: string, hoje = hojeISO()): { data: string | null; titulo: string } {
  const t = sem(texto);
  for (const r of REGRAS) {
    const m = r.re.exec(t);
    if (!m) continue;
    const data = r.data(m, hoje);
    if (!data) continue;
    // o texto sem acento tem o mesmo tamanho do original (NFD + remover marcas mantém 1 letra por letra
    // na maioria dos casos); por segurança, recorta pelo mesmo trecho achado no original sem acento
    const original = texto.normalize("NFC");
    const inicio = sem(original).indexOf(m[0]);
    const titulo = inicio >= 0 ? original.slice(0, inicio) + original.slice(inicio + m[0].length) : original;
    return { data, titulo: limpar(titulo) || limpar(original) };
  }
  return { data: null, titulo: limpar(texto) };
}

function limpar(s: string) {
  return s.replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1").replace(/^[\s,.;-]+|[\s,;-]+$/g, "").trim();
}

/** "Hoje", "Amanhã", "Sexta, 14/11", "20/12/2027". */
export function rotuloData(iso: string, hoje = hojeISO()) {
  if (iso === hoje) return "Hoje";
  if (iso === somarDias(hoje, 1)) return "Amanhã";
  if (iso === somarDias(hoje, -1)) return "Ontem";
  const [a, m, d] = iso.split("-");
  const curta = `${d}/${m}${a !== hoje.slice(0, 4) ? `/${a}` : ""}`;
  const dias = Math.round((Date.parse(iso) - Date.parse(hoje)) / 86_400_000);
  if (dias > 0 && dias < 7) {
    const nome = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][diaDaSemana(iso)];
    return `${nome}, ${curta}`;
  }
  return curta;
}

