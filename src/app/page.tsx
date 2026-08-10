import { Nav } from "@/components/layout/Nav";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { HomepageDiscovery } from "./HomepageDiscovery";

const WHY_REVNET_POINTS = [
  "Let builders, investors, customers, and communities share in the same growth by turning fundraises and revenue into tokens that align their interests.",
  "Welcome support and revenue from anywhere, anytime by accepting money instantly, beyond borders and banking hours.",
  "Give holders confidence their backing will remain intact by locking incoming funds for cash-outs and loans only.",
  "Make lasting contribution more valuable than short-term participation by rewarding those who join earlier and stay longer.",
  "Give builders and contributors predictable funding by allocating a fixed share of new tokens to incentives over time.",
  "Make future terms predictable from day one by automating issuance, splits, and cash-out terms through predefined stages.",
  "Protect the original deal from governance capture and insider overreach by preventing votes or administrators from rewriting its core terms.",
  "Keep tokens liquid without permanent subsidies by making and taking liquidity in open markets.",
  "Give users consistent economics across supported Ethereum chains through one programmable financial network.",
  "Own your distribution, customer relationships, and integrations by building your own website or app around payment, cash-out, and loan functions.",
  "Keep network costs transparent and predictable with a clearly defined fee that sustains the public payment network.",
  "Access liquidity without selling future upside by borrowing against revenue-backed tokens directly from the revnet.",
  "Verify the system instead of trusting an operator by making every rule, balance, and transaction openly inspectable.",
  "Make every revnet easier to trust, integrate, and extend through a shared standard that grows more useful with the network.",
];

export default function Page() {
  return (
    <>
      <Nav />
      <div className="mx-auto mt-12 max-w-[1800px] px-6 sm:mt-16 sm:px-8">
        <Suspense fallback={<div className="min-h-[520px] animate-pulse" />}>
          <HomepageDiscovery />
        </Suspense>

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
            Guarantees that stand the test of time.
          </h2>
          <ol className="mt-6 ml-8 list-outside list-decimal space-y-3 sm:ml-10">
            <li>Money enters through fundraises and revenues.</li>
            <li>
              Funds are only used to issue new tokens or buyback from the market, whichever is
              better.
            </li>
            <li>Payers receive the tokens, with some optionally split to builders and others.</li>
            <li>
              Funds used to issue tokens stay in the revnet&apos;s balance, adding to the total
              value backing all the network&apos;s tokens.
            </li>
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
            <span className="block">Simple enough for startups.</span>
            <span className="block">Powerful enough for global organizations.</span>
          </h2>

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
