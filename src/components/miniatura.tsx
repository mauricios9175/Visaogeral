"use client";

import { useState } from "react";

/** Miniatura do criativo. Os links de imagem do Meta expiram; se falhar, mostra um quadro com o formato. */
export function Miniatura({ src, alt, formato }: { src: string | null; alt: string; formato: string }) {
  const [erro, setErro] = useState(false);
  if (!src || erro) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-fundo text-xs text-texto-3">
        {formato === "video" ? "▶ vídeo" : formato === "imagem" ? "imagem" : "criativo"} · sem miniatura
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setErro(true)}
      className="aspect-[4/3] w-full bg-fundo object-cover"
    />
  );
}
