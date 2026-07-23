"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useJBTokenContext } from "@/lib/nana/project";
import { useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import { formatTokenSymbol } from "@/lib/utils";
import { JBProjectToken } from "@bananapus/nana-sdk-core";
import Link from "next/link";
import { useParams } from "next/navigation";

export function UserBalance() {
  const { slug } = useParams<{ slug?: string }>();

  // Global pages such as /create have no ProjectProvider. Keep project-only
  // hooks in a child that is mounted only for project routes.
  if (!slug) return null;

  return <ProjectUserBalance slug={slug} />;
}

function ProjectUserBalance({ slug }: { slug: string }) {
  const { data: balances, isLoading } = useSuckersUserTokenBalance();
  const { token } = useJBTokenContext();

  const totalBalance = new JBProjectToken(
    balances?.reduce((acc, curr) => acc + curr.balance.value, 0n) ?? 0n,
  );

  if (isLoading || token.isLoading) {
    return <Skeleton className="h-9 w-28 grow-0" role="status" aria-label="Loading balance" />;
  }

  return (
    <Link
      className="min-h-11 text-black border border-zinc-200 px-2 py-1 flex items-center hover:bg-zinc-100 duration-75"
      href={`/${decodeURIComponent(slug)}/owners?subtab=accounts`}
      aria-label={`View ${formatTokenSymbol(token)} balance in Owners accounts`}
    >
      {totalBalance.format(2)}{" "}
      <span className="text-teal-700 ml-1.5 font-medium">{formatTokenSymbol(token)}</span>
    </Link>
  );
}
