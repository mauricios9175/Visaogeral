import "server-only";
import { db, EMPRESA_PADRAO } from "./db";
import { hojeISO, resolverPeriodo } from "./datas";
import { dinheiro, inteiro } from "./formato";
import { acharCliente } from "./analise";
import { alertasContas, resumoClientes } from "./consultas";
import { criarTarefa, listarTarefas, mudarTarefa, type Tarefa } from "./tarefas";
import { sugestoesDeTarefa } from "./tarefas-auto";
import { dataDoTexto, rotuloData } from "./tarefas-texto";
import { contasAgenda, marcarReuniao, proximosEventos, type Evento } from "./agenda";
import { duracaoDoTexto, horarioDoTexto, intencaoDo } from "./assistente-texto";
import { perguntarIA } from "./ia";

// Assistente do painel: entende o pedido (escrito ou falado) e faz. Usado na tela e, depois, no WhatsApp.
//   "o que eu tenho pra hoje?"                      → resumo do dia (agenda, tarefas, contas, sugestões)
//   "cria tarefa trocar criativo do Kiko amanhã"    → tarefa
//   "terminei a tarefa do criativo do Kiko"         → marca como feita
//   "marca reunião com a Vidros Inova quinta 15h"   → Google Agenda (com Meet)
//   qualquer outra pergunta                          → IA com os números de todos os clientes

export type Resposta = { resposta: string; links?: { rotulo: string; href: string }[] };

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export { intencaoDo, type Intencao } from "./assistente-texto";

async function clientesAtivos() {
  const { data } = await db().from("clientes").select("id, nome, empresa").eq("ativo", true);
  return ((data ?? []) as { id: string; nome: string; empresa: string | null }[]).map((c) => ({ ...c, empresa: c.empresa || EMPRESA_PADRAO }));
}

const horaBR = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** Resumo do dia: agenda de hoje, tarefas atrasadas e de hoje, contas com problema e sugestões do Dash. */
export async function resumoDoDia(): Promise<Resposta> {
  const hoje = hojeISO();
  const [tarefas, clientes, contas, agenda] = await Promise.all([
    listarTarefas(), clientesAtivos(), alertasContas().catch(() => []),
    contasAgenda().then((c) => (c.length ? proximosEventos(1).catch(() => null) : null)),
  ]);
  const nome = new Map(clientes.map((c) => [c.id, c.nome]));
  const sugestoes = await sugestoesDeTarefa(tarefas).catch(() => []);
  const abertas = tarefas.filter((t) => !t.feita);
  const atrasadas = abertas.filter((t) => !t.aguardando && t.data < hoje);
  const deHoje = abertas.filter((t) => !t.aguardando && t.data === hoje);
  const cobrar = abertas.filter((t) => t.aguardando && t.data <= hoje);
  const linhaTarefa = (t: Tarefa) => `- ${t.clienteId && nome.has(t.clienteId) ? `**${nome.get(t.clienteId)}**: ` : ""}${t.titulo}${t.data < hoje ? ` _(desde ${rotuloData(t.data, hoje).toLowerCase()})_` : ""}`;

  const L: string[] = [];
  const eventosHoje = (agenda ?? []).filter((e: Evento) => (e.diaInteiro ? e.inicio : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(e.inicio))) === hoje);
  if (agenda) {
    L.push(`## Agenda de hoje (${eventosHoje.length})`);
    L.push(...(eventosHoje.length ? eventosHoje.map((e) => `- ${e.diaInteiro ? "dia inteiro" : horaBR(e.inicio)}: ${e.titulo}${e.meet ? " (Meet)" : ""}`) : ["- Nada marcado."]));
  }
  if (contas.length) {
    L.push(`## Contas pedindo atenção (${contas.length})`);
    L.push(...contas.slice(0, 8).map((a) => `- **${a.clienteNome}** (${a.contaNome}): ${a.mensagem}`));
  }
  if (atrasadas.length) { L.push(`## Atrasadas (${atrasadas.length})`); L.push(...atrasadas.slice(0, 15).map(linhaTarefa)); }
  L.push(`## Tarefas de hoje (${deHoje.length})`);
  L.push(...(deHoje.length ? deHoje.slice(0, 20).map(linhaTarefa) : ["- Nenhuma tarefa para hoje."]));
  if (cobrar.length) { L.push(`## Cobrar do cliente (${cobrar.length})`); L.push(...cobrar.slice(0, 10).map(linhaTarefa)); }
  if (sugestoes.length) {
    L.push(`## Sugestões do Dash (${sugestoes.length})`);
    L.push(...sugestoes.slice(0, 6).map((s) => `- **${nome.get(s.clienteId) ?? "Cliente"}**: ${s.titulo}`));
  }
  const clientesComAlgo = new Set([...atrasadas, ...deHoje].map((t) => t.clienteId).filter(Boolean));
  L.unshift(`Hoje: **${atrasadas.length + deHoje.length} tarefa(s)** em ${clientesComAlgo.size} cliente(s)${eventosHoje.length ? `, ${eventosHoje.length} compromisso(s)` : ""}${contas.length ? ` e ${contas.length} conta(s) pedindo atenção` : ""}.`);
  return { resposta: L.join("\n"), links: [{ rotulo: "Abrir Tarefas", href: "/tarefas" }] };
}

/** "cria tarefa trocar criativo do Kiko amanhã" → tarefa (cliente e data saem do texto). */
async function novaTarefa(texto: string, clienteId?: string): Promise<Resposta> {
  const limpo = texto.replace(/^\s*(cri[ae]r?|anot[ae]r?|adicion[ae]r?|me lembr[ae]r?|lembr[ae]r?|nova tarefa|tarefa:)\s*(uma\s+)?(tarefa\s+)?(de|pra|para|que|ai|aí|:)?\s*/i, "");
  const antes = new Set((await listarTarefas()).map((t) => t.id));
  const lista = await criarTarefa({ texto: limpo || texto, ...(clienteId ? { clienteId } : {}) });
  const nova = lista.find((t) => !antes.has(t.id));
  if (!nova) return { resposta: "Criei a tarefa." };
  const clientes = await clientesAtivos();
  const cli = clientes.find((c) => c.id === nova.clienteId);
  return {
    resposta: `✓ Tarefa criada: **${nova.titulo}**, para ${rotuloData(nova.data, hojeISO()).toLowerCase()}${cli ? `, no cliente **${cli.nome}**` : " (sem cliente: dá para escolher em Tarefas)"}.`,
    links: [{ rotulo: "Abrir Tarefas", href: "/tarefas" }],
  };
}

/** "terminei a tarefa do criativo do Kiko" → a tarefa aberta mais parecida vira feita. */
async function concluirTarefa(texto: string): Promise<Resposta> {
  const palavras = (s: string) => sem(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 4);
  const pedidas = new Set(palavras(texto.replace(/^\s*\S+\s*/, "")));
  const [tarefas, clientes] = await Promise.all([listarTarefas(), clientesAtivos()]);
  const nome = new Map(clientes.map((c) => [c.id, c.nome]));
  const pontos = tarefas.filter((t) => !t.feita).map((t) => {
    const ps = palavras(`${t.titulo} ${t.clienteId ? nome.get(t.clienteId) ?? "" : ""}`);
    return { t, p: ps.filter((w) => pedidas.has(w)).length };
  }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
  if (!pontos.length) return { resposta: "Não achei essa tarefa entre as abertas. Diga parte do título (ex.: “terminei a tarefa de trocar o criativo do Kiko”)." };
  if (pontos.length > 1 && pontos[1].p === pontos[0].p) {
    return { resposta: `Fiquei em dúvida entre:\n${pontos.filter((x) => x.p === pontos[0].p).slice(0, 5).map((x) => `- ${x.t.titulo}${x.t.clienteId ? ` (${nome.get(x.t.clienteId) ?? ""})` : ""}`).join("\n")}\nDiga com mais detalhe qual foi.` };
  }
  const t = pontos[0].t;
  await mudarTarefa(t.id, { feita: true });
  return { resposta: `✓ Marquei como feita: **${t.titulo}**${t.clienteId ? ` (${nome.get(t.clienteId) ?? ""})` : ""}.` };
}

/** "marca reunião com a Vidros Inova quinta 15h" → Google Agenda (com Meet). Sem agenda conectada: vira tarefa. */
async function novaReuniao(texto: string, clienteId?: string): Promise<Resposta> {
  const clientes = await clientesAtivos();
  let cli = clienteId ? clientes.find((c) => c.id === clienteId) ?? null : null;
  if (!cli) {
    try { cli = acharCliente(texto, clientes) as (typeof clientes)[number]; } catch (e) {
      return { resposta: `${e instanceof Error ? e.message : e} (ex.: “marca reunião com a Vidros Inova quinta às 15h”)` };
    }
  }
  const { data } = dataDoTexto(texto);
  const horario = horarioDoTexto(texto);
  const hora = horario?.inicio ?? null;
  if (!data || !hora) {
    return { resposta: `Para marcar com **${cli.nome}**, diga ${!data && !hora ? "o dia e o horário" : !data ? "o dia" : "o horário"} (ex.: “quinta às 15h”, “amanhã 9h30”, “dia 20 às 14h”).` };
  }
  const t = sem(texto);
  const minutos = duracaoDoTexto(texto);
  const fimTxt = horario?.fim ? ` às ${horario.fim}` : ` (${minutos} min)`;
  if (!(await contasAgenda()).length) {
    await criarTarefa({ texto: `Reunião com ${cli.nome} às ${hora}`, clienteId: cli.id, data: data! });
    return {
      resposta: `O Google Agenda ainda não está conectado, então anotei como tarefa: **reunião com ${cli.nome}**, ${rotuloData(data, hojeISO()).toLowerCase()} às ${hora}.`,
      links: [{ rotulo: "Conectar o Google Agenda", href: "/configuracoes#agenda" }],
    };
  }
  const ev = await marcarReuniao({ titulo: `Reunião · ${cli.nome}`, inicio: `${data}T${hora}`, minutos, clienteId: cli.id, meet: !/sem meet|presencial/.test(t) });
  return {
    resposta: `✓ Reunião marcada no Google Agenda com **${cli.nome}**: ${rotuloData(data, hojeISO()).toLowerCase()}, das ${hora}${fimTxt.replace(" às ", " às ")}.${ev.meet ? `\nMeet: ${ev.meet}` : ""}`,
    links: [...(ev.link ? [{ rotulo: "Abrir na agenda", href: ev.link }] : []), { rotulo: cli.nome, href: `/clientes/${cli.id}` }],
  };
}

/** "quais reuniões eu tenho amanhã?", "como está minha agenda essa semana?" */
async function verAgenda(texto: string): Promise<Resposta> {
  if (!(await contasAgenda()).length) return { resposta: "O Google Agenda ainda não está conectado.", links: [{ rotulo: "Conectar o Google Agenda", href: "/configuracoes#agenda" }] };
  const hoje = hojeISO();
  const t = sem(texto);
  const semana = /\bsemana\b/.test(t);
  const { data } = dataDoTexto(texto);
  const dia = data ?? hoje;
  const eventos = await proximosEventos(semana ? 7 : Math.max(1, Math.round((Date.parse(dia) - Date.parse(hoje)) / 86_400_000) + 1));
  const diaDe = (e: Evento) => (e.diaInteiro ? e.inicio : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(e.inicio)));
  const lista = semana ? eventos : eventos.filter((e) => diaDe(e) === dia);
  const titulo = semana ? "Agenda dos próximos 7 dias" : `Agenda de ${rotuloData(dia, hoje).toLowerCase()}`;
  if (!lista.length) return { resposta: `${titulo}: nada marcado.`, links: [{ rotulo: "Abrir Tarefas", href: "/tarefas" }] };
  const linhas = lista.map((e) => `- ${semana ? `${rotuloData(diaDe(e), hoje)}, ` : ""}${e.diaInteiro ? "dia inteiro" : horaBR(e.inicio)}: ${e.titulo}${e.meet ? " (Meet)" : ""}`);
  return { resposta: `## ${titulo} (${lista.length})\n${linhas.join("\n")}`, links: [{ rotulo: "Abrir Tarefas", href: "/tarefas" }] };
}

/** Pergunta geral ("quais clientes estão com custo alto?"): IA com os números dos últimos 7 dias de todos os clientes. */
async function perguntaGeral(texto: string): Promise<Resposta> {
  const { atual, anterior } = resolverPeriodo({ p: "7" });
  const [resumos, tarefas, contas] = await Promise.all([resumoClientes(atual, anterior), listarTarefas(), alertasContas().catch(() => [])]);
  const hoje = hojeISO();
  const abertas = tarefas.filter((t) => !t.feita);
  const L = [`HOJE: ${hoje}. NÚMEROS DOS ÚLTIMOS 7 DIAS (${atual.desde} a ${atual.ate}) vs 7 anteriores, Meta + Google:`];
  for (const r of resumos) {
    const c = r.cliente, a = r.geral.atual, b = r.geral.anterior;
    const t = abertas.filter((x) => x.clienteId === c.id);
    L.push(`- ${c.nome} [${c.empresa || EMPRESA_PADRAO}${c.nicho ? `, ${c.nicho}` : ""}]: gasto ${dinheiro(a.gasto)} (antes ${dinheiro(b.gasto)}), resultados ${inteiro(a.resultados)} (antes ${inteiro(b.resultados)}), custo/resultado ${dinheiro(a.cpr)}${c.cpl_meta ? ` (meta ${dinheiro(c.cpl_meta)})` : ""}; saúde ${r.saude}; mês: gasto ${dinheiro(r.mes.gasto)}${c.orcamento_mensal ? ` de ${dinheiro(c.orcamento_mensal)}` : ""}; tarefas abertas ${t.length}${t.some((x) => x.data < hoje) ? " (com atrasadas)" : ""}`);
  }
  if (contas.length) L.push(`CONTAS COM PROBLEMA: ${contas.map((a) => `${a.clienteNome} (${a.mensagem})`).join("; ")}`);
  const sistema = `Você é o assistente de um gestor de tráfego pago. Responda à pergunta usando SÓ os números abaixo.
Português do Brasil, direto, em poucas linhas ou tópicos curtos com **negrito** nos nomes. Se a pergunta pedir algo que os dados não têm, diga o que falta.
Não invente números. Se fizer sentido, termine com uma ação sugerida.`;
  const resposta = await perguntarIA(sistema, `${L.join("\n")}\n\nPERGUNTA: ${texto}`, { temperatura: 0.3 });
  return { resposta };
}

/**
 * Responde a um pedido. `clienteId`: a tela do cliente (a tarefa e a reunião já são dele).
 * Devolve null quando o pedido é de análise de um cliente (quem chama segue com a análise de sempre).
 */
export async function responder(texto: string, ctx: { clienteId?: string; geralSeNaoAchar?: boolean } = {}): Promise<Resposta | null> {
  const intencao = intencaoDo(texto);
  if (intencao === "resumo" && !ctx.clienteId) return resumoDoDia();
  if (intencao === "tarefa") return novaTarefa(texto, ctx.clienteId);
  if (intencao === "concluir") return concluirTarefa(texto);
  if (intencao === "reuniao") return novaReuniao(texto, ctx.clienteId);
  if (intencao === "agenda") return verAgenda(texto);
  if (intencao === "campanha") return null; // quem chama abre a montagem com o esboço
  if (ctx.clienteId || !ctx.geralSeNaoAchar) return null;
  // cita um cliente: é análise (quem chama faz); senão, pergunta geral
  try {
    acharCliente(texto, await clientesAtivos());
    return null;
  } catch {
    return perguntaGeral(texto);
  }
}

