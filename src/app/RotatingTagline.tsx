"use client";

import { useEffect, useState } from "react";

const PHRASES = ["business model", "shared project", "community fund", "revenue network"];

export function RotatingTagline() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), 3000);
    return () => clearInterval(id);
  }, []);

  const phrase = PHRASES[index];
  // The tagline is monospace, so `ch` is the phrase's exact width. Easing the
  // width slides the centered line as phrases of different lengths come up.
  return (
    <span
      className="inline-block overflow-hidden whitespace-nowrap text-left align-bottom transition-[width] duration-500 ease-out motion-reduce:transition-none"
      style={{ width: `${phrase.length}ch` }}
    >
      <span
        key={phrase}
        className="inline-block animate-in fade-in-0 slide-in-from-bottom-3 duration-500 motion-reduce:animate-none"
      >
        {phrase}
      </span>
    </span>
  );
}
