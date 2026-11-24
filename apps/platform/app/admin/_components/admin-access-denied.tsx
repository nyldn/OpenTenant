import { AccessDenied } from "@opentenant/design-system";

export function AdminAccessDenied() {
  return <main className="mx-auto w-full max-w-4xl px-6 py-10">
    <AccessDenied state="forbidden" action={{ label: "Go home", href: "/" }} />
  </main>;
}
