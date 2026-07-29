/** The explicit participants fetch cap (the Bendystraw proxy's maximum). */
export const PARTICIPANTS_FETCH_LIMIT = 1000;

export type ParticipantInput = {
  address: string;
  chainId: number;
  balance?: string | number | bigint | null;
  volume?: string | number | bigint | null;
} | null;

export type AggregatedParticipant = {
  address: string;
  balance: bigint;
  volume: bigint;
  chains: number[];
};

export type ParticipantCountSummary = {
  count: number;
  exact: boolean;
};

/** Aggregate each account's balance/volume across the chains it holds on. */
export function aggregateParticipants(
  items: readonly ParticipantInput[] | undefined,
): AggregatedParticipant[] {
  const byAddress = new Map<string, AggregatedParticipant>();
  for (const participant of items ?? []) {
    if (!participant) continue;
    const key = participant.address.toLowerCase();
    const existing = byAddress.get(key) ?? {
      address: participant.address,
      balance: 0n,
      volume: 0n,
      chains: [],
    };
    existing.balance += BigInt(participant.balance ?? 0);
    existing.volume += BigInt(participant.volume ?? 0);
    if (!existing.chains.includes(participant.chainId)) {
      existing.chains.push(participant.chainId);
    }
    byAddress.set(key, existing);
  }
  return [...byAddress.values()];
}

/**
 * A unique holder count can only be exact when every indexed participant row
 * was fetched. Otherwise the deduplicated rows establish a lower bound.
 */
export function participantCountSummary(
  items: readonly ParticipantInput[] | undefined,
  totalCount: number | undefined,
): ParticipantCountSummary {
  const fetchedCount = items?.length ?? 0;
  return {
    count: aggregateParticipants(items).length,
    exact: typeof totalCount === "number" && totalCount <= fetchedCount,
  };
}
