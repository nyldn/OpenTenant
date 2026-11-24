# Assessment module

- UI primitives come from `@opentenant/design-system` (formerly `@/components/ui`).
- Storage stays in the browser, behind `persistence/assessment-repository.ts`.
  Each server-supplied tenant gets its own versioned engagement key. The
  repository validates every read, write, import, restore, and clear operation
  and keeps verified backup or recovery bytes before replacing data.
- The three legacy Assessment keys are never converted automatically. The
  user must claim a source while the origin-wide Web Lock is held. Raw legacy
  values remain available for recovery.
- "Export report JSON" is a derived report. "Download engagement backup" is
  the restorable v2 document. The restore control validates the full document
  and tenant binding before changing visible state.
- Runtime configuration is injected by the platform shell through
  `configureAssessmentRuntime()` (`runtime.ts`); there is no build-time env surface.
- The AI readout calls the platform route at `/api/assessment-readout`.
  Completed readouts are stored with a digest of the assessment inputs. A
  restored current readout renders without a model request; edits mark it
  stale until the user regenerates it.
- `engine.test.ts`, `respondents.test.ts`, and `data/operatingProfiles.test.ts`
  protect the scoring model and synthetic example library.

- The operating profile uses general-purpose industry examples. Shared FormField
  labels remain visible on the questionnaire, responses and results stages.
  Respondent instructions and optional evidence help are linked to their controls.
- Download/restore engagement backup actions stay visible. Advanced recovery
  contains the original legacy downloads and version details; recoverable legacy
  data still offers its explicit claim/resume path without opening that view.
- The host shell supplies the route heading during client loading and hands it
  over to the module's existing h1 after hydration. Do not add a second loading
  heading inside the client-only mount.
- AssessmentTable adapts the design-system Table's existing scroll container.
  A ResizeObserver adds its name, region role and Tab stop only while content
  overflows; fitting tables add no Tab stop. Keep table columns intact.
- The browser accessibility spec covers 390px/1440px contrast, visible labels,
  all 25 dimensions, the loading heading and real keyboard scrolling/focus.
  The export journey checks complete CSV/JSON data and uses unpdf's bundled
  serverless pdf.js to parse every PDF page and extract engagement text without
  canvas or rasterization. D1's engagement regression remains unchanged.
