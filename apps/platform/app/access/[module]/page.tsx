import { notFound } from "next/navigation";
import { installedModules } from "../../../opentenant-modules";
export default async function ModuleAccessPage({ params, searchParams }: {
  params: Promise<{ module: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const definition = installedModules.get((await params).module);
  if (!definition?.permissions.passcode?.length) notFound();
  return <main className="mx-auto max-w-sm p-8">
    <h1>{definition.catalog.displayName}</h1>
    <form method="POST" action={`/api/module-access/${definition.manifest.key}`}>
      <label>Access code<input type="password" name="passcode" autoComplete="off" required /></label>
      {(await searchParams).error ? <p>That code was not accepted. Try again.</p> : null}
      <button type="submit">Continue</button>
    </form>
  </main>;
}
