import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, sessaoValida } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (await sessaoValida(request.cookies.get(COOKIE_SESSAO)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // /login e /privacidade ficam abertos; /api/cron usa o próprio CRON_SECRET
  matcher: ["/((?!login|privacidade|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
