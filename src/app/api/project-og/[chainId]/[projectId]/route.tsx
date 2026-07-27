import { getProject } from "@/app/[slug]/getProject";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; projectId: string }> },
) {
  const raw = await params;
  const chainId = Number(raw.chainId);
  const projectId = Number(raw.projectId);
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !Number.isSafeInteger(projectId) ||
    projectId < 0
  ) {
    return new Response(null, { status: 400 });
  }
  const project = await getProject(projectId, chainId);
  if (!project) return new Response(null, { status: 404 });

  const imageUrl = new URL(`/api/project-image/${chainId}/${projectId}`, request.nextUrl.origin)
    .href;

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f5fcf8",
        color: "#15281f",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "56px 72px",
        width: "100%",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" width="440" height="440" style={{ objectFit: "contain" }} />
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          marginLeft: "56px",
        }}
      >
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>
          {project.name ?? `Project ${projectId}`}
        </div>
        <div style={{ display: "flex", fontSize: 26, marginTop: "24px" }}>
          An autonomous business model for the open web.
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
