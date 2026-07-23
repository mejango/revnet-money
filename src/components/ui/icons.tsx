import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export const CheckIcon = Check;

export function ChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  );
}

export function Loader2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Icon>
  );
}

export function X(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

export function FastForward(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m2 5 8 7-8 7Z" />
      <path d="m12 5 8 7-8 7Z" />
    </Icon>
  );
}

export const FastForwardIcon = FastForward;

export function CheckCircle(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 3 3 5-6" />
    </Icon>
  );
}

export function CircleDashedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
    </Icon>
  );
}

export function CircleDotDashedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <circle cx="12" cy="12" fill="currentColor" r="1" stroke="none" />
    </Icon>
  );
}

export function CircleDotIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" fill="currentColor" r="1" stroke="none" />
    </Icon>
  );
}

export function CircleXIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </Icon>
  );
}

export function SquareArrowOutUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
  );
}

export function CircleAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Icon>
  );
}

export function Lock(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="11" rx="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

export function SquarePen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  );
}

export function Trash2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

export function ArrowRightLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </Icon>
  );
}
