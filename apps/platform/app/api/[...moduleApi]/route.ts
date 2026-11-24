import { installedModules } from "../../../opentenant-modules";
import { moduleServicesFor } from "../../../lib/module-services";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const route = installedModules.apiRoute(new URL(request.url).pathname);
  if (!route) return new Response(null, { status: 404 });
  const definition = installedModules.modules.find(entry => entry.apiRoutes?.includes(route));
  return definition ? route.handle(request, moduleServicesFor(definition.manifest.key)) : new Response(null, { status: 404 });
}
