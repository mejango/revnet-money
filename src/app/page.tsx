import { Nav } from "@/components/layout/Nav";
import Image from "next/image";
import Link from "next/link";
import { HomepageDiscovery } from "./HomepageDiscovery";

const WHY_REVNET_POINTS = [
  {
    lead: "Share the upside.",
    detail:
      "Fundraises and revenue issue tokens to builders, investors, customers, and communities, aligning everyone around the same growth.",
  },
  {
    lead: "Accept money from anyone, anywhere, at any time.",
    detail: "Payments arrive instantly, beyond borders and banking hours.",
  },
  {
    lead: "Protect token backing.",
    detail: "Incoming funds stay locked in the revnet for holder cash-outs and loans.",
  },
  {
    lead: "Reward long-term participation.",
    detail: "Joining earlier and staying longer is more valuable than short-term participation.",
  },
  {
    lead: "Fund builders predictably.",
    detail: "A fixed share of newly issued tokens can support builders and contributors over time.",
  },
  {
    lead: "Lock in future terms from day one.",
    detail: "Predefined stages automate issuance, splits, and cash-out terms.",
  },
  {
    lead: "Keep the original deal intact.",
    detail: "Neither voters nor administrators can rewrite its core terms.",
  },
  {
    lead: "Keep tokens liquid without permanent subsidies.",
    detail: "Anyone can make or take liquidity in open markets.",
  },
  {
    lead: "Use consistent economics across chains.",
    detail: "One programmable financial network connects every supported Ethereum chain.",
  },
  {
    lead: "Own your distribution and customer relationships.",
    detail: "Build any website or app around revnet payments, cash-outs, and loans.",
  },
  {
    lead: "Know the network fee upfront.",
    detail: "One clearly defined fee keeps costs predictable and sustains the public network.",
  },
  {
    lead: "Borrow without selling future upside.",
    detail: "Revenue-backed tokens can secure loans directly from the revnet.",
  },
  {
    lead: "Verify instead of trust.",
    detail: "Every rule, balance, and transaction is openly inspectable.",
  },
  {
    lead: "Build on a shared standard.",
    detail: "Every revnet becomes easier to trust, integrate, and extend as the network grows.",
  },
];

export default function Page() {
  return (
    <>
      <Nav />
      <div className="mx-auto mt-4 max-w-[1800px] px-6 sm:mt-16 sm:px-8">
        <HomepageDiscovery />

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
          <h2
            id="how-revnets-work"
            className="text-center text-2xl font-semibold md:text-left md:text-3xl"
          >
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
          <h2
            id="why-revnets"
            className="text-center text-2xl font-semibold md:text-left md:text-3xl"
          >
            <span className="block">Simple enough for startups.</span>
            <span className="block">Powerful enough for global organizations.</span>
          </h2>

          <ol className="mt-8 ml-8 list-outside list-decimal space-y-5 marker:font-semibold marker:text-teal-700 sm:ml-10">
            {WHY_REVNET_POINTS.map(({ lead, detail }) => (
              <li key={lead} className="pl-2">
                <strong>{lead}</strong> {detail}
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
          <h2 id="join-us" className="text-center text-2xl font-semibold md:text-left md:text-3xl">
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
