"use client";

import { useActionState } from "react";
import { entrar } from "../acoes";

export default function Login() {
  const [estado, acao, enviando] = useActionState(entrar, null);
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form action={acao} className="w-full max-w-sm rounded-xl border border-borda bg-superficie p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Visão Geral</h1>
          <p className="text-sm text-texto-2">Entre com sua senha para ver o painel.</p>
        </div>
        <input
          type="password" name="senha" required autoFocus placeholder="Senha"
          className="w-full rounded-lg border border-borda bg-fundo px-3 py-2 outline-none focus:border-destaque"
        />
        {estado?.erro && <p className="text-sm text-critico">{estado.erro}</p>}
        <button
          disabled={enviando}
          className="w-full rounded-lg bg-destaque px-3 py-2 font-medium text-white disabled:opacity-60"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <a href="/privacidade" className="block text-center text-xs text-texto-3 hover:text-texto">
          Política de Privacidade
        </a>
      </form>
    </main>
  );
}
