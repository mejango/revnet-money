import { getBendystrawUrl } from "@/graphql/constants";
import {
  BENDYSTRAW_TIMEOUT_MS,
  bendystrawFetch,
  readBendystrawResponse,
} from "@/lib/bendystraw/transport";
import { NextRequest, NextResponse } from "next/server";

type IndexedProject = {
  projectId: number;
  chainId: number;
  suckerGroupId: string | null;
  name: string | null;
  handle: string | null;
  logoUri: string | null;
  projectTagline: string | null;
  tokenSymbol: string | null;
  volume: string;
};

type SearchProject = IndexedProject & { ticker: string | null };

const PROJECT_FIELDS = `
  projectId chainId suckerGroupId name handle logoUri projectTagline
  tokenSymbol volume
`;

async function queryBendystraw<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await bendystrawFetch(getBendystrawUrl(1), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationName, query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(BENDYSTRAW_TIMEOUT_MS),
  });
  return (await readBendystrawResponse(response)) as T;
}

export async function GET(request: NextRequest) {
  const text = (request.nextUrl.searchParams.get("q")?.trim() ?? "").replace(/^\$/u, "");
  if (text.length < 1 || text.length > 64) {
    return NextResponse.json({ projects: [] });
  }

  const numericId = /^\d+$/u.test(text) ? Number(text) : null;
  const idFilter =
    numericId !== null && Number.isSafeInteger(numericId) && numericId > 0
      ? `{ projectId: ${numericId} }`
      : null;
  const filters = ["{ name_contains_nocase: $text }", ...(idFilter ? [idFilter] : [])].join("\n");

  try {
    const [data, tickerData] = await Promise.all([
      queryBendystraw<{
        projects?: { items?: IndexedProject[] };
      }>(
        "SearchRevnets",
        `query SearchRevnets($text: String!) {
          projects(
            where: {
              version: 6
              isRevnet: true
              OR: [
                ${filters}
              ]
            }
            orderBy: "volume"
            orderDirection: "desc"
            limit: 32
          ) {
            items { ${PROJECT_FIELDS} }
          }
        }`,
        { text },
      ),
      queryBendystraw<{
        deployErc20Events?: {
          items?: Array<{
            chainId: number;
            projectId: number;
            symbol: string;
          }>;
        };
      }>(
        "SearchRevnetTickers",
        `query SearchRevnetTickers($text: String!) {
          deployErc20Events(
            where: { symbol_contains_nocase: $text }
            limit: 100
          ) {
            items { chainId projectId symbol }
          }
        }`,
        { text },
      ),
    ]);

    const tickerByDeployment = new Map<string, string>();
    for (const event of tickerData.deployErc20Events?.items ?? []) {
      tickerByDeployment.set(`${event.chainId}:${event.projectId}`, event.symbol);
    }
    const tickerPairs = Array.from(tickerByDeployment.keys()).map((pair) => {
      const [chainId, projectId] = pair.split(":").map(Number);
      return `{ chainId: ${chainId}, projectId: ${projectId} }`;
    });
    const tickerProjects =
      tickerPairs.length > 0
        ? ((
            await queryBendystraw<{
              projects?: { items?: IndexedProject[] };
            }>(
              "SearchRevnetTickerProjects",
              `query SearchRevnetTickerProjects {
                projects(
                  where: {
                    version: 6
                    isRevnet: true
                    OR: [${tickerPairs.join("\n")}]
                  }
                  orderBy: "volume"
                  orderDirection: "desc"
                  limit: 32
                ) {
                  items { ${PROJECT_FIELDS} }
                }
              }`,
              {},
            )
          ).projects?.items ?? [])
        : [];
    const matchedDeployments = new Map<string, IndexedProject>();
    for (const project of [...(data.projects?.items ?? []), ...tickerProjects]) {
      matchedDeployments.set(`${project.chainId}:${project.projectId}`, project);
    }
    const matches: SearchProject[] = Array.from(matchedDeployments.values()).map((project) => ({
      ...project,
      ticker: tickerByDeployment.get(`${project.chainId}:${project.projectId}`) ?? null,
    }));
    const groups = new Map<string, { representative: SearchProject; members: SearchProject[] }>();
    for (const project of matches) {
      const key = project.suckerGroupId ?? `${project.chainId}:${project.projectId}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          representative: project,
          members: [project],
        });
      } else {
        group.members.push(project);
        if (BigInt(project.volume || "0") > BigInt(group.representative.volume || "0")) {
          group.representative = project;
        }
      }
    }

    const completeGroups = await Promise.all(
      Array.from(groups.values()).map(async (group) => {
        const id = group.representative.suckerGroupId;
        if (!id) return group;
        try {
          const groupData = await queryBendystraw<{
            suckerGroup?: { projects?: { items?: IndexedProject[] } };
          }>(
            "SearchRevnetGroup",
            `query SearchRevnetGroup($id: String!) {
              suckerGroup(id: $id) {
                projects(limit: 10) { items { ${PROJECT_FIELDS} } }
              }
            }`,
            { id },
          );
          return {
            ...group,
            members:
              groupData.suckerGroup?.projects?.items?.map((member) => ({
                ...member,
                ticker: null,
              })) ?? group.members,
          };
        } catch {
          return group;
        }
      }),
    );

    return NextResponse.json({
      projects: completeGroups.map(({ representative, members }) => ({
        ...representative,
        ticker: representative.ticker ?? members.find((member) => member.ticker)?.ticker ?? null,
        chainIds: Array.from(new Set(members.map((member) => member.chainId))),
      })),
    });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
