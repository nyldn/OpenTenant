import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ModuleScreen() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto max-w-5xl">
        <Card className="rounded-3xl shadow-sm">
          <CardHeader className="p-8 md:p-12">
            <p className="text-sm font-semibold text-primary">Tenant module starter</p>
            <CardTitle className="mt-3 text-4xl tracking-tight md:text-5xl">
              Build the screen your tenant needs.
            </CardTitle>
            <CardDescription className="mt-3 max-w-2xl text-lg leading-8">
              This baseline is ready for the official shadcn registry and semantic tenant-brand tokens. Add only the components this module owns.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 px-8 pb-8 md:px-12 md:pb-12">
            <Button>Start a screen</Button>
            <Button variant="outline">Review capabilities</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
