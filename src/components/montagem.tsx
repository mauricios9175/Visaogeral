"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { montarCampanhaMeta, type ResultadoMontagem } from "@/app/acoes-montagem";
import { normalizarConfig, OBJETIVOS, type ConfigMeta, type Modelo } from "@/lib/modelos";
import { CamposMeta, campo } from "./campos-meta";

type Opcao = { id: string; nome: string };
type Ativos = { paginas: Opcao[]; instagram: Opcao[]; pixels: Opcao[]; erro?: string };
export type Criativo = { caminho: string; nome: string; tipo: string; tamanho: number };
export type Padroes = Partial<{ conta: string; pagina: string; instagram: string; formulario: string; pixel: string; locais: ConfigMeta["locais"] }>;

const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque disabled:opacity-60";
const rotulo = "block space-y-1 text-sm";

const tamanho = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.round(b / 1e3)} KB`);

/** Tela de montagem: escolhe o modelo, a conta, a página e os criativos, e cria tudo pausado no Meta. */
export function Montagem({ clienteId, clienteNome, contas, modelos, padroes, modelosFormulario }: {
  clienteId: string;
  clienteNome: string;
  contas: Opcao[];
  modelos: Modelo[];
  padroes: Padroes;
  /** modelos de formulário: na montagem dá para criar um formulário novo na página a partir deles */
  modelosFormulario: Opcao[];
}) {
  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? "");
  const modelo = modelos.find((m) => m.id === modeloId);
  const objetivo = modelo?.objetivo ?? "formulario";
  const [config, setConfig] = useState<ConfigMeta>(() =>
    normalizarConfig({ ...modelos[0]?.config, ...(padroes.locais?.length ? { locais: padroes.locais } : {}) }));
  const [conta, setConta] = useState(contas.some((c) => c.id === padroes.conta) ? padroes.conta! : contas[0]?.id ?? "");
  const [ativos, setAtivos] = useState<Ativos | null>(null);
  const [pagina, setPagina] = useState(padroes.pagina ?? "");
  const [instagram, setInstagram] = useState(padroes.instagram ?? "");
  const [pixel, setPixel] = useState(padroes.pixel ?? "");
  const [formularios, setFormularios] = useState<{ itens: Opcao[]; erro?: string } | null>(null);
  // "modelo:<id>" = criar um formulário novo a partir do modelo; senão o id de um formulário da página
  const [formulario, setFormulario] = useState(
    padroes.formulario || (modelosFormulario[0] ? `modelo:${modelosFormulario[0].id}` : ""));
  const [criativos, setCriativos] = useState<Criativo[]>([]);
  const [manterSemAnuncios, setManterSemAnuncios] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const lote = useMemo(() => crypto.randomUUID(), []);
  const [resultado, enviar, montando] = useActionState<ResultadoMontagem | null, FormData>(montarCampanhaMeta, null);

  // ao trocar de modelo, recarrega os campos dele (mantendo as cidades já escolhidas para o cliente)
  function trocarModelo(id: string) {
    setModeloId(id);
    const m = modelos.find((x) => x.id === id);
    setConfig((atual) => normalizarConfig({ ...m?.config, locais: atual.locais.length ? atual.locais : m?.config.locais ?? [] }));
  }

  // páginas, Instagram e pixels da conta
  useEffect(() => {
    if (!conta) return;
    let vivo = true;
    fetch(`/api/meta/ativos?conta=${encodeURIComponent(conta)}`).then((r) => r.json()).then((a: Ativos) => {
      if (!vivo) return;
      setAtivos(a);
      setPagina((p) => (a.paginas.some((x) => x.id === p) ? p : a.paginas[0]?.id ?? ""));
      setInstagram((p) => (a.instagram.some((x) => x.id === p) ? p : a.instagram[0]?.id ?? ""));
      setPixel((p) => (a.pixels.some((x) => x.id === p) ? p : a.pixels[0]?.id ?? ""));
    }).catch(() => vivo && setAtivos({ paginas: [], instagram: [], pixels: [], erro: "Falha ao buscar os ativos da conta." }));
    return () => { vivo = false; };
  }, [conta]);

  // formulários da página (só no objetivo formulário)
  useEffect(() => {
    if (objetivo !== "formulario" || !pagina) return;
    let vivo = true;
    fetch(`/api/meta/formularios?conta=${encodeURIComponent(conta)}&pagina=${pagina}`).then((r) => r.json()).then((f) => {
      if (!vivo) return;
      setFormularios(f);
      setFormulario((x) => (x.startsWith("modelo:") || f.itens?.some((y: Opcao) => y.id === x) ? x : f.itens?.[0]?.id ?? x));
    }).catch(() => vivo && setFormularios({ itens: [], erro: "Falha ao buscar os formulários." }));
    return () => { vivo = false; };
  }, [objetivo, pagina, conta]);

  async function enviarDoComputador(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErroEnvio(null);
    for (const f of Array.from(arquivos)) {
      setEnviando(`Enviando ${f.name}…`);
      try {
        const r = await fetch("/api/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: f.name, tipo: f.type, lote }),
        }).then((x) => x.json());
        if (r.erro) throw new Error(r.erro);
        const put = await fetch(r.url, { method: "PUT", headers: { "Content-Type": f.type, "x-upsert": "true" }, body: f });
        if (!put.ok) throw new Error(`falha no envio (${put.status})`);
        setCriativos((c) => [...c, { caminho: r.caminho, nome: f.name, tipo: f.type, tamanho: f.size }]);
      } catch (e) {
        setErroEnvio(`${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setEnviando(null);
  }

  if (!modelos.length) {
    return <p className="text-sm">Crie um modelo primeiro em <a href="/modelos" className="text-destaque underline">Modelos</a>.</p>;
  }
  if (!contas.length) {
    return <p className="text-sm">Este cliente não tem conta do Meta vinculada (Configurações → Contas do Meta).</p>;
  }

  const payload = { clienteId, conta, modeloId, objetivo, config, pagina, instagram, formulario, pixel, criativos, manterSemAnuncios };
  const faltando =
    !pagina ? "Escolha a página do Facebook." :
    objetivo === "formulario" && !formulario ? "Escolha o formulário." :
    objetivo === "site" && !config.url ? "Informe o link do site." :
    !config.locais.length ? "Escolha pelo menos uma localização." :
    !criativos.length ? "Adicione pelo menos um criativo." :
    !config.textos.some((t) => t.trim()) ? "Escreva o texto principal." : null;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 rounded-xl border border-borda bg-superficie p-4 md:grid-cols-2">
        <label className={rotulo}>Modelo
          <select value={modeloId} onChange={(e) => trocarModelo(e.target.value)} className={campo}>
            {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {OBJETIVOS[m.objetivo]?.rotulo}</option>)}
          </select>
        </label>
        <label className={rotulo}>Conta de anúncio
          <select value={conta} onChange={(e) => setConta(e.target.value)} className={campo}>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        {ativos?.erro && <p className="text-sm text-critico md:col-span-2">{ativos.erro}</p>}
        <label className={rotulo}>Página do Facebook
          {ativos && !ativos.paginas.length ? (
            // nenhuma página encontrada: dá para colar o ID (Configurações da página → Transparência da página)
            <input value={pagina} onChange={(e) => setPagina(e.target.value.trim())} placeholder="Cole o ID da página" className={campo} />
          ) : (
            <select value={pagina} onChange={(e) => setPagina(e.target.value)} className={campo}>
              {!ativos && <option>Carregando…</option>}
              {ativos?.paginas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          )}
        </label>
        <label className={rotulo}>Instagram
          <select value={instagram} onChange={(e) => setInstagram(e.target.value)} className={campo}>
            <option value="">Usar a página do Facebook</option>
            {ativos?.instagram.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        {objetivo === "formulario" && (
          <label className={rotulo}>Formulário instantâneo
            {formularios?.itens.length || modelosFormulario.length ? (
              <select value={formulario} onChange={(e) => setFormulario(e.target.value)} className={campo}>
                {modelosFormulario.length > 0 && (
                  <optgroup label="Criar formulário novo a partir do modelo">
                    {modelosFormulario.map((m) => <option key={m.id} value={`modelo:${m.id}`}>✚ {m.nome}</option>)}
                  </optgroup>
                )}
                {!!formularios?.itens.length && (
                  <optgroup label="Formulários que já existem na página">
                    {formularios.itens.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </optgroup>
                )}
              </select>
            ) : (
              <input value={formulario} onChange={(e) => setFormulario(e.target.value)} placeholder="ID do formulário" className={campo} />
            )}
            {formulario.startsWith("modelo:") && <span className="block text-xs text-texto-3">O formulário é criado na página na hora de montar.</span>}
            {formularios?.erro && !formulario.startsWith("modelo:") && (
              <span className="block text-xs text-texto-3">{formularios.erro} Use um modelo de formulário (menu Modelos) ou cole o ID.</span>
            )}
          </label>
        )}
        {objetivo === "site" && (
          <label className={rotulo}>Pixel
            <select value={pixel} onChange={(e) => setPixel(e.target.value)} className={campo}>
              {ativos?.pixels.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        )}
        {objetivo === "mensagens" && (
          <p className="text-xs text-texto-3 md:col-span-2">
            O WhatsApp usado é o número conectado à página escolhida (Configurações da página → WhatsApp).
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-borda bg-superficie p-4">
        <h2 className="font-medium">Criativos</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className={`${botao} cursor-pointer`}>
            Escolher do computador
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="hidden"
              onChange={(e) => { enviarDoComputador(e.target.files); e.target.value = ""; }} disabled={!!enviando} />
          </label>
          <span className="text-xs text-texto-3">Imagens (JPG, PNG, WEBP) e vídeos (MP4, MOV). Dá para escolher vários de uma vez.</span>
        </div>
        {enviando && <p className="text-sm text-texto-2">⏳ {enviando}</p>}
        {erroEnvio && <p className="text-sm text-critico">{erroEnvio}</p>}
        {criativos.length > 0 && (
          <ul className="divide-y divide-borda text-sm">
            {criativos.map((c, i) => (
              <li key={c.caminho} className="flex items-center gap-3 py-1.5">
                <span className="w-6 text-texto-3">{i + 1}</span>
                <span>{c.tipo.startsWith("video") ? "▶" : "🖼"}</span>
                <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                <span className="text-xs text-texto-3">{c.tamanho ? tamanho(c.tamanho) : ""}</span>
                <button type="button" onClick={() => setCriativos((x) => x.filter((y) => y.caminho !== c.caminho))} className="text-texto-3 hover:text-critico">remover</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-texto-3">Cada criativo vira um anúncio em cada conjunto, com os textos do modelo. Normalmente basta um: depois é só duplicar e trocar a imagem.</p>
      </section>

      <section className="rounded-xl border border-borda bg-superficie p-4">
        <CamposMeta objetivo={objetivo} valor={config} onChange={setConfig} conta={conta} naMontagem />
      </section>

      <form action={enviar} className="space-y-3">
        <input type="hidden" name="payload" value={JSON.stringify(payload)} />
        {faltando && <p className="text-sm text-atencao">▲ {faltando}</p>}
        <label className="flex items-center gap-2 text-sm text-texto-2">
          <input type="checkbox" checked={manterSemAnuncios} onChange={(e) => setManterSemAnuncios(e.target.checked)} />
          Se o Meta barrar os anúncios, manter a campanha, os conjuntos e o formulário criados (pausados) para eu subir o anúncio no Gerenciador
        </label>
        <button
          disabled={!!faltando || montando || !!enviando}
          onClick={(e) => { if (!confirm(`Criar a campanha de ${clienteNome} no Meta? Tudo vai ser criado PAUSADO.`)) e.preventDefault(); }}
          className="rounded-lg bg-destaque px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {montando ? "Montando no Meta… (vídeos podem levar alguns minutos)" : "Montar campanha pausada no Meta"}
        </button>
      </form>

      {resultado && (
        <div className={`space-y-1 rounded-xl border p-4 text-sm ${resultado.ok ? "border-bom bg-bom-bg" : "border-critico bg-critico-bg"}`}>
          <p className="font-medium">{resultado.mensagem}</p>
          {resultado.detalhes.map((d, i) => <p key={i}>{d}</p>)}
          {resultado.link && <a href={resultado.link} target="_blank" rel="noreferrer" className="text-destaque underline">Abrir no Gerenciador ↗</a>}
        </div>
      )}
    </div>
  );
}
