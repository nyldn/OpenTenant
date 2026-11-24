interface ImportMetaEnv {
  readonly VITE_ASSESSMENT_PASSWORD?: string
  readonly VITE_DEMO_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
