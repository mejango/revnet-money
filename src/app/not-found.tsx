import { Nav } from "@/components/layout/Nav";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundMessage } from "./NotFoundMessage";

export const metadata: Metadata = { title: "Not found | Revnet" };

export default function NotFound() {
  return (
    <>
      <Nav />
      <div className="flex w-full flex-col items-center px-4 py-24 text-center">
        <h1 className="mb-3 text-4xl">Not found</h1>
        <NotFoundMessage />
        <Button asChild>
          <Link href="/">Return Home</Link>
        </Button>
      </div>
    </>
  );
}
