"use client";

import { OwnersSection } from "../../../owners/components/OwnersSection";
import { ProjectItem } from "../shared";

// ponytail: temporary shell — replaced by the full website/-parity Owners tab
// (Accounts | Market | Settlement | Splits | Auto issuance | Loans subtabs).
export function V6OwnersTab(_props: { projects: ProjectItem[] }) {
  return <OwnersSection />;
}
