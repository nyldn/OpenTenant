import type { ReactNode } from "react";
import type { ModulePage } from "@opentenant/module-sdk";
export function renderModuleView(view: unknown): ReactNode {
  if (view && typeof view === "object" && "title" in view && "body" in view
      && typeof view.title === "string" && typeof view.body === "string") {
    const page = view as ModulePage;
    return <section><h1>{page.title}</h1><p>{page.body}</p></section>;
  }
  return view as ReactNode;
}
