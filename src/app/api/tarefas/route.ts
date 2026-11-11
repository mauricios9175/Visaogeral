import { NextResponse, type NextRequest } from "next/server";
import { criarTarefa, descartarSugestao, excluirTarefa, listarTarefas, mudarTarefa, type MudancaTarefa } from "@/lib/tarefas";

// Tarefas (protegido pelo login do painel). Toda resposta devolve a lista inteira, para a tela ficar igual ao banco.
//   GET                                              → { tarefas }
//   POST { op: "criar", texto, clienteId?, data?, aguardando? }
//   POST { op: "mudar", id, mudanca: { titulo?, clienteId?, data?, aguardando?, nota?, feita? } }
//   POST { op: "excluir", id }
//   POST { op: "descartar", chave }   → a sugestão do Dash não volta (até a chave mudar: nova semana/mês)
export async function GET() {
  return NextResponse.json({ tarefas: await listarTarefas() });
}

export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  try {
    switch (corpo.op) {
      case "criar":
        return NextResponse.json({
          tarefas: await criarTarefa({
            texto: String(corpo.texto ?? ""),
            // undefined = descobrir pelo texto; "" = sem cliente (escolhido assim)
            clienteId: corpo.clienteId === undefined ? undefined : String(corpo.clienteId ?? ""),
            data: corpo.data ? String(corpo.data) : null,
            aguardando: !!corpo.aguardando,
            origem: typeof corpo.origem === "string" ? corpo.origem : undefined,
            link: typeof corpo.link === "string" ? corpo.link : undefined,
          }),
        });
      case "mudar": {
        const m = (corpo.mudanca ?? {}) as Record<string, unknown>;
        const mudanca: MudancaTarefa = {};
        if (typeof m.titulo === "string") mudanca.titulo = m.titulo;
        if (typeof m.clienteId === "string" || m.clienteId === null) mudanca.clienteId = m.clienteId as string | null;
        if (typeof m.data === "string") mudanca.data = m.data;
        if (typeof m.aguardando === "boolean") mudanca.aguardando = m.aguardando;
        if (typeof m.nota === "string") mudanca.nota = m.nota;
        if (typeof m.feita === "boolean") mudanca.feita = m.feita;
        return NextResponse.json({ tarefas: await mudarTarefa(String(corpo.id), mudanca) });
      }
      case "descartar":
        await descartarSugestao(String(corpo.chave ?? ""));
        return NextResponse.json({ tarefas: await listarTarefas() });
      case "excluir":
        return NextResponse.json({ tarefas: await excluirTarefa(String(corpo.id)) });
      default:
        return NextResponse.json({ erro: "op inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
