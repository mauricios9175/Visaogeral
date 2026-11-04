import type { MetadataRoute } from "next";

// Aplicativo instalável (PWA): "Adicionar à tela inicial" no celular abre o painel em tela cheia, como um app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Visão Geral · Tráfego",
    short_name: "Visão Geral",
    description: "Painel dos clientes de tráfego pago",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e0e12",
    theme_color: "#121217",
    lang: "pt-BR",
    icons: [
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icones/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
