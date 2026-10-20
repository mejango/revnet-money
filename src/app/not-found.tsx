import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center">
      <h2 className="text-4xl mb-3">Revnet Not Found</h2>
      {/* A plain link: next/link here put the home bundle on every route that renders a 404. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- keeps next/link off the 404 bundle */}
      <a href="/">
        <Button>Return Home</Button>
      </a>
    </div>
  );
}
