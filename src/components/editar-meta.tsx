"use client";

import { useState } from "react";
import { salvarEdicaoMeta } from "@/app/acoes-editar";
import type { Edicao } from "@/lib/meta-editar";
import { CTAS } from "@/lib/modelos";
import { BotaoEnviar } from "./botao";
import { CampoLocais, CartaoConjunto, campo } from "./campos-meta";

const rotulo = "block space-y-1 text-sm";
const caixa = "space-y-4 rounded-2xl border border-borda bg-superficie p-4";

// todos os botões que o painel conhece (o anúncio pode ser de qualquer objetivo)
const BOTOES = [...new Map(Object.values(CTAS).flat().map((c) => [c.valor, c])).values()];

/** Lista de textos (variações) editável. */
function Lista({ titulo, valor, onChange, linhas = 1, max = 5 }: { titulo: string; valor: string[]; onChange: (v: string[]) => void; linhas?: number; max?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm">{titulo}</div>
      {valor.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          {linhas > 1
            ? <textarea rows={linhas} value={t} onChange={(e) => onChange(valor.map((x, j) => (j === i ? e.target.value : x)))} className={campo} />
            : <input value={t} onChange={(e) => onChange(valor.map((x, j) => (j === i ? e.target.value : x)))} className={campo} />}
          {valor.length > 1 && <button type="button" onClick={() => onChange(valor.filter((_, j) => j !== i))} className="pt-2 text-xs text-texto-3 hover:text-critico" aria-label="Remover">✕</button>}
        </div>
      ))}
      {valor.length < max && <button type="button" onClick={() => onChange([...valor, ""])} className="text-xs text-destaque hover:underline">+ variação</button>}
    </div>
  );
}

/** Tela de edição de campanha, conjunto ou anúncio do Meta. */
export function EditarMeta({ inicial, contaId, voltar }: { inicial: Edicao; contaId: string; voltar: string }) {
  const [e, setE] = useState<Edicao>(inicial);
  const mudar = (x: Partial<Edicao>) => setE((a) => ({ ...a, ...x }) as Edicao);
  return (
    <form action={salvarEdicaoMeta} className="space-y-4">
      <input type="hidden" name="conta_id" value={contaId} />
      <input type="hidden" name="voltar" value={voltar} />
      <input type="hidden" name="edicao" value={JSON.stringify(e)} />

      <section className={caixa}>
        <label className={rotulo}>Nome
          <input value={e.nome} onChange={(x) => mudar({ nome: x.target.value })} className={campo} />
        </label>
        {(e.nivel === "campanha" || e.nivel === "conjunto") && (
          e.orcamento ? (
            <label className={`${rotulo} max-w-xs`}>Orçamento {e.orcamento.tipo === "dia" ? "diário" : "total"} (R$)
              <input type="number" min={1} step="0.01" value={e.orcamento.valor}
                onChange={(x) => mudar({ orcamento: { ...e.orcamento!, valor: Number(x.target.value) } })} className={campo} />
            </label>
          ) : (
            <p className="text-xs text-texto-3">{e.nivel === "conjunto" ? "O orçamento fica na campanha (CBO): edite na campanha." : "O orçamento fica nos conjuntos: edite em cada conjunto."}</p>
          )
        )}
      </section>

      {e.nivel === "conjunto" && (
        <section className={caixa}>
          <h2 className="font-semibold">Público</h2>
          {e.locaisEditaveis ? (
            <div className="space-y-1">
              <div className="text-sm">Locais</div>
              <CampoLocais valor={e.locais} onChange={(v) => mudar({ locais: v })} conta={contaId} />
            </div>
          ) : <p className="text-xs text-atencao">Os locais deste conjunto usam recursos que o painel não edita (ficam como estão).</p>}
          <CartaoConjunto
            indice={0} conjunto={{ ...e.publico, nome: e.nome }} conta={contaId} comOrcamento={false} podeRemover={false}
            onChange={(c) => mudar({ nome: c.nome, publico: { ...c, nome: "" } })} onRemover={() => {}}
          />
          {!e.interessesEditaveis && <p className="text-xs text-atencao">A segmentação detalhada deste conjunto tem mais de um bloco (E/OU): o painel não mexe nela.</p>}
          {e.mantidos.length > 0 && <p className="text-xs text-texto-3">Ficam como estão (o painel não edita): {e.mantidos.join(", ")}.</p>}
        </section>
      )}

      {e.nivel === "anuncio" && (
        <section className={caixa}>
          <h2 className="font-semibold">Anúncio</h2>
          {e.criativo.tipo === "post" ? (
            <p className="text-sm text-texto-2">Este anúncio usa uma publicação que já existe na página: os textos só mudam na própria publicação. Aqui dá para mudar o nome e os parâmetros de URL.</p>
          ) : (
            <>
              <Lista titulo="Texto principal" linhas={4} valor={e.criativo.textos.length ? e.criativo.textos : [""]} max={e.criativo.tipo === "feed" ? 5 : 1}
                onChange={(v) => mudar({ criativo: { ...e.criativo, textos: v } })} />
              <Lista titulo="Título" valor={e.criativo.titulos.length ? e.criativo.titulos : [""]} max={e.criativo.tipo === "feed" ? 5 : 1}
                onChange={(v) => mudar({ criativo: { ...e.criativo, titulos: v } })} />
              <Lista titulo="Descrição (opcional)" valor={e.criativo.descricoes.length ? e.criativo.descricoes : [""]} max={e.criativo.tipo === "feed" ? 5 : 1}
                onChange={(v) => mudar({ criativo: { ...e.criativo, descricoes: v } })} />
              <div className="grid gap-3 md:grid-cols-2">
                {e.criativo.cta && (
                  <label className={rotulo}>Botão
                    <select value={e.criativo.cta} onChange={(x) => mudar({ criativo: { ...e.criativo, cta: x.target.value } })} className={campo}>
                      {!BOTOES.some((b) => b.valor === e.criativo.cta) && <option value={e.criativo.cta}>{e.criativo.cta}</option>}
                      {BOTOES.map((b) => <option key={b.valor} value={b.valor}>{b.rotulo}</option>)}
                    </select>
                  </label>
                )}
                {e.criativo.link && !/fb\.me|api\.whatsapp\.com/.test(e.criativo.link) && (
                  <label className={rotulo}>Link
                    <input value={e.criativo.link} onChange={(x) => mudar({ criativo: { ...e.criativo, link: x.target.value } })} className={campo} />
                  </label>
                )}
              </div>
            </>
          )}
          <label className={rotulo}>Parâmetros de URL <span className="text-xs text-texto-3">(UTMs)</span>
            <input value={e.criativo.urlTags} onChange={(x) => mudar({ criativo: { ...e.criativo, urlTags: x.target.value } })} className={`${campo} font-mono text-xs`} />
          </label>
          <p className="text-xs text-texto-3">
            O Meta não deixa alterar um criativo que já existe: mudando textos, link, botão ou UTMs, o painel cria um criativo novo
            igual (mesma imagem/vídeo) com as mudanças e troca no anúncio. O anúncio volta para análise do Meta.
          </p>
        </section>
      )}

      <BotaoEnviar className="min-h-11 rounded-[10px] bg-destaque px-5 text-sm font-semibold text-white" aguardando="Salvando no Meta…">
        Salvar no Meta
      </BotaoEnviar>
    </form>
  );
}
