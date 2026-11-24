/**
 * Neon provisioning adapter (spec 9.2, section 17 work package 3).
 *
 * One Neon project per tenant, created region-aware. The adapter speaks the
 * Neon REST API through injected fetch so tests never touch the network.
 * Connection URIs returned by Neon are handed straight to CredentialCipher
 * by the caller; this module never logs or persists them.
 */

export interface NeonProjectResult {
  projectId: string;
  /** Plaintext connection URI; encrypt immediately, never store or log raw. */
  connectionUri: string;
  region: string;
}

export interface NeonProvisionerConfig {
  apiKey: string;
  orgId: string;
  apiBaseUrl?: string;
}

/** Maps platform data regions to Neon region identifiers. */
const NEON_REGION_FROM_DATA_REGION: Readonly<Record<"us" | "eu", string>> = {
  us: "aws-us-east-1",
  eu: "aws-eu-central-1",
};

function verifiedTlsConnectionUri(connectionUri: string): string {
  try {
    const uri = new URL(connectionUri);
    if (uri.protocol !== "postgres:" && uri.protocol !== "postgresql:") throw new Error();
    // pg v8 treats `require` as verify-full, but pg v9 adopts libpq's weaker
    // semantics. Pin hostname verification at the provider boundary so stored
    // and migration URIs remain fail-closed across that dependency upgrade.
    uri.searchParams.set("sslmode", "verify-full");
    return uri.toString();
  } catch {
    // URL errors may include the input, which contains credentials.
    throw new Error("Neon returned an invalid connection URI");
  }
}

export class NeonProvisioner {
  private readonly baseUrl: string;

  constructor(
    private readonly config: NeonProvisionerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config.apiBaseUrl ?? "https://console.neon.tech/api/v2";
  }

  /**
   * Find an existing project by its deterministic name. Used before create
   * so a crash between project creation and checkpoint persistence cannot
   * produce a duplicate project on retry.
   */
  async findProjectByName(name: string): Promise<{ projectId: string; region: string } | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/projects?org_id=${encodeURIComponent(this.config.orgId)}&search=${encodeURIComponent(name)}`,
      { headers: { authorization: `Bearer ${this.config.apiKey}` } },
    );
    if (!response.ok) {
      throw new Error(`Neon project search failed with status ${response.status}`);
    }
    const body = (await response.json()) as {
      projects: Array<{ id: string; name: string; region_id: string }>;
    };
    const match = body.projects.find((p) => p.name === name);
    return match ? { projectId: match.id, region: match.region_id } : null;
  }

  static tenantProjectName(tenantSlug: string): string {
    return `opentenant-tenant-${tenantSlug}`;
  }

  async createTenantProject(tenantSlug: string, dataRegion: "us" | "eu" | "ap"): Promise<NeonProjectResult> {
    if (dataRegion === "ap") throw new Error("Neon provisioning region is unsupported");
    const region = NEON_REGION_FROM_DATA_REGION[dataRegion];
    const response = await this.fetchImpl(`${this.baseUrl}/projects`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        project: {
          name: NeonProvisioner.tenantProjectName(tenantSlug),
          region_id: region,
          org_id: this.config.orgId,
          // Chosen, not defaulted (production checklist): Postgres major is
          // pinned, and every tenant compute autoscales 0.25-2 CU with
          // scale-to-zero left on as the fleet cost-control mechanism.
          pg_version: 17,
          default_endpoint_settings: {
            autoscaling_limit_min_cu: 0.25,
            autoscaling_limit_max_cu: 2,
          },
        },
      }),
    });

    if (!response.ok) {
      // Body may echo configuration; report status only.
      throw new Error(`Neon project creation failed with status ${response.status}`);
    }

    const body = (await response.json()) as {
      project: { id: string };
      connection_uris: Array<{ connection_uri: string }>;
    };
    const connectionUri = body.connection_uris[0]?.connection_uri;
    if (!connectionUri) throw new Error("Neon project created but no connection URI returned");

    return {
      projectId: body.project.id,
      connectionUri: verifiedTlsConnectionUri(connectionUri),
      region,
    };
  }

  /** Re-fetch the connection URI for an existing project (resume path). */
  async getConnectionUri(projectId: string): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/projects/${projectId}/connection_uri?database_name=neondb&role_name=neondb_owner`,
      { headers: { authorization: `Bearer ${this.config.apiKey}` } },
    );
    if (!response.ok) {
      throw new Error(`Neon connection URI fetch failed with status ${response.status}`);
    }
    const body = (await response.json()) as { uri: string };
    if (!body.uri) throw new Error("Neon returned no connection URI");
    return verifiedTlsConnectionUri(body.uri);
  }

  async deleteProject(projectId: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/projects/${projectId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.config.apiKey}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Neon project deletion failed with status ${response.status}`);
    }
  }
}
