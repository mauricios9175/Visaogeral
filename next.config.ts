import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
