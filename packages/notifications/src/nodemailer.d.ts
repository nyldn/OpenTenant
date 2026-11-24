// Optional dependency without bundled types. Keep the public adapter contract
// narrow and validate usage through Mailer in smtp.ts.
declare module "nodemailer" {
  const mailer: unknown;
  export default mailer;
}
