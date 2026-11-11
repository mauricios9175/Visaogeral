// Entender o pedido do assistente (sem banco nem IA: dá para testar com frases soltas).
// A ordem importa: reunião antes de tarefa ("cria uma reunião…" é reunião), tarefa explícita antes de campanha
// ("cria tarefa de montar campanha…" é tarefa), campanha antes de análise.

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type Intencao = "reuniao" | "agenda" | "tarefa" | "concluir" | "campanha" | "resumo" | null;

const PALAVRA_REUNIAO = /\b(reuniao|reunioes|call|chamada|meet|videochamada|alinhamento com)\b/;
const PERGUNTA = /^\s*(quais|qual|que|quando|tenho|o que|oq|quantas|como esta minha|como ta minha|me (mostra|diz|fala))\b|\?\s*$/;

/** O pedido é para montar campanha (e não para analisar)? */
export function ehPedidoDeCampanha(texto: string) {
  const t = sem(texto);
  return /\b(campanha|esboco|rascunho|mont[ae]r?|anuncio)\b/.test(t) && /\b(campanha|esboco|rascunho|anuncio|conjunto)\b/.test(t)
    && !/\banalis|\bresum|\brelatorio|como (foi|esta|ta|estao|tao)|desempenho|ultim[oa]s? \d+|mes passado|\bpausad|\bquant[oa]s?\b/.test(t);
}

export function intencaoDo(texto: string): Intencao {
  const t = sem(texto);
  const pedeTarefa = /\btarefa\b|^\s*(me )?lembr[ae]r?\b|^\s*anot[ae]r?\b/.test(t);
  // reunião: fala de reunião/call e não é uma pergunta sobre a agenda nem uma tarefa explícita
  if (PALAVRA_REUNIAO.test(t) && !pedeTarefa) {
    if (PERGUNTA.test(t) && !/\b(marc|agend|cri[ae]|coloc|bot[ae])\w*/.test(t)) return "agenda";
    return "reuniao";
  }
  if (/^\s*(quais|qual|que|tenho|como esta|como ta)\b.*\b(agenda|compromissos?)\b/.test(t)) return "agenda";
  if (/^\s*(conclui|concluir|terminei|finalizei|fiz|feito|ja fiz|marca(r)? (como )?feit)/.test(t) || /\b(marca(r)?|marque) (a tarefa )?.*\bcomo feita\b/.test(t)) return "concluir";
  if (pedeTarefa) return "tarefa";
  if (ehPedidoDeCampanha(texto)) return "campanha";
  if (/^\s*(cria|criar|crie|adiciona|adicionar|adicione|nova tarefa)\b/.test(t)) return "tarefa";
  if (/\b(o que|oq|que) (eu )?(tenho|preciso|devo)\b|\bmeu dia\b|\bresumo do dia\b|\b(tarefas|agenda) (de|pra|para) hoje\b|\bpendencias?\b|\bquais clientes\b.*\b(fazer|preciso|atencao|hoje)\b|^\s*bom dia\b/.test(t)) return "resumo";
  return null;
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/**
 * Horário (e fim, se vier um intervalo) no texto:
 * "16h", "16h30", "16:30", "às 9", "às 3 da tarde", "meio-dia", "das 16 às 17h", "16h-17h", "de 14h até 15h30".
 */
export function horarioDoTexto(texto: string): { inicio: string; fim: string | null } | null {
  const t = sem(texto);
  const tarde = /\b(da|de|a|pela) (tarde|noite)\b/.test(t);
  const ajustar = (h: number) => (tarde && h < 12 ? h + 12 : h);
  // intervalo: "das 16 às 17h", "16 às 17", "16h-17h", "de 14h ate 15h30", "entre 10 e 11"
  const iv = /\b(?:das|de|entre|as)?\s*(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?)?\s*(?:h\b)?\s*(?:as|a|ate|-|e)\s*(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?)?\s*(?:h\b|horas?\b)?/.exec(t);
  if (iv) {
    // só vale como intervalo se tiver cara de horário (algum "h", ":", "às/das" ou "da tarde") e for de manhã até a noite
    const contexto = /(\d\s*(h|:))|\b(as|das|entre)\b/.test(iv[0])
      // "dia 5 às 15h" é data + horário, não intervalo
      && !/\b(dia|dias)\s*$/.test(t.slice(0, iv.index + iv[0].indexOf(iv[1]))) && t[iv.index + iv[0].indexOf(iv[1]) + iv[1].length] !== "/";
    let h1 = Number(iv[1]), h2 = Number(iv[3]);
    const m1 = iv[2] ? Number(iv[2]) : 0, m2 = iv[4] ? Number(iv[4]) : 0;
    if (contexto && h1 <= 23 && h2 <= 23 && m1 < 60 && m2 < 60) {
      h1 = ajustar(h1); h2 = ajustar(h2);
      if (h2 * 60 + m2 > h1 * 60 + m1) return { inicio: hhmm(h1, m1), fim: hhmm(h2, m2) };
    }
  }
  if (/\bmeio[- ]dia\b/.test(t)) return { inicio: "12:00", fim: null };
  const m = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/.exec(t) ?? /\b(?:as|pras|para as|a partir das)\s+(\d{1,2})\b/.exec(t);
  if (!m) return null;
  const h = ajustar(Number(m[1]));
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return { inicio: hhmm(h, min), fim: null };
}

/** Só o horário de início (compatível com o uso antigo). */
export function horaDoTexto(texto: string): string | null {
  return horarioDoTexto(texto)?.inicio ?? null;
}

/** Duração em minutos: do intervalo ("16 às 17h"), ou "45 min", "1 hora", "1h30 de duração"; padrão 30. */
export function duracaoDoTexto(texto: string): number {
  const h = horarioDoTexto(texto);
  if (h?.fim) {
    const [a, b] = [h.inicio, h.fim].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)));
    return b - a;
  }
  const t = sem(texto);
  const min = /(\d{2,3})\s*min/.exec(t);
  if (min) return Number(min[1]);
  if (/\b(duas|2) horas\b/.test(t)) return 120;
  if (/\b(uma hora e meia|1h30 de duracao)\b/.test(t)) return 90;
  if (/\b(uma|1) hora\b|\bpor 1h\b|\b1h de duracao\b/.test(t)) return 60;
  return 30;
}
