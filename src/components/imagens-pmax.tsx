"use client";

import { useState } from "react";
import type { ImagemPmax } from "@/app/acoes-montagem-google";

// Formatos que o Google pede na Performance Max. A imagem é recortada no centro e reduzida aqui no navegador
// (fica leve para enviar e já no tamanho certo).
const FORMATOS: Record<ImagemPmax["tipo"], { rotulo: string; largura: number; altura: number; max: number; obrigatorio: boolean; dica: string }> = {
  logo: { rotulo: "Logo", largura: 512, altura: 512, max: 1, obrigatorio: true, dica: "quadrado (1:1)" },
  paisagem: { rotulo: "Imagens paisagem", largura: 1200, altura: 628, max: 3, obrigatorio: true, dica: "1,91:1" },
  quadrada: { rotulo: "Imagens quadradas", largura: 1200, altura: 1200, max: 3, obrigatorio: true, dica: "1:1" },
  retrato: { rotulo: "Imagens retrato", largura: 960, altura: 1200, max: 2, obrigatorio: false, dica: "4:5, opcional" },
};

/** Lê o arquivo, recorta no centro no formato pedido e devolve o JPEG em base64 (sem o prefixo data:). */
async function preparar(arquivo: File, largura: number, altura: number) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => erro(new Error("Não consegui abrir a imagem."));
      i.src = url;
    });
    const alvo = largura / altura;
    const [w, h] = img.width / img.height > alvo ? [img.height * alvo, img.height] : [img.width, img.width / alvo];
    const canvas = document.createElement("canvas");
    // não aumenta imagem pequena além do original (o Google recusa abaixo do mínimo; aí avisamos)
    const escala = Math.min(1, largura / w);
    canvas.width = Math.round(w * escala);
    canvas.height = Math.round(h * escala);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // fundo branco para logos com transparência
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dados: dataUrl.split(",")[1], previa: dataUrl, pequena: canvas.width < (largura === 512 ? 128 : largura / 2) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Escolha das imagens da Performance Max (logo, paisagem, quadrada e retrato). */
export function ImagensPmax({ valor, onChange }: { valor: ImagemPmax[]; onChange: (v: ImagemPmax[]) => void }) {
  const [previas, setPrevias] = useState<Map<string, string>>(new Map());
  const [aviso, setAviso] = useState<string | null>(null);

  async function adicionar(tipo: ImagemPmax["tipo"], arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const f = FORMATOS[tipo];
    const livres = f.max - valor.filter((x) => x.tipo === tipo).length;
    const novas: ImagemPmax[] = [];
    const mapa = new Map(previas);
    let pequenas = 0;
    for (const a of [...arquivos].slice(0, Math.max(0, livres))) {
      try {
        const r = await preparar(a, f.largura, f.altura);
        if (r.pequena) pequenas++;
        novas.push({ tipo, dados: r.dados });
        mapa.set(r.dados.slice(0, 64), r.previa);
      } catch (e) {
        setAviso(e instanceof Error ? e.message : String(e));
      }
    }
    setPrevias(mapa);
    setAviso(pequenas ? `${pequenas} imagem(ns) pequena(s) demais: o Google pode recusar (use pelo menos ${f.largura / 2}px de largura).` : null);
    onChange([...valor, ...novas]);
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Imagens <span className="font-normal text-xs text-texto-3">(recortadas no centro no formato certo)</span></div>
      {(Object.keys(FORMATOS) as ImagemPmax["tipo"][]).map((tipo) => {
        const f = FORMATOS[tipo];
        const doTipo = valor.filter((x) => x.tipo === tipo);
        return (
          <div key={tipo} className="space-y-1.5">
            <div className="text-xs text-texto-2">
              {f.rotulo} <span className="text-texto-3">({f.dica} · {doTipo.length}/{f.max}{f.obrigatorio ? " · obrigatório" : ""})</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {doTipo.map((im, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previas.get(im.dados.slice(0, 64)) ?? `data:image/jpeg;base64,${im.dados}`} alt={`${f.rotulo} ${i + 1}`}
                    className="h-16 rounded-md border border-borda object-cover" style={{ aspectRatio: `${f.largura} / ${f.altura}` }} />
                  <button type="button" onClick={() => onChange(valor.filter((x) => x !== im))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-critico text-[10px] text-white" aria-label="Remover imagem">✕</button>
                </div>
              ))}
              {doTipo.length < f.max && (
                <label className="flex h-16 cursor-pointer items-center rounded-md border border-dashed border-borda px-3 text-xs text-texto-2 hover:border-destaque">
                  + escolher
                  <input type="file" accept="image/*" multiple={f.max > 1} className="hidden" onChange={(e) => { void adicionar(tipo, e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
          </div>
        );
      })}
      {aviso && <p className="text-xs text-atencao">{aviso}</p>}
    </div>
  );
}
