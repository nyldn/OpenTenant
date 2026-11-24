import { expect, it } from "vitest"

import { loadPdfMakeRuntime } from "./pdf"

it(
  "loads the bundled fonts and generates a PDF with the supported pdfmake runtime",
  async () => {
    const runtime = await loadPdfMakeRuntime()
    const document = runtime.createPdf({ content: ["OpenTenant PDF smoke"] }) as unknown as {
      download?: (name: string) => void
      getBuffer?: () => Promise<Uint8Array>
    }

    expect(document.download).toBeTypeOf("function")
    expect(document.getBuffer).toBeTypeOf("function")

    const bytes = await document.getBuffer?.()
    expect(bytes?.byteLength).toBeGreaterThan(100)
  },
  15_000,
)
