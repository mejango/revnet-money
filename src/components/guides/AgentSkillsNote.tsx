const SKILLS_URL = "https://github.com/mejango/juicebox-skills";

/**
 * The one-line pointer to the skills library, for readers who are learning or building with an
 * agent. Reads fine to a person too: it names what the library is and where it lives.
 */
export function AgentSkillsNote({ skills }: { skills: readonly string[] }) {
  return (
    <p className="text-base text-zinc-600">
      Working with an AI agent? Install the{" "}
      <a
        href={SKILLS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-melon-400 underline-offset-4"
      >
        Juicebox V6 skills
      </a>{" "}
      (a Claude Code plugin:{" "}
      <code className="text-sm">/plugin marketplace add mejango/juicebox-skills</code>
      ). The revnet ones are{" "}
      {skills.map((skill, i) => (
        <span key={skill}>
          {i > 0 ? (i === skills.length - 1 ? " and " : ", ") : ""}
          <code className="text-sm">{skill}</code>
        </span>
      ))}
      ; they carry the deployed addresses, ABIs, and economics so the agent does not work from
      memory.
    </p>
  );
}
