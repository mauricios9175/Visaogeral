"use client";

import { useFormStatus } from "react-dom";
import { encerrarCliente } from "@/app/acoes";

/**
 * Botão de formulário que mostra que está trabalhando enquanto a ação roda no servidor.
 * `aguardando` é o texto exibido durante o processo; `aviso` aparece embaixo (ex.: tempo estimado).
 */
export function BotaoEnviar({ children, aguardando, aviso, className }: {
  children: React.ReactNode;
  aguardando?: string;
  aviso?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <span className="inline-flex flex-col">
      <button disabled={pending} aria-busy={pending} className={`${className ?? ""} disabled:cursor-wait disabled:opacity-70`}>
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            {aguardando ?? "Salvando…"}
          </span>
        ) : (
          children
        )}
      </button>
      {pending && aviso && <span className="mt-1 text-xs text-texto-3">{aviso}</span>}
    </span>
  );
}

/**
 * Botão "Churn" dentro do formulário do cliente: envia o mesmo formulário (com o id) para a ação
 * de encerrar, depois de confirmar.
 */
export function BotaoChurn() {
  const { pending } = useFormStatus();
  return (
    <button
      formAction={encerrarCliente}
      formNoValidate
      disabled={pending}
      onClick={(e) => {
        if (!confirm("Encerrar este cliente (churn)? Ele sai da visão geral, dos alertas e da sincronização. Dá para reativar depois.")) {
          e.preventDefault();
        }
      }}
      className="rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm text-critico hover:border-critico disabled:opacity-60"
      title="Encerrar cliente (churn)"
    >
      Churn
    </button>
  );
}
