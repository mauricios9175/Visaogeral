"use client";

import { useState } from "react";

export type ClienteImport = { id: string; nome: string; empresa: string; ativo: boolean };

type Item = {
  cardId: string; nome: string; lista: string; trello: string;
  informacoes: string; links: { rotulo: string; url: string }[];
  senhas: number; tarefa: { titulo: string; aguardando: boolean } | null;
  clienteId: string; // "" = não importar; NOVO = criar o cliente no painel
  novo: { nome: string; empresa: string; ativo: boolean; churnEm: string | null };
};

const NOVO = "__novo__";
const EMPRESAS_NOVO = ["Propulsão", "Viccon", "Clientes próprios"];

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LISTAS_IGNORADAS = /guia de introdu/i;
const PALAVRAS_FRACAS = new Set(["viccon", "propulsao", "cliente", "clientes", "loja", "grupo", "studio", "estudio", "moveis", "vidros", "esquadrias", "planejados", "ate", "dia"]);

/** Nome do cartão sem "(Viccon)", "(até dia 15)" etc. */
const limparNome = (n: string) => n.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

function palavras(n: string) {
  // 2 letras contam ("SP", "MG": Tessaro SP ≠ Tessaro MG); "e", "de" não
  return sem(limparNome(n)).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 2 && !["de", "da", "do", "e"].includes(w));
}

/** Cliente do painel com o nome mais parecido com o do cartão (ou nenhum). */
function casar(nomeCartao: string, clientes: ClienteImport[]): string {
  const pc = palavras(nomeCartao);
  if (!pc.length) return "";
  const alvo = pc.join(" ");
  let melhor = { id: "", pontos: 0 };
  for (const c of clientes) {
    const pn = palavras(c.nome);
    const nome = pn.join(" ");
    let pontos = 0;
    if (nome === alvo) pontos = 1000;
    else if (nome && (alvo.includes(nome) || nome.includes(alvo))) pontos = 500 + Math.min(nome.length, alvo.length);
    else {
      // palavras em comum: só vale se forem mais da metade das palavras dos dois nomes
      // ("Bruno Ricci" não é "Bruno Box Caju"; "All Sis Brasil" não é "Madeireira Pau Brasil")
      const comuns = pc.filter((w) => pn.includes(w));
      const fortes = comuns.filter((w) => !PALAVRAS_FRACAS.has(w));
      if (fortes.length && comuns.length / Math.max(pc.length, pn.length) > 0.5) pontos = fortes.reduce((s, w) => s + w.length, 0);
    }
    if (pontos > melhor.pontos) melhor = { id: c.id, pontos };
  }
  return melhor.pontos >= 4 ? melhor.id : "";
}

/** Descrição do Trello (markdown) em texto simples; linhas com senha saem. */
function textoDoTrello(desc: string) {
  let senhas = 0;
  const linhas = desc
    .replace(/‌/g, "")
    .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, txt: string, url: string) => {
      const t = txt.replace(/\\_/g, "_").trim(), u = url.replace(/\\_/g, "_");
      return !t || t === u || u === `mailto:${t}` ? (u.startsWith("mailto:") ? u.slice(7) : u) : `${t} (${u})`;
    })
    .replace(/\\([_*#\-[\]])/g, "$1")
    .split("\n");
  const saida: string[] = [];
  // com senha no cartão, o usuário/login que acompanha também sai
  const temSenha = linhas.some((l) => /\b(senha|password|pwd)\b/i.test(l));
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (temSenha && /^\W*(usu[aá]rio|user(name)?|login)\b\s*[:=-]/i.test(l.trim())) {
      saida.push("🔒 (usuário removido junto com a senha)");
      continue;
    }
    if (/\b(senha|password|pwd)\b/i.test(l)) {
      senhas++;
      saida.push("🔒 (senha removida na importação: guarde no gerenciador de senhas)");
      // "Senha:" sozinha na linha: a senha está na próxima linha com texto
      if (/^\W*(senha|password|pwd)\W*$/i.test(l.trim())) {
        while (i + 1 < linhas.length && !linhas[i + 1].trim()) i++;
        i++;
      }
      continue;
    }
    saida.push(l);
  }
  return { texto: saida.join("\n").replace(/\n{3,}/g, "\n\n").trim(), senhas };
}

type CartaoTrello = {
  id: string; name: string; desc: string; closed: boolean; idList: string; shortUrl: string; idChecklists: string[]; dateLastActivity?: string;
  attachments?: { name?: string; url?: string; isUpload?: boolean }[];
};
type Quadro = {
  lists: { id: string; name: string; closed: boolean }[];
  cards: CartaoTrello[];
  checklists: { id: string; name: string; checkItems: { name: string; state: string }[] }[];
};

export function lerQuadro(json: Quadro, clientes: ClienteImport[]): Item[] {
  if (!Array.isArray(json?.cards) || !Array.isArray(json?.lists)) throw new Error("Este arquivo não parece um quadro do Trello exportado em JSON.");
  const listas = new Map(json.lists.map((l) => [l.id, l]));
  const checklists = new Map((json.checklists ?? []).map((c) => [c.id, c]));
  const itens: Item[] = [];
  for (const c of json.cards) {
    const lista = listas.get(c.idList);
    if (c.closed || !lista || lista.closed || LISTAS_IGNORADAS.test(lista.name)) continue;
    const { texto, senhas } = textoDoTrello(c.desc ?? "");
    // checklists: o que está pendente e o que já foi marcado (vira histórico do que foi feito)
    const itensCk = (c.idChecklists ?? []).flatMap((id) => checklists.get(id)?.checkItems ?? []);
    const pendentes = itensCk.filter((x) => x.state !== "complete").map((x) => x.name.trim());
    const feitos = itensCk.filter((x) => x.state === "complete").map((x) => x.name.trim());
    const informacoes = [
      texto,
      pendentes.length ? `Pendências do checklist do Trello:\n${pendentes.map((p) => `- ${p}`).join("\n")}` : "",
      feitos.length ? `Já feito (checklist do Trello):\n${feitos.map((p) => `✓ ${p}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    const urls = [
      ...(c.attachments ?? []).filter((a) => a.url && !a.isUpload).map((a) => a.url!),
      ...[...(c.desc ?? "").matchAll(/https?:\/\/[^\s)"\]]+/g)].map((m) => m[0].replace(/\\_/g, "_")),
    ];
    const links = [...new Set(urls)].map((url) => ({ rotulo: "", url }));
    if ((c.attachments ?? []).some((a) => a.isUpload)) links.push({ rotulo: "Arquivos no Trello", url: c.shortUrl });
    const nomeLista = sem(lista.name);
    const tarefa = nomeLista.includes("falta informacao") ? { titulo: "Aguardando informações do cliente (veio do Trello)", aguardando: true }
      : nomeLista.includes("coisas a fazer") ? { titulo: "Ver pendências (veio do Trello)", aguardando: false } : null;
    const achado = casar(c.name, clientes);
    const lixo = /lixo/.test(nomeLista);
    const temConteudo = !!informacoes || links.length > 0;
    // cliente que ainda não está no painel: os do "Lixo" (ex-clientes) entram como inativos, com o que tinha no cartão
    const empresa = /viccon/i.test(c.name) || /viccon/.test(nomeLista) ? "Viccon" : /propulsao/.test(nomeLista) ? "Propulsão" : "Clientes próprios";
    itens.push({
      cardId: c.id, nome: c.name, lista: lista.name, trello: c.shortUrl, informacoes, links, senhas, tarefa,
      clienteId: achado || (lixo && temConteudo ? NOVO : ""),
      novo: { nome: limparNome(c.name) || c.name, empresa, ativo: !lixo, churnEm: lixo ? (c.dateLastActivity ?? "").slice(0, 10) || null : null },
    });
  }
  return itens;
}

export function ImportarTrello({ clientes }: { clientes: ClienteImport[] }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comTarefas, setComTarefas] = useState(true);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  async function escolherArquivo(arq: File | undefined) {
    setErro(null);
    setEstado(null);
    if (!arq) return;
    try {
      setItens(lerQuadro(JSON.parse(await arq.text()) as Quadro, clientes));
    } catch (e) {
      setItens(null);
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  const escolhidos = (itens ?? []).filter((x) => x.clienteId);
  const repetidos = new Set(escolhidos.map((x) => x.clienteId).filter((id, i, a) => a.indexOf(id) !== i));

  async function importar() {
    setOcupado(true);
    setErro(null);
    try {
      // em partes, para não estourar o tempo do servidor
      let fichas = 0, tarefas = 0, criados = 0;
      for (let i = 0; i < escolhidos.length; i += 15) {
        setEstado(`Importando ${Math.min(i + 15, escolhidos.length)} de ${escolhidos.length}…`);
        const parte = escolhidos.slice(i, i + 15).map((x) => ({
          ...(x.clienteId === NOVO ? { novoCliente: x.novo } : { clienteId: x.clienteId }),
          informacoes: x.informacoes, links: x.links, trello: x.trello, cartao: x.cardId,
          ...(comTarefas && x.tarefa && (x.clienteId === NOVO ? x.novo.ativo : clientes.find((c) => c.id === x.clienteId)?.ativo) ? { tarefa: x.tarefa } : {}),
        }));
        const r = await fetch("/api/ficha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "importar", itens: parte }) });
        const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
        if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
        fichas += j.fichas;
        tarefas += j.tarefas;
        criados += j.criados ?? 0;
      }
      setEstado(`Pronto: ${fichas} ficha(s) atualizadas${criados ? `, ${criados} cliente(s) criados` : ""}${tarefas ? ` e ${tarefas} tarefa(s) criadas` : ""}. Se importar de novo, nada se repete (clientes de mesmo nome são reaproveitados).`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEstado(null);
    } finally {
      setOcupado(false);
    }
  }

  const listas = [...new Set((itens ?? []).map((x) => x.lista))];
  const ativos = clientes.filter((c) => c.ativo), inativos = clientes.filter((c) => !c.ativo);

  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded-2xl border border-borda bg-superficie p-4 text-sm">
        <p className="text-texto-2">
          No Trello: menu do quadro (⋯) › <b>Imprimir, exportar e compartilhar</b> › <b>Exportar como JSON</b>. Salve o arquivo e escolha aqui.
          O arquivo é lido no seu navegador; só vai para o painel o que você importar.
        </p>
        <input type="file" accept="application/json,.json" onChange={(e) => escolherArquivo(e.target.files?.[0])} className="text-sm" />
        {erro && <p className="text-critico">{erro}</p>}
      </div>

      {itens && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie p-4 text-sm">
            <div className="space-y-1">
              <p>
                <b>{itens.length}</b> cartões abertos · <b>{escolhidos.filter((x) => x.clienteId !== NOVO).length}</b> ligados a clientes do painel
                {escolhidos.some((x) => x.clienteId === NOVO) && <> · <b>{escolhidos.filter((x) => x.clienteId === NOVO).length}</b> viram cliente novo (os do Lixo, como inativos)</>}.
                Confira abaixo; os marcados “Não importar” ficam de fora.
              </p>
              <label className="flex items-center gap-2 text-texto-2">
                <input type="checkbox" checked={comTarefas} onChange={(e) => setComTarefas(e.target.checked)} />
                Criar tarefa para os cartões de “Falta informação” (aguardando o cliente) e de “Coisas a fazer”
              </label>
              {repetidos.size > 0 && <p className="text-xs text-atencao">▲ Há cartões diferentes ligados ao mesmo cliente: as informações dos dois vão para a mesma ficha.</p>}
            </div>
            <button type="button" onClick={importar} disabled={ocupado || !escolhidos.length} className="rounded-[10px] bg-destaque px-4 py-2 font-semibold text-white disabled:opacity-50">
              {ocupado ? "Importando…" : `Importar ${escolhidos.length} cartão(ões)`}
            </button>
          </div>
          {estado && <p className="text-sm text-bom">{estado}</p>}

          {listas.map((l) => (
            <section key={l} className="space-y-1.5">
              <h2 className="text-sm font-bold">{l} <span className="font-normal text-texto-3">· {itens.filter((x) => x.lista === l).length}</span></h2>
              {itens.filter((x) => x.lista === l).map((x) => (
                <div key={x.cardId} className={`rounded-xl border border-borda bg-superficie px-3 py-2 text-sm ${x.clienteId ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setAberto(aberto === x.cardId ? null : x.cardId)} className="min-w-0 flex-1 truncate text-left font-medium">{x.nome}</button>
                    <span className="text-xs text-texto-3">
                      {x.links.length} link(s) · {x.informacoes ? `${x.informacoes.length} letras` : "sem texto"}
                      {x.senhas > 0 && <span className="text-atencao"> · {x.senhas} senha(s) removida(s)</span>}
                    </span>
                    <select value={x.clienteId} onChange={(e) => setItens((xs) => xs!.map((y) => (y.cardId === x.cardId ? { ...y, clienteId: e.target.value } : y)))}
                      className="max-w-[60vw] rounded-lg border border-borda bg-fundo px-2 py-1 text-xs">
                      <option value="">Não importar</option>
                      <option value={NOVO}>+ Criar cliente “{x.novo.nome}”</option>
                      <optgroup label="Clientes ativos">{ativos.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.empresa}</option>)}</optgroup>
                      {inativos.length > 0 && <optgroup label="Inativos (churn)">{inativos.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.empresa}</option>)}</optgroup>}
                    </select>
                  </div>
                  {x.clienteId === NOVO && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-texto-2">
                      <span>Novo cliente:</span>
                      <input value={x.novo.nome} onChange={(e) => setItens((xs) => xs!.map((y) => (y.cardId === x.cardId ? { ...y, novo: { ...y.novo, nome: e.target.value } } : y)))}
                        className="rounded-lg border border-borda bg-fundo px-2 py-1" />
                      <select value={x.novo.empresa} onChange={(e) => setItens((xs) => xs!.map((y) => (y.cardId === x.cardId ? { ...y, novo: { ...y.novo, empresa: e.target.value } } : y)))}
                        className="rounded-lg border border-borda bg-fundo px-2 py-1">
                        {EMPRESAS_NOVO.map((e) => <option key={e} value={e}>{e}</option>)}
                      </select>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={x.novo.ativo} onChange={(e) => setItens((xs) => xs!.map((y) => (y.cardId === x.cardId ? { ...y, novo: { ...y.novo, ativo: e.target.checked } } : y)))} />
                        ativo (desmarcado = ex-cliente)
                      </label>
                    </div>
                  )}
                  {aberto === x.cardId && (
                    <div className="mt-2 space-y-2 border-t border-borda pt-2 text-xs text-texto-2">
                      {x.informacoes && <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-sans">{x.informacoes}</pre>}
                      {x.links.length > 0 && <p className="break-all text-texto-3">{x.links.map((k) => k.url).join(" · ")}</p>}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
