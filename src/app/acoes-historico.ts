"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { CAMPOS_AJUSTAVEIS, gravarHistorico, mesDe, preencherHistorico } from "@/lib/historico";
import { hojeISO, somarDias } from "@/lib/datas";
import { DIMENSOES_UTM } from "@/lib/consultas";
import { criarModeloNoDrive, gerarRelatorio, linkApresentacao } from "@/lib/relatorio-slides";

function voltar(clienteId: string, msg: string): never {
  revalidatePath(`/clientes/${clienteId}/historico`);
  redirect(`/clientes/${clienteId}/historico?msg=${encodeURIComponent(msg)}`);
}

const numero = (v: FormDataEntryValue | null) => {
  let s = String(v ?? "").trim().replace(/^R\$\s*/, "").replace(/%$/, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return s === "" || Number.isNaN(Number(s)) ? null : Number(s);
};

/** Busca no Meta, Google e CRM os últimos N meses e grava no histórico. */
export async function buscarHistorico(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const n = Math.min(Math.max(Number(form.get("meses")) || 12, 1), 37);
  let msg: string;
  try {
    const r = await preencherHistorico(clienteId, n);
    msg = `Histórico gravado: ${r.meses} mês(es).` + (r.erros.length ? ` Avisos: ${r.erros.join(" · ")}` : "");
  } catch (e) {
    msg = `Erro: ${e instanceof Error ? e.message : e}`;
  }
  voltar(clienteId, msg);
}

/** Recalcula só o mês atual e o anterior (sem buscar o CRM inteiro de novo). */
export async function atualizarMesesRecentes(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  let msg: string;
  try {
    const hoje = hojeISO();
    const r = await gravarHistorico(clienteId, mesDe(hoje, -1), hoje);
    msg = `Mês atual e anterior atualizados.` + (r.erros.length ? ` Avisos: ${r.erros.join(" · ")}` : "");
  } catch (e) {
    msg = `Erro: ${e instanceof Error ? e.message : e}`;
  }
  voltar(clienteId, msg);
}

/** Correção manual de um mês: campo vazio volta a usar o número automático. */
export async function salvarAjusteMes(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const mes = String(form.get("mes"));
  const ajustes = Object.fromEntries(
    CAMPOS_AJUSTAVEIS.map((c) => [c, numero(form.get(c))] as const).filter(([, v]) => v != null),
  );
  const observacao = String(form.get("observacao") ?? "").trim() || null;
  const { error } = await db().from("historico_mensal")
    .update({ ajustes: Object.keys(ajustes).length ? ajustes : null, observacao })
    .eq("cliente_id", clienteId).eq("mes", mes);
  voltar(clienteId, error ? `Erro: ${error.message}` : "Mês salvo.");
}

/** Sobe o modelo da Propulsão para o Drive do login escolhido (uma vez só). */
export async function criarModeloRelatorio(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  let msg: string;
  try {
    const c = await criarModeloNoDrive(String(form.get("token_id")));
    msg = `Modelo criado no Drive de ${c.email}, na pasta “Relatórios · Visão Geral”: ${linkApresentacao(c.modeloId)}`;
  } catch (e) {
    msg = `Erro ao criar o modelo: ${e instanceof Error ? e.message : e}`;
  }
  voltar(clienteId, msg);
}

/** Copia o modelo e preenche com os números do período escolhido. */
export async function gerarRelatorioSlides(form: FormData) {
  const clienteId = String(form.get("cliente_id"));
  const mes = String(form.get("mes") ?? "");
  let desde = String(form.get("de") ?? "");
  let ate = String(form.get("ate") ?? "");
  if (mes !== "livre") {
    desde = `${mes}-01`;
    ate = [somarDias(mesDe(desde, 1), -1), hojeISO()].sort()[0];
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(desde) || !iso.test(ate) || desde > ate) voltar(clienteId, "Escolha um período válido.");
  const dimensao = (DIMENSOES_UTM.find((d) => d.chave === form.get("dimensao")) ?? DIMENSOES_UTM[1]).chave;
  let msg: string;
  try {
    const r = await gerarRelatorio({ clienteId, desde, ate, dimensao });
    msg = `Relatório de ${r.periodo} pronto: ${r.link}`;
  } catch (e) {
    msg = `Erro ao gerar o relatório: ${e instanceof Error ? e.message : e}`;
  }
  voltar(clienteId, msg);
}

/** Pasta do Drive onde ficam os relatórios deste cliente (escolhida no seletor do Google). */
export async function salvarPastaCliente(clienteId: string, pasta: { id: string; nome: string } | null) {
  const { error } = await db().from("clientes").update({ pasta_drive: pasta }).eq("id", clienteId);
  if (error) throw new Error(`${error.message} (rode o SQL 0017 no Supabase)`);
  revalidatePath(`/clientes/${clienteId}/historico`);
}
