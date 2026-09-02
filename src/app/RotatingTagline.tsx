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

  return (
    <span key={index} className="animate-in fade-in-0 whitespace-nowrap duration-500">
      {PHRASES[index]}
    </span>
  );
}
