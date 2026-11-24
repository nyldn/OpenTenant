"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Table } from "@opentenant/design-system";

/** Table keeps its shared markup; the outer viewport owns scrolling and focus. */
export function AdminTable({ name, className = "", ...props }: ComponentProps<typeof Table> & { name: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    const content = table.current;
    if (!element || !content) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return <div ref={viewport} role={overflows ? "region" : undefined}
    aria-label={overflows ? name : undefined} tabIndex={overflows ? 0 : undefined}
    className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>[data-slot=table-container]]:overflow-visible">
    <Table {...props} ref={table} className={`min-w-[48rem] table-fixed text-left [&_th]:px-4 [&_th]:py-2 [&_td]:px-4 [&_td]:py-2 [&_td]:[overflow-wrap:anywhere] ${className}`} />
  </div>;
}
