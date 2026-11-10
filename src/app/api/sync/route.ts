import { NextResponse, type NextRequest } from "next/server";
import { contasParaSincronizar, importarContas, registrarExecucao, sincronizarContaPorId, type ModoSync } from "@/lib/sync";
import { sincronizarCrmCliente, type ConexaoCrm } from "@/lib/crm/sync";
import { db } from "@/lib/db";

export const maxDuration = 300;

// Sincronização feita pela tela, em pedaços pequenos (protegida pelo login do painel):
//   { etapa: "inicio" }                  → atualiza saldo/status das contas e devolve a lista do que sincronizar
//   { etapa: "conta", id, modo }         → uma conta de anúncio
//   { etapa: "crm", clienteId }          → o CRM de um cliente
//   { etapa: "fim", modo, contas, linhas, erros } → grava no histórico
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  try {
    switch (corpo.etapa) {
      case "inicio": {
        let aviso: string | null = null;
        try {
          await importarContas();
        } catch (e) {
          aviso = `Não foi possível atualizar saldo/status das contas: ${e instanceof Error ? e.message : e}`;
        }
        const contas = await contasParaSincronizar();
        const { data } = await db().from("crm_conexoes").select("cliente_id, tipo, clientes!inner(nome, ativo)").eq("clientes.ativo", true);
        const crms = ((data ?? []) as unknown as { cliente_id: string; clientes: { nome: string } }[])
          .map((c) => ({ id: c.cliente_id, nome: c.clientes.nome }));
        return NextResponse.json({ contas, crms, aviso });
      }
      case "conta": {
        // histórico: um pedaço de até ~31 dias (a tela divide o período em meses)
        const data = /^\d{4}-\d{2}-\d{2}$/;
        if (data.test(String(corpo.desde)) && data.test(String(corpo.ate))) {
          const dias = (Date.parse(corpo.ate) - Date.parse(corpo.desde)) / 86_400_000;
          if (dias < 0 || dias > 31) throw new Error("Intervalo inválido (até 31 dias por vez)");
          return NextResponse.json({ linhas: await sincronizarContaPorId(String(corpo.id), { desde: corpo.desde, ate: corpo.ate }) });
        }
        const modo: ModoSync = corpo.modo === "mes" ? "mes" : corpo.modo === "hoje" ? "hoje" : "semana";
        return NextResponse.json({ linhas: await sincronizarContaPorId(String(corpo.id), modo) });
      }
      case "crm": {
        const { data } = await db().from("crm_conexoes").select("*").eq("cliente_id", String(corpo.clienteId)).maybeSingle();
        if (!data) throw new Error("Cliente sem CRM conectado");
        return NextResponse.json({ linhas: await sincronizarCrmCliente(data as ConexaoCrm, 30) });
      }
      case "historico_feito": {
        // lembra até onde o histórico de cada conta já foi puxado (dias sem gasto não deixam linha nos dados)
        const desde = String(corpo.desde);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error("data inválida");
        for (const id of (Array.isArray(corpo.contas) ? corpo.contas : []).map(String)) {
          const chave = `historico_meta:${id}`;
          const { data: ja } = await db().from("configuracoes").select("valor").eq("chave", chave).maybeSingle();
          const antes = typeof ja?.valor === "string" ? ja.valor : null;
          if (!antes || desde < antes) await db().from("configuracoes").upsert({ chave, valor: desde, atualizado_em: new Date().toISOString() });
        }
        return NextResponse.json({ ok: true });
      }
      case "fim": {
        await registrarExecucao(String(corpo.modo), Number(corpo.contas) || 0, Number(corpo.linhas) || 0, corpo.erros ?? []);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ erro: "etapa inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
