import { NextRequest, NextResponse } from "next/server";

const LEGACY_V6_PROJECT_PATH = /^\/v6:([^/:]+):([1-9]\d*)(\/.*)?$/;

export function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(LEGACY_V6_PROJECT_PATH);
  if (!match) return NextResponse.next();

  const [, chainSlug, projectId, suffix = ""] = match;
  const destination = request.nextUrl.clone();
  destination.pathname = `/${chainSlug}:${projectId}${suffix}`;

  return NextResponse.redirect(destination, 308);
}
