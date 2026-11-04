import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Performance Max: as imagens (já reduzidas no navegador) vão junto na montagem
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  // modelo do relatório (pptx) que o painel sobe para o Google Drive
  outputFileTracingIncludes: {
    "/clientes/**": ["./modelos/*.pptx"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
