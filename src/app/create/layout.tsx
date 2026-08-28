import { pageMetadata } from "@/lib/pageMetadata";
import type { Metadata } from "next";

const title = "Create a revnet";
const description =
  "Launch a revnet: set the issuance, cash out and split terms once, and let the contracts enforce them.";

// page.tsx is a client component and so cannot export metadata of its own. Without this
// the launch flow inherited the site-wide card and shared the homepage's exact title.
export const metadata: Metadata = pageMetadata({ title, description });

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
