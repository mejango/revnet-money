"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { PropsWithChildren, useEffect, useRef, useState } from "react";

export function ProjectMenu({
  mobileActivityActive = false,
  onMobileActivityChange,
}: {
  mobileActivityActive?: boolean;
  onMobileActivityChange?: (active: boolean) => void;
}) {
  return (
    <div className="flex border-b border-zinc-200">
      <ul className="scrollbar-none flex min-w-0 flex-1 gap-4 overflow-x-auto sm:gap-6">
        <MobileActivityOption
          active={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(true)}
        />
        <MenuOption
          href=""
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          Overview
        </MenuOption>
        <MenuOption
          href="terms"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          Terms
        </MenuOption>
        <MenuOption
          href="owners"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          Owners
        </MenuOption>
        <MenuOption
          href="shop"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          Shop
        </MenuOption>
      </ul>
      <MoreProjectOptions
        forceInactive={mobileActivityActive}
        onSelect={() => onMobileActivityChange?.(false)}
      />
    </div>
  );
}

function MoreProjectOptions({
  forceInactive,
  onSelect,
}: {
  forceInactive: boolean;
  onSelect: () => void;
}) {
  const params = useParams<{ slug: string }>();
  const segment = useSelectedLayoutSegment();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = [
    { href: "extras", label: "Extras" },
    { href: "operator", label: "Operator" },
  ];
  const active = forceInactive ? undefined : options.find((option) => option.href === segment);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative ml-auto shrink-0"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`More project sections${active ? `, current: ${active.label}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "-mb-px flex min-h-11 min-w-11 items-center justify-center border-b-2 px-3 text-2xl leading-none transition-all",
          active
            ? "border-teal-500 text-black"
            : "border-transparent text-zinc-500 hover:text-zinc-800",
        )}
      >
        <span aria-hidden>⋮</span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="More project sections"
          className="absolute right-0 top-full z-40 mt-1 min-w-36 border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {options.map((option) => {
            const selected = !forceInactive && segment === option.href;
            return (
              <Link
                key={option.href}
                href={`/${decodeURIComponent(params.slug)}/${option.href}`}
                role="menuitem"
                aria-current={selected ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                  requestAnimationFrame(() => trigger.current?.focus());
                }}
                className={cn(
                  "block min-h-10 px-4 py-2 text-sm transition-colors",
                  selected
                    ? "bg-melon-50 font-medium text-black"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MobileActivityOption({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  return (
    <li className="flex items-start min-[601px]:hidden">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 pb-2 text-base font-medium uppercase transition-all",
          active
            ? "border-teal-500 text-black"
            : "border-transparent text-zinc-500 hover:text-zinc-800",
        )}
      >
        Activity
      </button>
    </li>
  );
}

function MenuOption({
  href,
  children,
  badge,
  forceInactive = false,
  onSelect,
}: PropsWithChildren<{
  href: string;
  badge?: string;
  forceInactive?: boolean;
  onSelect?: () => void;
}>) {
  const params = useParams<{ slug: string }>();
  const segment = useSelectedLayoutSegment();
  const isSelected = !forceInactive && (segment || "") === href;

  return (
    <li className="flex items-start gap-2">
      <Link
        href={`/${decodeURIComponent(params.slug)}/${href}`}
        onClick={onSelect}
        className={cn(
          // -mb-px drops the active border onto the row's persistent baseline.
          "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 pb-2 text-base font-medium uppercase transition-all sm:text-lg",
          {
            "text-black border-teal-500": isSelected,
            "text-zinc-500 hover:text-zinc-800 border-transparent": !isSelected,
          },
        )}
      >
        {children}
      </Link>
      {badge && (
        <span className="rounded-xl border border-teal-400 text-teal-500 font-medium text-[13px] px-2 py-1">
          {badge}
        </span>
      )}
    </li>
  );
}
