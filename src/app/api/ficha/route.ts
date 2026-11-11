import { NextResponse, type NextRequest } from "next/server";
import { juntarNaFicha, lerFicha, limparLinks, salvarFicha } from "@/lib/ficha";
import { criarTarefa } from "@/lib/tarefas";

// Ficha do cliente (protegido pelo login do painel).
//   GET ?cliente=<id>                                  → { ficha }
//   POST { op: "salvar", clienteId, ficha: {...} }      → { ficha }
//   POST { op: "importar", itens: [{ clienteId, informacoes, links, trello?, tarefa?: { titulo, aguardando } }] }
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
      let fichas = 0, tarefas = 0;
      // um de cada vez: várias fichas e a lista de tarefas são lidas e gravadas inteiras
      for (const it of itens) {
        const clienteId = String(it?.clienteId ?? "");
        if (!clienteId) continue;
        await juntarNaFicha(clienteId, {
          informacoes: String(it.informacoes ?? "").slice(0, 20_000),
          links: limparLinks(it.links),
          trello: typeof it.trello === "string" && it.trello.startsWith("https://trello.com/") ? it.trello : undefined,
        });
        fichas++;
        if (it.tarefa?.titulo) {
          await criarTarefa({ texto: String(it.tarefa.titulo).slice(0, 300), clienteId, aguardando: !!it.tarefa.aguardando, data: null });
          tarefas++;
        }
      }
      return NextResponse.json({ fichas, tarefas });
    }
    return NextResponse.json({ erro: "op inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
