// Session refresh + route gating (Next.js 16 "proxy" convention, formerly
// middleware). Refreshes the Supabase auth cookie on every request so server
// components / route handlers see a current session, and redirects
// unauthenticated users away from protected routes.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";

// Routes reachable without a session. NOTE: /reset-password MUST be here — the
// recovery link lands an UNAUTHENTICATED user there, and gating it would kill
// the reset flow before the page can consume the token (auth-packet LESSON 1).
const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  // Public demo canvas (sketch without saving).
  if (pathname === "/editor/local") return true;
  // AI proxy routes are used by the public demo; plan APIs (Phase 10) will gate.
  if (pathname.startsWith("/api/")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  // No auth configured -> nothing to gate.
  if (!isSupabaseConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
