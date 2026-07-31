import { AuditPromptLink } from "@/components/AuditPromptLink";
import { Nav } from "@/components/layout/Nav";
import { TopProjectsTableSkeleton } from "@/components/loading/LoadingSkeletons";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { TopProjectsTable } from "./TopProjectsTable";

const WHY_REVNET_POINTS = [
  "Turn fundraises and revenues into tokens that align builders, investors, customers, and communities, so everyone benefits from the same growth.",
  "Accept money instantly from anyone around the world, so support and revenue are not constrained by borders or banking hours.",
  "Keep incoming funds locked backing the value of the tokens, with access available only through cash outs and loans, so holders can trust that their backing cannot be pulled out from under them.",
  "Reward people who participate earlier and those who stay involved longer, so long-term contribution matters more than short-term extraction.",
  "Split a fixed amount of newly issued tokens over time to incentive mechanisms, so builders and other contributors are funded predictably.",
  "Schedule issuance, splits, and cash-out terms to evolve automatically through stages defined at launch, so everyone can plan around future terms without trusting an administrator.",
  "Avoid governance takeovers and treasury overreach by default, so no vote or insider can rewrite the deal.",
  "Work with open markets to make and take liquidity instead of depending on a separate liquidity program, so tokens can stay liquid without permanent subsidies.",
  "Run one programmable financial network across supported Ethereum chains, so users share the same economics wherever they transact.",
  "Build your own website or app around its pay, cash-out, and loan functions, so teams own their distribution and integrations without platform lock-in.",
  "Pay a predictable, transparent fee that sustains the public payment network, so costs stay knowable instead of changing over time.",
  "Use revenue-backed tokens as collateral for loans issued by the revnet itself, so holders can access liquidity without giving up their future upside.",
  "Inspect every rule, balance, and transaction without asking anyone for permission, so users can verify instead of trust.",
  "Build on a familiar, interoperable standard that becomes easier to trust and extend with every revnet, so each new integration benefits the whole network.",
];

export default function Page() {
  return (
    <>
      <Nav />
      <div className="container mt-16 pr-[1.5rem] pl-[1.5rem] sm:mt-24 sm:pr-[2rem] sm:pl-[2rem] sm:px-8">
        <div className="flex flex-col justify-center items-center">
          <Image
            src="/assets/img/hovercar-cutout.webp"
            width={1619}
            height={971}
            className="aspect-[3.2/1] w-full max-w-[600px] object-cover"
            priority
            alt="Hovercar"
          />
          <Image
            src="/assets/img/revnet-full-bw.svg"
            width={1509}
            height={140}
            className="mt-6 h-auto w-[630px] max-w-full"
            loading="eager"
            alt="Revnet logo"
          />
          <span className="sr-only">Revnet</span>

          <div className="mt-8 text-center text-xl font-medium md:text-2xl">
            <span className="block sm:inline">An autonomous business model</span>{" "}
            <span className="block sm:inline">for the open web.</span>
          </div>

          <div className="flex gap-4 mt-8">
            <Link href="/create">
              <Button className="md:h-12 h-16 text-xl md:text-xl px-4 flex gap-2 bg-teal-500 text-melon-950 hover:bg-teal-600">
                Create yours
              </Button>
            </Link>
          </div>
          <AuditPromptLink className="mt-5 text-center text-sm text-zinc-600" />

          <Suspense fallback={<TopProjectsTableSkeleton />}>
            <TopProjectsTable />
          </Suspense>
        </div>

        <div className="border border-zinc-100 mt-20"></div>

        <section
          aria-labelledby="how-revnets-work"
          className="mx-auto mt-12 max-w-[72ch] text-left text-lg"
        >
          <Image
            src="/assets/img/drapery-cutout.webp"
            width={1200}
            height={800}
            sizes="(max-width: 768px) calc(100vw - 3rem), 720px"
            className="mx-auto mb-10 h-auto w-full max-w-[720px]"
            loading="lazy"
            alt="A classical draped figure"
          />
          <h2 id="how-revnets-work" className="text-2xl font-semibold md:text-3xl">
            How a revnet works
          </h2>
          <p className="mt-4">
            Revnets trade flexibility for guarantees that stand the test of time.
          </p>
          <ol className="mt-6 ml-8 list-outside list-decimal space-y-3 sm:ml-10">
            <li>Money enters through fundraises and revenues.</li>
            <li>
              Funds are only used to issue new tokens or buyback from the market, whichever is
              better.
            </li>
            <li>Payers receive the tokens, with some optionally split to builders and others.</li>
            <li>Funds used to issue tokens stay in the treasury, backing their value.</li>
            <li>
              Holders can cash out tokens for their share of the balance, or borrow against their
              tokens to keep options open.
            </li>
            <li>Cash-out taxes, loan fees, and new revenues reward the holders who remain.</li>
            <li>Issuance, splits, and taxes evolve through stages fixed at launch.</li>
          </ol>
        </section>

        <section
          aria-labelledby="why-revnets"
          className="mx-auto mt-16 max-w-[72ch] text-left text-lg"
        >
          <Image
            src="/assets/img/fig-tree-cutout.webp"
            width={1200}
            height={800}
            sizes="(max-width: 768px) calc(100vw - 3rem), 900px"
            className="mx-auto mb-10 h-auto w-full max-w-[900px]"
            loading="lazy"
            alt="A broad fig tree bearing fruit"
          />
          <h2 id="why-revnets" className="text-2xl font-semibold md:text-3xl">
            Why revnets?
          </h2>
          <p className="mt-4">
            Simple enough for startups. Powerful enough for global organizations.
          </p>

          <ol className="mt-8 ml-8 list-outside list-decimal space-y-5 marker:font-semibold marker:text-teal-700 sm:ml-10">
            {WHY_REVNET_POINTS.map((point) => (
              <li key={point} className="pl-2">
                {point}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="join-us" className="mx-auto mt-16 max-w-[72ch] text-left text-lg">
          <Image
            src="/assets/img/butterfly-cutout.webp"
            width={720}
            height={720}
            sizes="(max-width: 380px) calc(100vw - 3rem), 320px"
            className="mx-auto mb-4 h-auto w-[320px] max-w-full"
            loading="lazy"
            alt="Butterflies"
          />
          <h2 id="join-us" className="text-2xl font-semibold md:text-3xl">
            Join us
          </h2>
          <p className="mt-4">
            <Link href="/eth:3#project-top" prefetch={false} className="underline">
              Participate in REV
            </Link>
            , which grows alongside the network and is modeled as a revnet itself.
          </p>
        </section>

        <div className="border border-zinc-100 mt-12"></div>
      </div>
    </>
  );
}
