"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPastaCliente } from "@/app/acoes-historico";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { gapi?: any; google?: any }
}

let carregando: Promise<void> | null = null;
/** Carrega o seletor de arquivos do Google (Google Picker) uma vez só. */
function carregarPicker() {
  carregando ??= new Promise<void>((ok, erro) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => window.gapi.load("picker", { callback: () => ok() });
    s.onerror = () => erro(new Error("Não foi possível carregar o seletor do Google."));
    document.head.appendChild(s);
  });
  return carregando;
}

/** Escolhe (no próprio seletor do Google) a pasta do Drive onde os relatórios do cliente são salvos. */
export function EscolherPasta({ clienteId, atual }: { clienteId: string; atual: { id: string; nome: string } | null }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  async function abrir() {
    setErro(null);
    try {
      const r = await fetch("/api/google/seletor").then((x) => x.json());
      if (r.erro) throw new Error(r.erro);
      await carregarPicker();
      const p = window.google.picker;
      // "Meu Drive" e drives compartilhados, só pastas
      const meuDrive = new p.DocsView(p.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setParent("root");
      const compartilhados = new p.DocsView(p.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setEnableDrives(true);
      const recentes = new p.DocsView(p.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
      new p.PickerBuilder()
        .setTitle("Pasta onde salvar os relatórios deste cliente")
        .addView(meuDrive).addView(compartilhados).addView(recentes)
        .enableFeature(p.Feature.SUPPORT_DRIVES)
        .setOAuthToken(r.token).setDeveloperKey(r.chave).setAppId(r.appId)
        .setLocale("pt-BR")
        .setCallback((d: any) => {
          if (d.action !== p.Action.PICKED) return;
          const doc = d.docs?.[0];
          if (!doc) return;
          iniciar(async () => {
            try {
              await salvarPastaCliente(clienteId, { id: doc.id, nome: doc.name });
              router.refresh();
            } catch (e) {
              setErro(e instanceof Error ? e.message : String(e));
            }
          });
        })
        .build().setVisible(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-texto-2">
        Salvar em:{" "}
        {atual ? (
          <a href={`https://drive.google.com/drive/folders/${atual.id}`} target="_blank" rel="noreferrer" className="font-medium underline">📁 {atual.nome} ↗</a>
        ) : (
          <b>Relatórios · Visão Geral</b>
        )}
      </span>
      <button type="button" onClick={abrir} disabled={pendente}
        className="rounded-lg border border-borda bg-fundo px-3 py-1 hover:border-destaque disabled:opacity-60">
        {pendente ? "Salvando…" : atual ? "Trocar pasta" : "Escolher pasta do cliente"}
      </button>
      {atual && (
        <button type="button" disabled={pendente} onClick={() => iniciar(async () => { await salvarPastaCliente(clienteId, null); router.refresh(); })}
          className="text-xs text-texto-3 underline hover:text-texto">usar a pasta padrão</button>
      )}
      {erro && <span className="basis-full text-critico">{erro}</span>}
    </div>
  );
}
