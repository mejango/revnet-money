"use client";

import { useJBContractContext } from "@bananapus/nana-sdk-react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { PropsWithChildren } from "react";

export function ProjectMenu() {
  const { version } = useJBContractContext();

  // v6 projects get the full website/-parity tab set; earlier versions keep the
  // original tabs untouched.
  if (version === 6) {
    return (
      <ul className="flex gap-4 sm:gap-6 overflow-x-auto">
        <MenuOption href="">Overview</MenuOption>
        <MenuOption href="terms">Terms</MenuOption>
        <MenuOption href="owners">Owners</MenuOption>
        <MenuOption href="shop">Shop</MenuOption>
        <MenuOption href="extras">Extras</MenuOption>
        <MenuOption href="operator">Operator</MenuOption>
      </ul>
    );
  }

  return (
    <ul className="flex gap-4 sm:gap-6">
      <MenuOption href="">About</MenuOption>
      <MenuOption href="terms">Terms</MenuOption>
      <MenuOption href="owners">Owners</MenuOption>
      <MenuOption href="ops">Ops</MenuOption>
    </ul>
  );
}

function MenuOption({
  href,
  children,
  badge,
}: PropsWithChildren<{ href: string; badge?: string }>) {
  const params = useParams<{ slug: string }>();
  const segment = useSelectedLayoutSegment();
  const isSelected = (segment || "") === href;

  return (
    <li className="flex items-start gap-2">
      <Link
        href={`/${decodeURIComponent(params.slug)}/${href}`}
        className={clsx(
          "flex items-start text-xl sm:text-2xl font-medium transition-all whitespace-nowrap",
          {
            "text-black underline decoration-teal-500 underline-offset-8 decoration-2": isSelected,
            "text-zinc-500 hover:text-zinc-800": !isSelected,
          },
        )}
      >
        {children}
      </Link>
      {badge && (
        <span className="rounded-xl border border-teal-400 text-teal-500 font-medium text-[13px] px-2 py-1">
          {badge}
        </span>
      )}
    </li>
  );
}
