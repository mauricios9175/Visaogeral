// Envio de imagem e vídeo pelo navegador (o mesmo caminho da montagem):
// imagem → Storage (link assinado) · vídeo → direto para o Meta, em partes (sem o limite de 50 MB do Storage).

export async function enviarImagem(f: File, lote: string): Promise<{ caminho: string }> {
  const r = await fetch("/api/upload", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: f.name, tipo: f.type, lote }),
  }).then((x) => x.json());
  if (r.erro) throw new Error(r.erro);
  const put = await fetch(r.url, { method: "PUT", headers: { "Content-Type": f.type, "x-upsert": "true" }, body: f });
  if (!put.ok) {
    const motivo = await put.json().then((j) => j.message || j.error, () => "");
    throw new Error(`falha no envio (${put.status}${motivo ? `: ${motivo}` : ""})`);
  }
  return { caminho: r.caminho };
}

export async function enviarVideoAoMeta(f: File, conta: string, progresso: (pct: number) => void): Promise<{ videoId: string }> {
  const chamar = async (qs: Record<string, string>, corpo?: Blob) => {
    const r = await fetch(`/api/meta/video?${new URLSearchParams({ conta, ...qs })}`, { method: "POST", body: corpo });
    const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
    if (j.erro) throw new Error(j.erro);
    return j;
  };
  const s = await chamar({ etapa: "inicio", tamanho: String(f.size) });
  let { inicio, fim } = s as { inicio: number; fim: number };
  // a Vercel aceita até ~4,5 MB por chamada: o trecho que o Meta pede vai em pedaços de até 4 MB
  const PEDACO = 4 * 1024 * 1024;
  while (inicio < fim) {
    const total = Math.ceil((fim - inicio) / PEDACO);
    let r: { inicio: number; fim: number } | null = null;
    for (let n = 0; n < total; n++) {
      const de = inicio + n * PEDACO;
      progresso(Math.round((de / f.size) * 100));
      r = await chamar({ etapa: "parte", sessao: s.sessao, inicio: String(inicio), n: String(n), total: String(total) }, f.slice(de, Math.min(de + PEDACO, fim)));
    }
    ({ inicio, fim } = r!);
  }
  await chamar({ etapa: "fim", sessao: s.sessao, nome: f.name });
  return { videoId: String(s.videoId) };
}
