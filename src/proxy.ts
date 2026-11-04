import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, sessaoValida } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (await sessaoValida(request.cookies.get(COOKIE_SESSAO)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // /login e /privacidade ficam abertos; /api/cron usa o próprio CRON_SECRET;
  // /portal/<token> é o link só de leitura do cliente (o token é a chave; a página não tem nenhuma ação);
  // o manifesto e os ícones do app também (o celular busca antes de você entrar)
  matcher: ["/((?!login|privacidade|portal/|api/cron|_next/static|_next/image|favicon.ico|manifest.webmanifest|icones/|sw.js).*)"],
};
