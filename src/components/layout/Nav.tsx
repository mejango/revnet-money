import { WalletButton } from "@/components/WalletButton";
import Image from "next/image";
import Link from "next/link";
import { RevnetSearch } from "./RevnetSearch";

export function Nav() {
  return (
    <nav className="text-zinc-50 border-b border-zinc-100">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:container md:grid-cols-[minmax(0,1fr)_minmax(18rem,32rem)_minmax(0,1fr)]">
        <div className="flex items-center gap-2 justify-self-start">
          <Link href="/" className="inline-flex min-h-11 min-w-11 items-center italic">
            <Image
              src="/assets/img/small-bw.svg"
              width={288}
              height={140}
              className="h-auto w-[60px]"
              alt="Revnet logo"
            />
          </Link>
        </div>
        <RevnetSearch />
        <div className="flex gap-2 items-stretch justify-self-end [&>button]:min-h-11">
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
