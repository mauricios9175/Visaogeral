"use client";

// Mostra o erro real (em vez da tela genérica) para facilitar o diagnóstico.
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-borda bg-superficie p-4 text-sm">
      <h1 className="font-medium text-critico">Algo deu errado ao carregar esta página</h1>
      <p className="text-texto-2">
        Mande um print desta mensagem para ajustar. Código: {error.digest ?? "—"}
      </p>
      <button onClick={reset} className="rounded-lg border border-borda px-3 py-1.5 hover:border-destaque">
        Tentar de novo
      </button>
    </div>
  );
}
