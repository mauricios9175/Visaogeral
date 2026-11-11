import { NextResponse, type NextRequest } from "next/server";
import { juntarNaFicha, lerFicha, limparLinks, salvarFicha } from "@/lib/ficha";
import { criarTarefa, listarTarefas } from "@/lib/tarefas";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { revalidatePath } from "next/cache";

// Ficha do cliente (protegido pelo login do painel).
//   GET ?cliente=<id>                                  → { ficha }
//   POST { op: "salvar", clienteId, ficha: {...} }      → { ficha }
//   POST { op: "importar", itens: [{ clienteId | novoCliente: { nome, empresa, ativo, churnEm }, informacoes, links, trello?, tarefa? }] }
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("cliente");
  if (!id) return NextResponse.json({ erro: "cliente?" }, { status: 400 });
  return NextResponse.json({ ficha: await lerFicha(id) });
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  try {
    if (corpo.op === "salvar") {
      return NextResponse.json({ ficha: await salvarFicha(String(corpo.clienteId), corpo.ficha ?? {}) });
    }
    if (corpo.op === "importar") {
      const itens = Array.isArray(corpo.itens) ? corpo.itens.slice(0, 300) : [];
      let fichas = 0, tarefas = 0, criados = 0;
      // tarefa de cartão que já foi importada antes não repete
      const origens = new Set((await listarTarefas()).map((t) => t.origem).filter(Boolean));
      // um de cada vez: várias fichas e a lista de tarefas são lidas e gravadas inteiras
      for (const it of itens) {
        let clienteId = String(it?.clienteId ?? "");
        // cliente que ainda não existe no painel (ex.: os do "Lixo" do Trello): cria, ou reaproveita o de mesmo nome
        if (!clienteId && it?.novoCliente?.nome) {
          const n = it.novoCliente;
          const nome = String(n.nome).trim().slice(0, 120);
          const { data: ja } = await db().from("clientes").select("id").ilike("nome", nome.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(1).maybeSingle();
          if (ja) clienteId = ja.id as string;
          else {
            const ativo = n.ativo !== false;
            const { data: novo, error } = await db().from("clientes").insert({
              nome, empresa: String(n.empresa || EMPRESA_PADRAO).slice(0, 80), ativo,
              ...(!ativo ? { churn_em: /^\d{4}-\d{2}-\d{2}$/.test(String(n.churnEm)) ? n.churnEm : new Date().toISOString().slice(0, 10) } : {}),
            }).select("id").single();
            if (error) throw new Error(`Não consegui criar o cliente “${nome}”: ${error.message}`);
            clienteId = novo.id as string;
            criados++;
          }
        }
        if (!clienteId) continue;
        await juntarNaFicha(clienteId, {
          informacoes: String(it.informacoes ?? "").slice(0, 20_000),
          links: limparLinks(it.links),
          trello: typeof it.trello === "string" && it.trello.startsWith("https://trello.com/") ? it.trello : undefined,
        });
        fichas++;
        const origem = typeof it.cartao === "string" ? `trello:${it.cartao.slice(0, 40)}` : undefined;
        if (it.tarefa?.titulo && !(origem && origens.has(origem))) {
          await criarTarefa({ texto: String(it.tarefa.titulo).slice(0, 300), clienteId, aguardando: !!it.tarefa.aguardando, data: null, origem });
          if (origem) origens.add(origem);
          tarefas++;
        }
      }
      if (criados) revalidatePath("/", "layout");
      return NextResponse.json({ fichas, tarefas, criados });
    }
    return NextResponse.json({ erro: "op inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
