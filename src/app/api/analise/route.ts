import { NextResponse, type NextRequest } from "next/server";
import { analisarPedido, analisarPeriodo, clienteDoPedido } from "@/lib/analise";
import { intencaoDo, responder } from "@/lib/assistente";

export const maxDuration = 120;

// Análise em texto com IA (protegido pelo login do painel):
//   { pedido: "últimos 14 dias da Loja X" }            → acha o cliente e o período no texto
//   { pedido?, clienteId }                             → cliente já escolhido; o período vem do texto
//   { clienteId, p, de?, ate? }                        → período da tela (sem texto)
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const pedido = typeof corpo.pedido === "string" ? corpo.pedido.trim().slice(0, 500) : "";
  const clienteId = typeof corpo.clienteId === "string" && corpo.clienteId ? corpo.clienteId : undefined;
  try {
    const intencao = pedido ? intencaoDo(pedido) : null;
    // assistente: reunião, agenda, tarefa, concluir tarefa e resumo do dia
    if (intencao && intencao !== "campanha") {
      const r = await responder(pedido, { clienteId });
      if (r) return NextResponse.json({ assistente: r });
    }
    // "monta uma campanha de formulário para a Loja X": vai para a montagem, que faz o esboço com a IA
    if (intencao === "campanha") {
      const id = clienteId ?? (await clienteDoPedido(pedido)).id;
      // Google: "pesquisa", "palavras-chave", "google"; senão, Meta
      const google = /google|pesquisa|palavras?[- ]chave|adwords/i.test(pedido);
      return NextResponse.json({ ir: `/clientes/${id}/${google ? "montar-google" : "montar"}?pedido=${encodeURIComponent(pedido)}` });
    }
    // sem cliente no texto (e fora da tela de um cliente): pergunta geral, respondida com os números de todos
    if (pedido && !clienteId) {
      const r = await responder(pedido, { geralSeNaoAchar: true });
      if (r) return NextResponse.json({ assistente: r });
    }
    if (pedido) return NextResponse.json(await analisarPedido(pedido, clienteId));
    if (!clienteId) return NextResponse.json({ erro: "Escreva o pedido (ex.: “últimos 14 dias da Loja X”)." }, { status: 400 });
    return NextResponse.json(await analisarPeriodo(clienteId, { p: corpo.p, de: corpo.de, ate: corpo.ate }));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
