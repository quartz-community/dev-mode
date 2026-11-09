/** Give each `playwright test` run an id so repro sites build once per run. */
export default function globalSetup(): void {
  process.env.REPRO_RUN_ID = `${Date.now()}-${process.pid}`;
}
