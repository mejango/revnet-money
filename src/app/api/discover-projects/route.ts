import { getBendystrawUrl } from "@/graphql/constants";
import { requestBendystraw } from "@bananapus/nana-sdk-core";
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
  return url.toString();
}

export async function GET() {
  try {
    const projects: IndexedProject[] = [];
    let totalCount = 0;
    do {
      const query = `query DiscoverRevnets($limit: Int!, $offset: Int!) {
          projects(
            where: { version: 6, isRevnet: true }
            orderBy: "createdAt"
            orderDirection: "desc"
            limit: $limit
            offset: $offset
          ) {
            totalCount
            items { ${PROJECT_FIELDS} }
          }
        }`;
      const data = await requestBendystraw<
        {
          projects?: { items?: IndexedProject[]; totalCount?: number };
        },
        { limit: number; offset: number }
      >(
        graphqlUrl(),
        query,
        { limit: 250, offset: projects.length },
        {
          fetch: (input, init) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return fetch(input, {
              ...init,
              body: JSON.stringify({ ...body, operationName: "DiscoverRevnets" }),
              cache: "no-store",
            });
          },
        },
      );
      const page = data.projects?.items ?? [];
      totalCount = data.projects?.totalCount ?? page.length;
      projects.push(...page);
      if (!page.length) break;
    } while (projects.length < totalCount);
    const groups = new Map<string, { representative: IndexedProject; members: IndexedProject[] }>();

    for (const project of projects) {
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
