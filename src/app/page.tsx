import { Nav } from "@/components/layout/Nav";
import Image from "next/image";
import Link from "next/link";
import { HomepageDiscovery } from "./HomepageDiscovery";

const WHY_REVNET_POINTS = [
  {
    lead: "Accept money across borders.",
    detail: "Receive payments at any time, on supported chains.",
  },
  {
    lead: "Build your own website or app.",
    detail: "Use the same payments, cash-outs, and loans in your own products.",
  },
  {
    lead: "Use the same terms across chains.",
    detail: "Connect the revnet across supported Ethereum chains, with money held on each chain.",
  },
  {
    lead: "Trade on open markets.",
    detail:
      "Anyone can offer tokens for sale. The available buyers and sellers determine the price.",
  },
  {
    lead: "Check the rules and the money.",
    detail: "Anyone can inspect the contracts, balances, and transactions.",
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
            How a revnet works.
          </h2>
          <p className="mt-4">
            A revnet receives money and shares tokens with the people who take part. Those tokens
            let holders claim money from its balance under rules set at launch.
          </p>
          <ol className="mt-6 ml-8 list-outside list-decimal space-y-3 sm:ml-10">
            <li>
              Payments from fundraising, sales, and other sources create new tokens. If set up to do
              so, they can buy existing tokens when that returns more.
            </li>
            <li>The payer receives tokens. A set share can also go to builders and others.</li>
            <li>The revnet keeps money used to create tokens in its balance.</li>
            <li>
              Holders can give up tokens for money from the balance. This is a cash-out, and the
              revnet&apos;s rules determine how much it returns.
            </li>
            <li>
              Holders can also borrow against their tokens, then repay to get them back before the
              loan expires.
            </li>
            <li>
              The launch plan can set different terms for later periods, called stages. A schedule
              can give earlier payments more tokens for the same amount of money.
            </li>
          </ol>
          <p className="mt-4">
            <Link href="/learn" className="underline">
              Learn how the pieces fit together
            </Link>
            , or look up a word in the{" "}
            <Link href="/learn#glossary" className="underline">
              glossary
            </Link>
            .
          </p>
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
            , the revnet that supports this network.
          </p>
        </section>

        <div className="border border-zinc-100 mt-12"></div>
      </div>
    </>
  );
}
