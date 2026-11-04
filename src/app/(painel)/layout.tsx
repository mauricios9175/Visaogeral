import { sair } from "../acoes";
import { MenuCelular, MenuLateral } from "@/components/menu";

export default function PainelLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      <MenuLateral sair={sair} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MenuCelular />
        {/* pb no celular: espaço para o menu de baixo */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-24 pt-6 lg:px-9 lg:pb-12 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
