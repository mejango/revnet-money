"use client";

import { WalletButton } from "@/components/WalletButton";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RevnetSearch } from "./RevnetSearch";

export function Nav({ wide = false }: { wide?: boolean }) {
  const pathname = usePathname();
  const isWide = wide || pathname === "/";

  return (
    <nav className="text-zinc-50 border-b border-zinc-100">
      <div
        data-site-nav-layout
        className={`mx-auto grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-[clamp(0.5rem,1.5vw,2rem)] px-4 py-3 md:grid-cols-[minmax(max-content,1fr)_minmax(12rem,32rem)_minmax(max-content,1fr)] ${
          isWide ? "max-w-[1800px]" : "max-w-[1536px]"
        }`}
      >
        <div className="col-start-1 row-start-1 flex flex-col items-start justify-self-start gap-y-1 md:flex-row md:items-center md:gap-x-4">
          <Link href="/" className="inline-flex min-h-11 min-w-11 items-center italic">
            <Image
              src="/assets/img/small-bw.svg"
              width={288}
              height={140}
              className="h-auto w-[60px]"
              alt="Revnet logo"
            />
          </Link>
          <div
            aria-label="Revnet guides"
            // Stacked under the logo on phones, the links sit tight against it so
            // the two lines read as one block centered on the search bar.
            className="-mt-2 flex items-center gap-1 whitespace-nowrap text-xs leading-normal text-zinc-600 sm:gap-2 sm:text-sm md:mt-0 md:min-h-11"
          >
            <Link href="/learn" className="underline-offset-4 hover:underline hover:text-zinc-900">
              Learn
            </Link>
            <span aria-hidden className="text-zinc-400">
              |
            </span>
            <Link href="/build" className="underline-offset-4 hover:underline hover:text-zinc-900">
              Build
            </Link>
            <span aria-hidden className="text-zinc-400">
              |
            </span>
            <Link href="/audit" className="underline-offset-4 hover:underline hover:text-zinc-900">
              Audit
            </Link>
          </div>
        </div>
        <div
          data-site-nav-search
          className="col-start-2 row-start-1 w-full min-w-0 max-w-lg justify-self-center"
        >
          <RevnetSearch />
        </div>
        <div
          data-site-nav-wallet
          className="col-start-3 row-start-1 flex min-w-0 max-w-full items-stretch justify-self-end [&>*]:min-w-0 [&>*]:max-w-full [&_button]:max-w-full [&>button]:min-h-11"
        >
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
