"use client";

import { useEffect, useMemo, useState } from "react";
import { salvarEdicaoMeta } from "@/app/acoes-editar";
import type { Edicao, TextosCriativo } from "@/lib/meta-editar";
import { enviarImagem, enviarVideoAoMeta } from "./enviar-midia";
import { BibliotecaMidia, PlayerVideo, PreviaAnuncio } from "./midia-meta";
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

      {e.nivel === "anuncio" && <PreviaAnuncio conta={contaId} anuncioId={e.id} />}
      {e.nivel === "anuncio" && <EditorAnuncio criativo={e.criativo} contaId={contaId} onChange={(c) => mudar({ criativo: c })} />}

      <BotaoEnviar className="min-h-11 rounded-[10px] bg-destaque px-5 text-sm font-semibold text-white" aguardando="Salvando no Meta…">
        Salvar no Meta
      </BotaoEnviar>
    </form>
  );
}

type Opcao = { id: string; nome: string; arquivado?: boolean };

/** Edição do anúncio, nas seções do Gerenciador: identidade, mídia, texto, destino, botão e UTMs. */
function EditorAnuncio({ criativo: c, contaId, onChange }: { criativo: TextosCriativo; contaId: string; onChange: (c: TextosCriativo) => void }) {
  const set = (x: Partial<TextosCriativo>) => onChange({ ...c, ...x });
  const [ativos, setAtivos] = useState<{ paginas: Opcao[]; instagram: Opcao[]; erro?: string } | null>(null);
  const [formularios, setFormularios] = useState<{ itens: Opcao[]; erro?: string } | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erroMidia, setErroMidia] = useState<string | null>(null);
  const [previa, setPrevia] = useState<{ url: string; video: boolean; videoId?: string } | null>(null);
  const [biblioteca, setBiblioteca] = useState(false);
  const [tocar, setTocar] = useState<{ arquivo?: string; videoId?: string | null } | null>(null);
  const lote = useMemo(() => crypto.randomUUID(), []);
  const post = c.tipo === "post";

  useEffect(() => {
    let vivo = true;
    fetch(`/api/meta/ativos?conta=${encodeURIComponent(contaId)}`).then((r) => r.json()).then((x) => vivo && setAtivos(x))
      .catch(() => vivo && setAtivos({ paginas: [], instagram: [], erro: "Falha ao buscar páginas e Instagram." }));
    return () => { vivo = false; };
  }, [contaId]);
  useEffect(() => {
    if (c.destino !== "formulario" || !c.paginaId) return;
    let vivo = true;
    fetch(`/api/meta/formularios?conta=${encodeURIComponent(contaId)}&pagina=${c.paginaId}`).then((r) => r.json()).then((x) => vivo && setFormularios(x))
      .catch(() => vivo && setFormularios({ itens: [], erro: "Falha ao buscar os formulários." }));
    return () => { vivo = false; };
  }, [c.destino, c.paginaId, contaId]);

  async function trocarMidia(f: File | undefined) {
    if (!f) return;
    setErroMidia(null);
    try {
      if (f.type.startsWith("video/")) {
        const { videoId } = await enviarVideoAoMeta(f, contaId, (pct) => setEnviando(`Enviando ${f.name} para o Meta… ${pct}%`));
        set({ novaMidia: { tipo: "video", videoId } });
      } else {
        setEnviando(`Enviando ${f.name}…`);
        const { caminho } = await enviarImagem(f, lote);
        set({ novaMidia: { tipo: "imagem", caminho } });
      }
      setPrevia({ url: URL.createObjectURL(f), video: f.type.startsWith("video/") });
    } catch (e) {
      setErroMidia(`${f.name}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setEnviando(null);
    }
  }

  const secao = "space-y-3 rounded-2xl border border-borda bg-superficie p-4";
  return (
    <>
      <section className={secao}>
        <h2 className="font-semibold">Identidade</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={rotulo}>Página do Facebook
            <select value={c.paginaId} onChange={(x) => set({ paginaId: x.target.value })} disabled={post} className={campo}>
              {!ativos?.paginas.some((p) => p.id === c.paginaId) && <option value={c.paginaId}>{c.paginaId ? `Página ${c.paginaId}` : "—"}</option>}
              {ativos?.paginas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className={rotulo}>Conta do Instagram
            <select value={c.instagramId} onChange={(x) => set({ instagramId: x.target.value })} disabled={post} className={campo}>
              <option value="">Usar a página do Facebook</option>
              {c.instagramId && !ativos?.instagram.some((p) => p.id === c.instagramId) && <option value={c.instagramId}>Instagram {c.instagramId}</option>}
              {ativos?.instagram.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        </div>
        {ativos?.erro && <p className="text-xs text-critico">{ativos.erro}</p>}
      </section>

      <section className={secao}>
        <h2 className="font-semibold">Mídia</h2>
        <div className="flex flex-wrap items-start gap-5">
          <div className="space-y-1.5 text-xs text-texto-3">
            <div>{c.novaMidia ? "Nova" : "Atual"} ({c.novaMidia ? (c.novaMidia.tipo === "video" ? "vídeo" : "imagem") : c.midia.tipo === "video" ? "vídeo" : c.midia.tipo === "varias" ? "várias" : c.midia.tipo})</div>
            {(() => {
              const video = previa ? previa.video : !c.novaMidia && c.midia.tipo === "video";
              const img = previa ? (previa.video ? null : previa.url) : c.midia.miniatura;
              const abrir = () => setTocar(previa ? (previa.videoId ? { videoId: previa.videoId } : { arquivo: previa.url }) : { videoId: c.midia.videoId });
              return previa?.video && !previa.videoId ? (
                <video src={previa.url} controls playsInline className="max-h-80 w-auto max-w-[300px] rounded-lg border border-borda bg-black" />
              ) : (
                <button type="button" onClick={video ? abrir : undefined} className={`relative block ${video ? "cursor-pointer" : "cursor-default"}`} aria-label={video ? "Assistir com som" : "Mídia"}>
                  {img || (previa?.video && previa.url)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img ?? previa!.url} alt="Mídia" className="max-h-80 w-auto max-w-[300px] rounded-lg border border-borda object-contain" />
                    : <span className="flex h-48 w-48 items-center justify-center rounded-lg border border-dashed border-borda">sem prévia</span>}
                  {video && <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-2xl text-white">▶</span></span>}
                </button>
              );
            })()}
            {(c.midia.tipo === "video" && !c.novaMidia) || previa?.video ? <div>Clique para assistir com som.</div> : null}
          </div>
          {!post && (
            <div className="space-y-2">
              <button type="button" onClick={() => setBiblioteca(true)} className="block rounded-lg border border-borda bg-superficie-2 px-3 py-2 text-sm font-semibold hover:border-destaque">
                Escolher da biblioteca da conta
              </button>
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-borda bg-superficie-2 px-3 py-2 text-sm font-semibold hover:border-destaque">
                Enviar do computador
                <input type="file" accept="image/*,video/*" className="hidden" onChange={(x) => { void trocarMidia(x.target.files?.[0]); x.target.value = ""; }} />
              </label>
              {c.novaMidia && (
                <button type="button" onClick={() => { set({ novaMidia: null }); setPrevia(null); }} className="block text-xs text-texto-3 hover:text-critico">
                  desfazer troca
                </button>
              )}
              {c.midia.tipo === "varias" && <p className="max-w-xs text-xs text-texto-3">Este anúncio tem várias mídias: trocando, fica só a nova.</p>}
              {enviando && <p className="text-xs text-destaque">{enviando}</p>}
              {erroMidia && <p className="text-xs text-critico">{erroMidia}</p>}
            </div>
          )}
        </div>
        {biblioteca && (
          <BibliotecaMidia conta={contaId} onFechar={() => setBiblioteca(false)} onEscolher={([m]) => {
            if (!m) return;
            set({ novaMidia: m.tipo === "video" ? { tipo: "video", videoId: m.id } : { tipo: "imagem", hash: m.id } });
            setPrevia({ url: m.miniatura ?? "", video: m.tipo === "video", ...(m.tipo === "video" ? { videoId: m.id } : {}) });
          }} />
        )}
        {tocar && <PlayerVideo conta={contaId} videoId={tocar.videoId} arquivo={tocar.arquivo} onFechar={() => setTocar(null)} />}
      </section>

      <section className={secao}>
        <h2 className="font-semibold">Texto</h2>
        {post ? (
          <p className="text-sm text-texto-2">Este anúncio usa uma publicação que já existe na página: texto e mídia só mudam na própria publicação. Aqui dá para mudar o nome e os parâmetros de URL.</p>
        ) : (
          <>
            <Lista titulo="Texto principal" linhas={5} valor={c.textos.length ? c.textos : [""]} max={c.tipo === "feed" ? 5 : 1} onChange={(v) => set({ textos: v })} />
            <Lista titulo="Título" valor={c.titulos.length ? c.titulos : [""]} max={c.tipo === "feed" ? 5 : 1} onChange={(v) => set({ titulos: v })} />
            <Lista titulo="Descrição (opcional)" valor={c.descricoes.length ? c.descricoes : [""]} max={c.tipo === "feed" ? 5 : 1} onChange={(v) => set({ descricoes: v })} />
          </>
        )}
      </section>

      {!post && (
        <section className={secao}>
          <h2 className="font-semibold">Destino</h2>
          {c.destino === "formulario" && (
            <label className={rotulo}>Formulário instantâneo
              <select value={c.formularioId} onChange={(x) => set({ formularioId: x.target.value })} className={campo}>
                {!formularios?.itens.some((f) => f.id === c.formularioId) && <option value={c.formularioId}>{formularios ? `Formulário ${c.formularioId}` : "Carregando…"}</option>}
                {formularios?.itens.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.arquivado ? " (arquivado)" : ""}</option>)}
              </select>
              {formularios?.erro && <span className="block text-xs text-critico">{formularios.erro}</span>}
              {c.tipo === "feed" && <span className="block text-xs text-atencao">Anúncio com várias variações: o formulário não muda por aqui (use o Gerenciador).</span>}
            </label>
          )}
          {c.destino === "site" && (
            <label className={rotulo}>Link do site
              <input value={c.link} onChange={(x) => set({ link: x.target.value })} placeholder="https://" className={campo} />
            </label>
          )}
          {c.destino === "whatsapp" && <p className="text-sm text-texto-2">Conversa no WhatsApp (o número é o da página).</p>}
          {c.destino === "outro" && <p className="text-sm text-texto-2">Destino que o painel não edita (fica como está).</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {c.cta && (
              <label className={rotulo}>Botão
                <select value={c.cta} onChange={(x) => set({ cta: x.target.value })} className={campo}>
                  {!BOTOES.some((b) => b.valor === c.cta) && <option value={c.cta}>{c.cta}</option>}
                  {BOTOES.map((b) => <option key={b.valor} value={b.valor}>{b.rotulo}</option>)}
                </select>
              </label>
            )}
            {c.destino !== "whatsapp" && (
              <label className={rotulo}>Parâmetros de URL <span className="text-xs text-texto-3">(UTMs)</span>
                <input value={c.urlTags} onChange={(x) => set({ urlTags: x.target.value })} placeholder="utm_source=facebook&utm_campaign={{campaign.name}}…" className={`${campo} font-mono text-xs`} />
              </label>
            )}
          </div>
        </section>
      )}

      <p className="text-xs text-texto-3">
        O Meta não deixa alterar um criativo que já existe: mudando texto, mídia, destino, identidade ou UTMs, o painel cria um criativo
        novo igual com as mudanças e troca no anúncio (o anúncio volta para análise do Meta). Só o nome muda direto.
      </p>
    </>
  );
}
