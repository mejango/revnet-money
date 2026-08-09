import { WalletButton } from "@/components/WalletButton";
import Image from "next/image";
import Link from "next/link";
import { RevnetSearch } from "./RevnetSearch";

export function Nav() {
  return (
    <nav className="text-zinc-50 border-b border-zinc-100">
      <div
        data-site-nav-layout
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:container"
      >
        <div className="flex items-center gap-3 justify-self-start">
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
            className="flex items-center gap-2 whitespace-nowrap text-sm text-zinc-600"
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
          </div>
        </div>
        <div data-site-nav-search className="w-full min-w-0 max-w-lg justify-self-center">
          <RevnetSearch />
        </div>
        <div
          data-site-nav-wallet
          className="flex min-w-0 max-w-[55vw] items-stretch justify-self-end sm:max-w-none [&>*]:min-w-0 [&>*]:max-w-full [&_button]:max-w-full [&>button]:min-h-11"
        >
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
