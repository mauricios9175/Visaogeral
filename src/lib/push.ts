import "server-only";
import webpush from "web-push";
import { db } from "./db";
import { alertasContas } from "./consultas";
import { calcularAlertas } from "./alertas";
import { hojeISO } from "./datas";

// Notificações no celular (Web Push, grátis): o app instalado recebe os alertas mesmo fechado.
// As chaves VAPID são geradas na primeira vez e ficam no banco (não precisa configurar nada na Vercel).

type Chaves = { publicKey: string; privateKey: string };
export type Inscricao = { endpoint: string; keys: { p256dh: string; auth: string } };

let chaves: Chaves | null = null;
export async function chavesPush(): Promise<Chaves> {
  if (chaves) return chaves;
  const banco = db();
  const { data, error } = await banco.from("configuracoes").select("valor").eq("chave", "push_vapid").maybeSingle();
  if (error) throw new Error(`${error.message} (rode o SQL 0016 no Supabase)`);
  if (data?.valor) return (chaves = data.valor as Chaves);
  const novas = webpush.generateVAPIDKeys();
  await banco.from("configuracoes").upsert({ chave: "push_vapid", valor: novas, atualizado_em: new Date().toISOString() });
  return (chaves = novas);
}

async function configurar() {
  const c = await chavesPush();
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://localhost";
  webpush.setVapidDetails(site, c.publicKey, c.privateKey);
}

export async function inscrever(i: Inscricao, aparelho: string | null) {
  const { error } = await db().from("push_inscricoes").upsert({ endpoint: i.endpoint, chaves: i.keys, aparelho });
  if (error) throw new Error(/push_inscricoes|relation/.test(error.message) ? `${error.message} (rode o SQL 0021 no Supabase)` : error.message);
}

export async function remover(endpoint: string) {
  await db().from("push_inscricoes").delete().eq("endpoint", endpoint);
}

/** Envia para todos os aparelhos inscritos; aparelhos que saíram (404/410) são removidos. */
export async function enviarParaTodos(aviso: { titulo: string; corpo: string; url?: string; tag?: string }) {
  await configurar();
  const { data } = await db().from("push_inscricoes").select("endpoint, chaves");
  let enviados = 0;
  for (const s of (data ?? []) as { endpoint: string; chaves: Inscricao["keys"] }[]) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.chaves }, JSON.stringify(aviso), { TTL: 6 * 3600 });
      enviados++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await remover(s.endpoint);
    }
  }
  return { aparelhos: data?.length ?? 0, enviados };
}

/**
 * Rotina de hora em hora: manda os alertas críticos (saldo/conta e desempenho) e os de saldo em atenção.
 * O mesmo alerta não é repetido no mesmo dia. Muitos de uma vez viram um resumo.
 */
export async function enviarAvisos() {
  const banco = db();
  const { count } = await banco.from("push_inscricoes").select("endpoint", { count: "exact", head: true });
  if (!count) return { avisos: 0, motivo: "nenhum aparelho inscrito" };
  // bom dia (uma vez por dia, de manhã): vem antes dos alertas
  const { enviarBomDia } = await import("./bom-dia");
  const bomDia = await enviarBomDia().catch((e) => ({ enviado: false, motivo: e instanceof Error ? e.message : String(e) }));
  const [contas, desempenho] = await Promise.all([alertasContas().catch(() => []), calcularAlertas().catch(() => [])]);
  const candidatos = [
    ...contas.map((a) => ({ chave: `conta|${a.clienteId}|${a.contaNome}|${a.mensagem.slice(0, 40)}`, cliente: a.clienteNome, texto: a.mensagem, url: `/clientes/${a.clienteId}`, critico: a.nivel === "critico" })),
    ...desempenho.filter((a) => a.nivel === "critico")
      .map((a) => ({ chave: `desempenho|${a.clienteId}|${a.titulo}`, cliente: a.clienteNome, texto: a.titulo, url: `/clientes/${a.clienteId}`, critico: true })),
  ];
  const dia = hojeISO();
  const chavesDoDia = candidatos.map((c) => `${dia}|${c.chave}`.slice(0, 300));
  const { data: ja } = await banco.from("push_enviados").select("chave").in("chave", chavesDoDia);
  const enviados = new Set((ja ?? []).map((x) => x.chave as string));
  const novos = candidatos.map((c, i) => ({ ...c, chaveDia: chavesDoDia[i] })).filter((c) => !enviados.has(c.chaveDia));
  if (!novos.length) return { avisos: 0, bomDia };

  // até 4 avisos separados; mais que isso, um resumo só (para não encher o celular)
  const lista = novos.sort((a, b) => Number(b.critico) - Number(a.critico));
  if (lista.length <= 4) {
    for (const a of lista) await enviarParaTodos({ titulo: `${a.critico ? "⚠️ " : ""}${a.cliente}`, corpo: a.texto, url: a.url, tag: a.chave });
  } else {
    const clientes = [...new Set(lista.map((a) => a.cliente))];
    await enviarParaTodos({
      titulo: `⚠️ ${lista.length} alertas novos`,
      corpo: `${clientes.slice(0, 4).join(", ")}${clientes.length > 4 ? ` e mais ${clientes.length - 4}` : ""}. Toque para ver.`,
      url: "/alertas", tag: `resumo|${dia}`,
    });
  }
  await banco.from("push_enviados").upsert(lista.map((a) => ({ chave: a.chaveDia })));
  // limpa o que tem mais de 7 dias
  await banco.from("push_enviados").delete().lt("enviado_em", new Date(Date.now() - 7 * 86_400_000).toISOString()).then(() => null, () => null);
  return { avisos: lista.length, bomDia };
}
