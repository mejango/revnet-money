const SKILLS_URL = "https://github.com/mejango/juicebox-skills";

/**
 * The one-line pointer to the skills library, for readers who are learning or building with an
 * agent. Reads fine to a person too: it names what the library is and where it lives.
 */
export function AgentSkillsNote({ skills }: { skills: readonly string[] }) {
  return (
    <p className="text-base text-zinc-600">
      Working with an AI agent? Give it the{" "}
      <a
        href={SKILLS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-melon-400 underline-offset-4"
      >
        Juicebox V6 skills
      </a>
      , which carry the deployed addresses, ABIs, and economics. The revnet ones:{" "}
      {skills.map((skill, i) => (
        <span key={skill}>
          {i > 0 ? ", " : ""}
          <code className="text-sm">{skill}</code>
        </span>
      ))}
      .
    </p>
  );
}
