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

/** Aggregate each account's balance/volume across the chains it holds on. */
export function aggregateParticipants(
  items: readonly ParticipantInput[] | undefined,
): AggregatedParticipant[] {
  const byAddress = new Map<string, AggregatedParticipant>();
  for (const participant of items ?? []) {
    if (!participant) continue;
    const existing = byAddress.get(participant.address) ?? {
      address: participant.address,
      balance: 0n,
      volume: 0n,
      chains: [],
    };
    existing.balance += BigInt(participant.balance ?? 0);
    existing.volume += BigInt(participant.volume ?? 0);
    existing.chains.push(participant.chainId);
    byAddress.set(participant.address, existing);
  }
  return [...byAddress.values()];
}
