import { getDiscoverProjects } from "@/lib/discoverProjects.server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json(
      { projects: await getDiscoverProjects() },
      {
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return NextResponse.json({ projects: [] }, { status: 503 });
  }
}
