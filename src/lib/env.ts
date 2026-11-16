// Fail fast on missing or placeholder secrets in production.
// Skipped during `next build`, which runs without runtime secrets (e.g. inside the Docker image build).
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const problems: string[] = [];
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32 || secret.includes("CHANGE_ME")) {
    problems.push("BETTER_AUTH_SECRET must be a random value of at least 32 characters");
  }
  const url = process.env.BETTER_AUTH_URL ?? "";
  if (!/^https:\/\//.test(url))
    problems.push("BETTER_AUTH_URL must be set to the public https URL");
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("CHANGE_ME")) {
    problems.push("DATABASE_URL must be set");
  }
  if (problems.length)
    throw new Error(`Invalid production configuration:\n- ${problems.join("\n- ")}`);
}
