"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Button, Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, useSidebar,
} from "@opentenant/design-system";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ShellNavigationItem { href: string; label: string }

function MenuButton() {
  const { toggleSidebar, isMobile, openMobile } = useSidebar();
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !openMobile) trigger.current?.focus();
    wasOpen.current = openMobile;
  }, [openMobile]);
  return <Button ref={trigger} type="button" variant="outline" className="md:hidden" onClick={toggleSidebar}
    aria-label="Open navigation menu" aria-expanded={isMobile && openMobile}>Menu</Button>;
}

function Navigation({ items }: { items: ShellNavigationItem[] }) {
  const path = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  return <Sidebar>
    <SidebarHeader><span className="px-2 py-2 font-semibold">Navigation</span>
      {isMobile ? <Button variant="outline" onClick={() => setOpenMobile(false)}>Close menu</Button> : null}
    </SidebarHeader>
    <SidebarContent><nav aria-label="Application navigation"><SidebarMenu className="p-2">
      {items.map(item => <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={path === item.href} className="h-auto min-h-11 whitespace-normal break-words">
          <Link href={item.href} aria-current={path === item.href ? "page" : undefined}
            onClick={() => setOpenMobile(false)}>{item.label}</Link>
        </SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu></nav></SidebarContent>
  </Sidebar>;
}

/** Breadcrumb labels come from authorized navigation, never from tenant content in the URL. */
export function ApplicationBreadcrumbs({ items }: { items: ShellNavigationItem[] }) {
  const path = usePathname();
  const segments = path.split("/").filter(Boolean);
  return <nav aria-label="Breadcrumb" className="px-4 pt-4 text-sm sm:px-6">
    <ol className="flex flex-wrap items-center gap-2">
      <li><Link className="inline-flex min-h-11 items-center underline" href="/">Home</Link></li>
      {segments.map((segment, i) => {
        const href = `/${segments.slice(0, i + 1).join("/")}`;
        const label = items.find(item => item.href === href)?.label ??
          ({ tenants: "Tenants", modules: "Modules", settings: "Settings", admin: "Platform admin" }[segment] ?? "Detail");
        return <li key={href} className="flex items-center gap-2"><span aria-hidden="true">/</span>
          {i === segments.length - 1 || !items.some(item => item.href === href) ? <span aria-current={i === segments.length - 1 ? "page" : undefined}>{label}</span> :
            <Link className="inline-flex min-h-11 items-center underline" href={href}>{label}</Link>}
        </li>;
      })}
    </ol>
  </nav>;
}

export function ApplicationShellFrame({ items, header, banner, footer, children, legacyAdmin = false, adminOnly = false }: {
  items: ShellNavigationItem[]; header: ReactNode; banner?: ReactNode; footer?: ReactNode; children: ReactNode; legacyAdmin?: boolean; adminOnly?: boolean;
}) {
  const path = usePathname();
  // Root layouts persist across client navigation. Select the admin boundary
  // from the live pathname so entering/leaving admin never loses host chrome.
  if (adminOnly && path !== "/admin" && !path.startsWith("/admin/")) return children;
  return <SidebarProvider className="min-w-0 bg-background text-foreground">
    <a href="#main-content" className="sr-only z-50 rounded-md bg-background p-3 text-foreground focus:not-sr-only focus:fixed focus:left-2 focus:top-2">Skip to content</a>
    <Navigation items={items} />
    <div className="min-w-0 flex-1">
      {banner}
      <header data-application-header className="border-b border-border p-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3"><MenuButton />{header}</div>
      </header>
      <ApplicationBreadcrumbs items={items} />
      <div id="main-content" tabIndex={-1} className={legacyAdmin
        ? "min-w-0 [overflow-wrap:anywhere] [&>div>header]:hidden [&_header+main]:pt-4"
        : "min-w-0 [overflow-wrap:anywhere]"}>{children}</div>
      {footer}
    </div>
  </SidebarProvider>;
}

/** Retain a host heading while a client-only module mounts. The module's own
 * h1 takes over once present, including after client-side stage changes.
 */
export function ApplicationModuleContent({ title, children }: { title: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const [hasHeading, setHasHeading] = useState(false);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const refresh = () => setHasHeading(element.querySelector("h1") !== null);
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <>
    {/* :has() hides the placeholder in server HTML too, before hydration runs the effect. */}
    {!hasHeading ? <h1 className="px-4 pt-4 font-display text-2xl font-bold sm:px-6 [&:has(+div_h1)]:hidden">{title}</h1> : null}
    <div ref={body}>{children}</div>
  </>;
}
