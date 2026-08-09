import Link from "next/link";

type RevnetGuidePoint = string | { key: string; text: string };

export type RevnetGuideSection = {
  id: string;
  title: string;
  summary: string;
  paragraphs?: readonly string[];
  points?: readonly RevnetGuidePoint[];
  note?: string;
  links?: readonly { href: string; label: string }[];
};

type Props = {
  eyebrow: string;
  title: string;
  introduction: string;
  sections: readonly RevnetGuideSection[];
  companion: { href: string; label: string; description: string };
  afterIntroduction?: React.ReactNode;
  afterSections?: React.ReactNode;
};

function SectionLink({ href, label }: { href: string; label: string }) {
  const external = href.startsWith("http");

  return (
    <Link
      href={href}
      className="underline decoration-melon-400 underline-offset-4 hover:text-melon-700"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {label}
    </Link>
  );
}

export function RevnetGuide({
  eyebrow,
  title,
  introduction,
  sections,
  companion,
  afterIntroduction,
  afterSections,
}: Props) {
  return (
    <div className="container px-6 py-12 sm:px-8 sm:py-16">
      <header className="max-w-[78ch]">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-melon-700">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-zinc-700 sm:text-xl">{introduction}</p>
        {afterIntroduction ? <div className="mt-5">{afterIntroduction}</div> : null}
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <nav
          aria-label={`${eyebrow} contents`}
          className="border border-melon-200 bg-melon-50 p-5 lg:sticky lg:top-6"
        >
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-600">
            Contents
          </p>
          <ol className="mt-4 space-y-3 text-sm leading-snug">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="grid grid-cols-[1.7rem_1fr] gap-1 underline-offset-4 hover:text-melon-700 hover:underline"
                >
                  <span className="text-zinc-500">{index + 1}.</span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          {sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-6 border-t border-melon-200 py-10 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start gap-4">
                <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center border border-melon-300 bg-melon-100 text-sm font-semibold text-melon-800">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold sm:text-3xl">{section.title}</h2>
                  <p className="mt-3 text-lg leading-relaxed text-zinc-700">{section.summary}</p>
                </div>
              </div>

              <div className="ml-0 mt-6 space-y-5 text-base leading-relaxed text-zinc-700 sm:ml-12 sm:text-lg">
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}

                {section.points?.length ? (
                  <ul className="ml-6 list-outside list-square space-y-3 marker:text-melon-600">
                    {section.points.map((point) => (
                      <li key={typeof point === "string" ? point : point.key} className="pl-1">
                        {typeof point === "string" ? (
                          point
                        ) : (
                          <>
                            <strong className="font-semibold text-zinc-900">{point.key}:</strong>{" "}
                            {point.text}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {section.note ? (
                  <div className="border-l-4 border-peel-400 bg-peel-50 px-5 py-4 text-zinc-800">
                    {section.note}
                  </div>
                ) : null}

                {section.links?.length ? (
                  <p className="flex flex-wrap gap-x-5 gap-y-2 text-base">
                    {section.links.map((link) => (
                      <SectionLink key={link.href} href={link.href} label={link.label} />
                    ))}
                  </p>
                ) : null}
              </div>
            </section>
          ))}

          {afterSections ? (
            <div className="border-t border-melon-200 pt-8">{afterSections}</div>
          ) : null}

          <aside className="mt-10 border border-melon-300 bg-melon-50 p-6 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-melon-700">
              Keep going
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              <Link href={companion.href} className="underline underline-offset-4">
                {companion.label}
              </Link>
            </h2>
            <p className="mt-3 leading-relaxed text-zinc-700">{companion.description}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
