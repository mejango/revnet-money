"use client";

import { useEffect, useState } from "react";

const PHRASES = [
  "business model",
  "coordination engine",
  "money machine",
  "growth flywheel",
  "revenue loop",
  "capital protocol",
  "funding rocket",
  "ownership stack",
  "upside splitter",
  "fundraising rail",
  "economic organism",
  "profit garden",
  "income network",
];

export function RotatingTagline() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), 3000);
    return () => clearInterval(id);
  }, []);

  // Block-level grid: the phrase always sits on its own line, and every phrase
  // shares one cell so the height never changes either.
  return (
    <span className="grid whitespace-nowrap text-center">
      {PHRASES.map((phrase, i) => (
        <span
          key={phrase}
          aria-hidden={i !== index}
          className={`col-start-1 row-start-1 ${i === index ? "animate-in fade-in-0 duration-500" : "invisible"}`}
        >
          {phrase}
        </span>
      ))}
    </span>
  );
}
