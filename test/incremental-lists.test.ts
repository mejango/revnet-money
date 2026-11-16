import { refreshActivityEvents, refreshParticipants } from "@/hooks/useCompleteBendystrawLists";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bendystraw/client", () => ({
  queryBendystrawFromBrowser: vi.fn(),
}));

const query = vi.mocked(queryBendystrawFromBrowser);
beforeEach(() => query.mockReset());

describe("activity feed refresh", () => {
  const variables = {
    orderBy: "timestamp",
    orderDirection: "desc",
    where: { suckerGroupId: "group" },
  } as const;
  const events = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `e${from - index}` }));
  const answer = (items: { id: string }[], totalCount?: number) =>
    ({ activityEvents: { items, totalCount } }) as never;
  const refresh = (previous?: { id: string }[]) =>
    refreshActivityEvents(previous as never, variables as never, 1);

  it("pages the whole feed when nothing is held", async () => {
    query
      .mockResolvedValueOnce(answer(events(300, 250), 300))
      .mockResolvedValueOnce(answer(events(50, 50), 300));

    expect(await refresh()).toHaveLength(300);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("asks for the newest page only and puts its new events ahead of the held ones", async () => {
    const held = events(300, 300);
    query.mockResolvedValueOnce(answer(events(302, 250), 302));

    const merged = await refresh(held);

    expect(query).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { ...variables, limit: 250, offset: 0 },
      1,
    );
    expect(merged.map((event) => event.id)).toEqual(events(302, 302).map((event) => event.id));
  });

  it("pages everything again when the newest page does not reach a held event", async () => {
    query
      .mockResolvedValueOnce(answer(events(900, 250), 900))
      .mockResolvedValueOnce(answer(events(900, 250), 500))
      .mockResolvedValueOnce(answer(events(650, 250), 500));

    expect(await refresh(events(300, 300))).toHaveLength(500);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("pages everything again when the merged count is not the indexer's total", async () => {
    // One held event is gone from the index: the merge would keep it.
    query
      .mockResolvedValueOnce(answer(events(300, 250), 299))
      .mockResolvedValueOnce(answer(events(300, 250), 299))
      .mockResolvedValueOnce(answer(events(49, 49), 299));

    expect(await refresh(events(300, 300))).toHaveLength(299);
  });
});

describe("participants refresh", () => {
  const rows = (count: number, balance = "1") =>
    Array.from({ length: count }, (_, index) => ({ address: `0x${index}`, chainId: 1, balance }));
  const answer = (items: unknown[], totalCount: number) =>
    ({ participants: { items, totalCount } }) as never;
  const where = (suckerGroupId: string) => ({ suckerGroupId, balance_gt: "0" });

  it("answers a one-page list from that page every time", async () => {
    query.mockResolvedValue(answer(rows(3), 3));

    const first = await refreshParticipants(undefined, where("small"), 1, 0);
    await refreshParticipants(first, where("small"), 1, 30_000);

    expect(first).toHaveLength(3);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps a longer list's rows while its total and first page are unchanged", async () => {
    const all = rows(260);
    query
      .mockResolvedValueOnce(answer(all.slice(0, 250), 260))
      .mockResolvedValueOnce(answer(all.slice(250), 260))
      .mockResolvedValueOnce(answer(all.slice(0, 250), 260));

    const first = await refreshParticipants(undefined, where("steady"), 1, 0);
    const second = await refreshParticipants(first, where("steady"), 1, 30_000);

    expect(first).toHaveLength(260);
    expect(second).toBe(first);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["the total changes", rows(250), 261, 30_000],
    [
      "a first-page balance changes",
      [{ ...rows(1)[0], balance: "9" }, ...rows(250).slice(1)],
      260,
      30_000,
    ],
    ["five minutes pass", rows(250), 260, 5 * 60_000],
  ])("pages a longer list to its end again when %s", async (name, head, total, at) => {
    const group = where(name);
    query
      .mockResolvedValueOnce(answer(rows(250), 260))
      .mockResolvedValueOnce(answer(rows(10), 260));
    const first = await refreshParticipants(undefined, group, 1, 0);

    query
      .mockResolvedValueOnce(answer(head, total))
      .mockResolvedValueOnce(answer(rows(total - 250), total));
    const second = await refreshParticipants(first, group, 1, at);

    expect(second).not.toBe(first);
    expect(second).toHaveLength(total);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("pages rows restored from an earlier session to their end before trusting them", async () => {
    query
      .mockResolvedValueOnce(answer(rows(250), 260))
      .mockResolvedValueOnce(answer(rows(10), 260));

    await refreshParticipants(rows(260) as never, where("restored"), 1, 0);

    expect(query).toHaveBeenCalledTimes(2);
  });
});
