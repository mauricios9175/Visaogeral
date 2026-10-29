"use client";

import { useState } from "react";
import { salvarModeloFormulario } from "@/app/acoes-modelos";
import { IDIOMAS_FORMULARIO, normalizarFormulario, PERGUNTAS_PADRAO, type ConfigFormulario, type ModeloFormulario, type PerguntaForm } from "@/lib/modelos";
import { BotaoEnviar } from "./botao";
import { campo } from "./campos-meta";

const rotulo = "block space-y-1 text-sm";
const dica = "text-xs text-texto-3";

/** Editor de modelo de formulário instantâneo: perguntas, introdução, política de privacidade e tela final. */
export function EditorFormulario({ modelo }: { modelo?: ModeloFormulario }) {
  const [f, setF] = useState<ConfigFormulario>(normalizarFormulario(modelo?.config));
  const set = <K extends keyof ConfigFormulario>(k: K, v: ConfigFormulario[K]) => setF({ ...f, [k]: v });
  const temPadrao = (tipo: PerguntaForm["tipo"]) => f.perguntas.some((p) => p.tipo === tipo);
  const alternarPadrao = (tipo: PerguntaForm["tipo"]) =>
    set("perguntas", temPadrao(tipo)
      ? f.perguntas.filter((p) => p.tipo !== tipo)
      // perguntas padrão ficam antes das personalizadas, na ordem da lista
      : [...f.perguntas.filter((p) => p.tipo !== "CUSTOM"), { tipo, rotulo: "", opcoes: [] }, ...f.perguntas.filter((p) => p.tipo === "CUSTOM")]
          .sort((a, b) => ordem(a) - ordem(b)));
  const ordem = (p: PerguntaForm) => (p.tipo === "CUSTOM" ? 99 : PERGUNTAS_PADRAO.findIndex((x) => x.tipo === p.tipo));
  const personalizadas = f.perguntas.map((p, i) => ({ p, i })).filter(({ p }) => p.tipo === "CUSTOM");
  const mudarPergunta = (i: number, nova: Partial<PerguntaForm>) => set("perguntas", f.perguntas.map((p, j) => (j === i ? { ...p, ...nova } : p)));

  return (
    <form action={salvarModeloFormulario} className="space-y-5 rounded-xl border border-borda bg-superficie p-4">
      <input type="hidden" name="id" value={modelo?.id ?? ""} />
      <input type="hidden" name="config" value={JSON.stringify(f)} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className={rotulo}>Nome do modelo
          <input name="nome" required defaultValue={modelo?.nome} placeholder="Ex.: Planejados – orçamento" className={campo} />
        </label>
        <label className={rotulo}>Nome do formulário no Meta
          <input value={f.nome} onChange={(e) => set("nome", e.target.value)} className={campo} />
          <span className={dica}>Aceita {"{cliente}"} e {"{data}"}.</span>
        </label>
        <label className={rotulo}>Tipo
          <select value={f.tipo} onChange={(e) => set("tipo", e.target.value as ConfigFormulario["tipo"])} className={campo}>
            <option value="intencao">Maior intenção (tela de revisão antes de enviar)</option>
            <option value="volume">Mais volume</option>
          </select>
        </label>
      </div>

      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Introdução <span className="font-normal text-texto-3">(opcional)</span></legend>
        <label className={rotulo}>Título<input value={f.introTitulo} onChange={(e) => set("introTitulo", e.target.value)} placeholder="Ex.: Seu projeto sob medida" className={campo} /></label>
        <label className={rotulo}>Texto<input value={f.introTexto} onChange={(e) => set("introTexto", e.target.value)} placeholder="Ex.: Responda 3 perguntas e receba o orçamento" className={campo} /></label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Perguntas</legend>
        <label className={rotulo}>Título da página de perguntas <span className={dica}>(opcional)</span>
          <input value={f.tituloPerguntas} onChange={(e) => set("tituloPerguntas", e.target.value)} placeholder="Ex.: Conte um pouco sobre o seu projeto" className={campo} />
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          {PERGUNTAS_PADRAO.map((p) => (
            <label key={p.tipo} className="flex items-center gap-1">
              <input type="checkbox" checked={temPadrao(p.tipo)} onChange={() => alternarPadrao(p.tipo)} /> {p.rotulo}
            </label>
          ))}
        </div>
        <p className={dica}>Essas o Meta preenche sozinho com os dados do perfil da pessoa.</p>
        {personalizadas.map(({ p, i }, n) => (
          <div key={i} className="space-y-2 rounded-lg border border-borda bg-fundo p-3">
            <div className="flex items-end gap-2">
              <label className={`${rotulo} flex-1`}>Pergunta personalizada {n + 1}
                <input value={p.rotulo} onChange={(e) => mudarPergunta(i, { rotulo: e.target.value })} placeholder="Ex.: Qual ambiente você quer planejar?" className={campo} />
              </label>
              <button type="button" onClick={() => set("perguntas", f.perguntas.filter((_, j) => j !== i))} className="pb-2 text-xs text-texto-3 underline hover:text-critico">remover</button>
            </div>
            <label className={rotulo}>Opções de resposta <span className={dica}>(uma por linha; vazio = resposta livre)</span>
              <textarea
                rows={3} value={p.opcoes.join("\n")}
                onChange={(e) => mudarPergunta(i, { opcoes: e.target.value.split("\n") })}
                placeholder={"Cozinha\nQuarto\nCasa toda"} className={campo}
              />
            </label>
          </div>
        ))}
        <button type="button" onClick={() => set("perguntas", [...f.perguntas, { tipo: "CUSTOM", rotulo: "", opcoes: [] }])}
          className="rounded-lg border border-dashed border-borda px-3 py-1.5 text-sm text-texto-2 hover:border-destaque hover:text-texto">
          + Pergunta personalizada
        </button>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Política de privacidade <span className="font-normal text-texto-3">(opcional)</span></legend>
        <label className={rotulo}>Link<input value={f.politicaUrl} onChange={(e) => set("politicaUrl", e.target.value)} placeholder="https://site-do-cliente.com/privacidade" className={campo} /></label>
        <label className={rotulo}>Texto do link<input value={f.politicaTexto} onChange={(e) => set("politicaTexto", e.target.value)} className={campo} /></label>
        <p className={`${dica} md:col-span-2`}>Em branco, o painel reaproveita a política do formulário mais recente da página do cliente (como o Gerenciador faz). Só é preciso preencher se a página ainda não tiver nenhum formulário.</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Configurações</legend>
        <label className={`${rotulo} max-w-xs`}>Idioma do formulário
          <select value={f.idioma} onChange={(e) => set("idioma", e.target.value)} className={campo}>
            {IDIOMAS_FORMULARIO.map((i) => <option key={i.valor} value={i.valor}>{i.rotulo}</option>)}
          </select>
        </label>
        <div className="space-y-2">
          <div className="text-sm">Parâmetros de rastreamento <span className={dica}>(vão junto com cada lead; o Ávora lê como UTM)</span></div>
          {f.parametros.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={p.chave} onChange={(e) => set("parametros", f.parametros.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)))}
                placeholder="utm_campaign" className={`${campo} w-48 font-mono text-xs`} />
              <span className="text-texto-3">=</span>
              <input value={p.valor} onChange={(e) => set("parametros", f.parametros.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                placeholder="valor" className={`${campo} min-w-60 flex-1 font-mono text-xs`} />
              <button type="button" onClick={() => set("parametros", f.parametros.filter((_, j) => j !== i))} className="text-xs text-texto-3 underline hover:text-critico">remover</button>
            </div>
          ))}
          <button type="button" onClick={() => set("parametros", [...f.parametros, { chave: "", valor: "" }])}
            className="rounded-lg border border-dashed border-borda px-3 py-1 text-sm text-texto-2 hover:border-destaque hover:text-texto">
            + Parâmetro
          </button>
          <p className={dica}>
            Aqui vão os valores fixos (ex.: utm_source = facebook). Os dinâmicos, com o nome da campanha, do conjunto e do anúncio,
            ficam nos “Parâmetros de URL do anúncio”, no modelo de campanha.
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Tela de agradecimento</legend>
        <label className={rotulo}>Título<input value={f.agradecimentoTitulo} onChange={(e) => set("agradecimentoTitulo", e.target.value)} className={campo} /></label>
        <label className={rotulo}>Texto<input value={f.agradecimentoTexto} onChange={(e) => set("agradecimentoTexto", e.target.value)} className={campo} /></label>
        <label className={rotulo}>Texto do botão<input value={f.botaoTexto} onChange={(e) => set("botaoTexto", e.target.value)} className={campo} /></label>
        <label className={rotulo}>Link do botão <span className={dica}>(site ou WhatsApp: https://wa.me/5565999999999)</span>
          <input value={f.botaoUrl} onChange={(e) => set("botaoUrl", e.target.value)} placeholder="https://" className={campo} />
        </label>
      </fieldset>

      <BotaoEnviar className="rounded-lg bg-destaque px-4 py-2 text-sm font-medium text-white" aguardando="Salvando…">
        Salvar modelo de formulário
      </BotaoEnviar>
    </form>
  );
}
