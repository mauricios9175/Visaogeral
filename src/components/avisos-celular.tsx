"use client";

import { useEffect, useState } from "react";

/** Chave VAPID (base64url) no formato que o navegador pede. */
function chaveBinaria(base64: string) {
  const b = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

type Estado = "carregando" | "sem-suporte" | "instalar-iphone" | "bloqueado" | "desligado" | "ligado";

/** Liga/desliga as notificações neste aparelho e manda uma de teste. */
export function AvisosCelular() {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const instalado = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setEstado(iphone && !instalado ? "instalar-iphone" : "sem-suporte");
        return;
      }
      if (Notification.permission === "denied") return setEstado("bloqueado");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const inscricao = await reg.pushManager.getSubscription();
      setEstado(inscricao ? "ligado" : "desligado");
    })().catch(() => setEstado("sem-suporte"));
  }, []);

  async function ligar() {
    setOcupado(true);
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setEstado("bloqueado");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const { chave, erro } = await fetch("/api/push").then((r) => r.json());
      if (erro) throw new Error(erro);
      const inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBinaria(chave) });
      const aparelho = /iphone|ipad/i.test(navigator.userAgent) ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android" : "Computador";
      const r = await fetch("/api/push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscricao: inscricao.toJSON(), aparelho }),
      }).then((x) => x.json());
      if (r.erro) throw new Error(r.erro);
      setEstado("ligado");
      setMsg("Notificações ligadas neste aparelho.");
    } catch (e) {
      setMsg(`Não deu para ligar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const inscricao = await reg?.pushManager.getSubscription();
      if (inscricao) {
        await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: inscricao.endpoint }) });
        await inscricao.unsubscribe();
      }
      setEstado("desligado");
      setMsg("Notificações desligadas neste aparelho.");
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teste: true }) })
      .then((x) => x.json()).catch(() => ({ erro: "falha" }));
    setMsg(r.erro ? `Erro: ${r.erro}` : `Teste enviado para ${r.enviados} aparelho(s).`);
    setOcupado(false);
  }

  const botao = "min-h-10 rounded-[10px] px-4 text-sm font-semibold disabled:opacity-60";
  return (
    <div className="space-y-2">
      {estado === "carregando" && <p className="text-sm text-texto-3">Verificando este aparelho…</p>}
      {estado === "instalar-iphone" && (
        <p className="text-sm text-texto-2">
          No iPhone, as notificações funcionam com o app instalado: no Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>,
          abra pelo ícone e volte aqui.
        </p>
      )}
      {estado === "sem-suporte" && <p className="text-sm text-texto-3">Este navegador não aceita notificações. No celular, use o app instalado (Chrome no Android, Safari no iPhone).</p>}
      {estado === "bloqueado" && (
        <p className="text-sm text-texto-2">As notificações estão bloqueadas para o painel neste aparelho. Libere nas configurações do navegador (ou do app) e recarregue.</p>
      )}
      {(estado === "desligado" || estado === "ligado") && (
        <div className="flex flex-wrap items-center gap-2">
          {estado === "desligado"
            ? <button type="button" onClick={ligar} disabled={ocupado} className={`${botao} bg-destaque text-white`}>Ligar notificações neste aparelho</button>
            : <>
                <span className="text-sm font-semibold text-bom">● Ligadas neste aparelho</span>
                <button type="button" onClick={testar} disabled={ocupado} className={`${botao} border border-borda bg-superficie`}>Mandar um teste</button>
                <button type="button" onClick={desligar} disabled={ocupado} className={`${botao} text-texto-3 hover:text-texto`}>Desligar</button>
              </>}
        </div>
      )}
      {msg && <p className="text-sm text-texto-2">{msg}</p>}
    </div>
  );
}
