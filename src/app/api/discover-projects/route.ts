import { getBendystrawUrl } from "@/graphql/constants";
import {
  BENDYSTRAW_TIMEOUT_MS,
  bendystrawFetch,
  readBendystrawResponse,
} from "@/lib/bendystraw/transport";
import { NextResponse } from "next/server";

type IndexedProject = {
  projectId: number;
  chainId: number;
  suckerGroupId: string | null;
  name: string | null;
  handle: string | null;
  logoUri: string | null;
  projectTagline: string | null;
  createdAt: number;
  volume: string;
};

const PROJECT_FIELDS = `
  projectId chainId suckerGroupId name handle logoUri projectTagline
  createdAt volume
`;

function graphqlUrl() {
  const url = new URL(getBendystrawUrl(1));
  url.pathname = `${url.pathname.replace(/\/graphql\/?$/u, "").replace(/\/$/u, "")}/graphql`;
  url.search = "";
  url.hash = "";
  return url;
}

export async function GET() {
  try {
    const response = await bendystrawFetch(graphqlUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query DiscoverRevnets {
          projects(
            where: { version: 6, isRevnet: true }
            orderBy: "createdAt"
            orderDirection: "desc"
            limit: 200
          ) {
            items { ${PROJECT_FIELDS} }
          }
        }`,
        variables: {},
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(BENDYSTRAW_TIMEOUT_MS),
    });
    const data = (await readBendystrawResponse(response)) as {
      projects?: { items?: IndexedProject[] };
    };
    const groups = new Map<
      string,
      { representative: IndexedProject; members: IndexedProject[] }
    >();

    for (const project of data.projects?.items ?? []) {
      const key = project.suckerGroupId ?? `${project.chainId}:${project.projectId}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { representative: project, members: [project] });
        continue;
      }
      group.members.push(project);
      if (BigInt(project.volume || "0") > BigInt(group.representative.volume || "0")) {
        group.representative = project;
      }
    }

    return NextResponse.json(
      {
        projects: Array.from(groups.values())
          .map(({ representative, members }) => ({
            ...representative,
            chainIds: Array.from(new Set(members.map((member) => member.chainId))),
          }))
          .filter((project) => project.name || project.projectTagline),
      },
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
