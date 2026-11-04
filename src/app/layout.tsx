import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Visão Geral · Tráfego",
  description: "Painel de clientes de tráfego pago",
  // no iPhone: "Adicionar à Tela de Início" abre em tela cheia, com o ícone do app
  appleWebApp: { capable: true, title: "Visão Geral", statusBarStyle: "black-translucent" },
  icons: { icon: "/icones/icone-192.png", apple: "/icones/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#121217",
  colorScheme: "dark",
  viewportFit: "cover", // usa a tela inteira (inclusive atrás do recorte); o menu de baixo respeita a área segura
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
