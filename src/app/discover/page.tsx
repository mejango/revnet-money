import { Button } from "@/components/ui/button";
import { getDiscoverProjects } from "@/lib/discoverProjects.server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DiscoverList, type RevnetProject } from "./DiscoverList";

const title = "Discover revnets";
const description =
  "Every indexed revnet on Ethereum, Optimism, Base and Arbitrum, with what each one funds.";

export const metadata: Metadata = {
  title,
  description,
  // Without its own card this page inherited the site-wide one, so /discover and the
  // homepage shared a title, a description and a preview image.
  openGraph: { title, description },
  twitter: { title, description },
};

// The catalogue changes when a revnet launches, not by the minute.
export const revalidate = 300;

export default async function Page() {
  // An indexer outage must not 500 the page: the client falls back to fetching the API.
  const projects: RevnetProject[] = await getDiscoverProjects().catch(() => []);

  return (
    <div className="container mt-40 pr-[1.5rem] pl-[1.5rem] sm:pr-[2rem] sm:pl-[2rem] sm:px-8">
      <div className="flex flex-col items-left justify-left">
        <h1>
          <Image
            src="/assets/img/revnet-full-bw.svg"
            width={1509}
            height={140}
            className="h-auto w-[840px] max-w-full"
            loading="eager"
            alt="Revnet"
          />
        </h1>
        <div className="text-xl md:text-2xl mt-8 font-medium text-left">
          Tokenize revenues and fundraises. 100% autonomous.
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="flex gap-4 mt-8">
            <Link href="/">
              <Button className="md:h-12 h-16 text-xl md:text-xl px-4 flex gap-2 bg-teal-500 text-melon-950 hover:bg-teal-600">
                Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
      <div className="border border-zinc-100 mt-10"></div>

      <DiscoverList initialProjects={projects} />
    </div>
  );
}
