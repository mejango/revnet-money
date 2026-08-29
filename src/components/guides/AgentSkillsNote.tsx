import type { ReactNode } from "react";

const SKILLS_URL = "https://github.com/mejango/juicebox-skills";

/**
 * The one line for readers who are learning or building with an agent: the prompt to hand it,
 * if the page has one, and the skills library it should work from. Reads fine to a person too.
 */
export function AgentSkillsNote({
  skills,
  prompt,
}: {
  skills: readonly string[];
  /** The page's copy-the-prompt control, when it has one. */
  prompt?: ReactNode;
}) {
  const skillList = skills.map((skill, i) => (
    <span key={skill}>
      {i > 0 ? (i === skills.length - 1 ? " and " : ", ") : ""}
      <code className="text-sm">{skill}</code>
    </span>
  ));
  const library = (
    <a
      href={SKILLS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-melon-400 underline-offset-4"
    >
      Juicebox V6 skills
    </a>
  );

  return (
    <p className="text-base text-zinc-600">
      {prompt ? (
        <>
          Building with an agent? {prompt}, and give it the {library} so it works from the deployed
          addresses, ABIs, and economics rather than from memory. The revnet ones are {skillList}.
        </>
      ) : (
        <>
          Reading with an agent? Give it the {library} so it answers from the deployed addresses,
          ABIs, and economics rather than from memory. The revnet ones are {skillList}.
        </>
      )}
    </p>
  );
}
