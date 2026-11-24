import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { ApplicationShell } from "./_components/application-shell";
import { currentSession } from "../lib/session";
import type { ReactNode } from "react";
import { tenantBrandStyle } from "../lib/custom-domains-theme";
import { brandForTenant } from "../lib/brand";
import { clerkBrowserPublishableKey } from "../lib/clerk-browser-config";
import { usesClerkIdentity } from "../lib/identity-provider";
import { SuspendedTenantPage } from "../lib/tenant-suspended-page";
import { currentTenant, tenantLifecycleForHost } from "../lib/tenant";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const tenant = await currentTenant();
  if (!tenant) return { title: "404", robots: { index: false } };
  const brand = await brandForTenant(tenant.tenantId);
  return { title: brand.displayName };
}

/**
 * Root layout resolves the tenant from the host (spec section 7) and applies
 * its brand: the data-brand attribute selects the compiled CSS token theme
 * from globals.css, and the title comes from the resolved snapshot. Unknown
 * production hosts render a generic response with no tenant details.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const tenant = await currentTenant();

  const lifecycle = await tenantLifecycleForHost();
  if (lifecycle?.status === "suspended") {
    return <html lang="en"><body><SuspendedTenantPage /></body></html>;
  }

  // Middleware rejects unknown hosts before React. This fail-closed fallback
  // also handles a domain being revoked between resolution and rendering.
  if (!tenant) return <html lang="en"><body><main><h1>Not found</h1></main></body></html>;

  const brand = await brandForTenant(tenant.tenantId);

  const content = <ApplicationShell section="admin" adminOnly session={await currentSession()}>{children}</ApplicationShell>;

  return (
    <html lang="en" data-brand={brand.cssBrandKey} className="dark" style={tenantBrandStyle(brand)}>
      <body>
        {usesClerkIdentity() ? (
          <ClerkProvider publishableKey={clerkBrowserPublishableKey()}>{content}</ClerkProvider>
        ) : content}
      </body>
    </html>
  );
}
