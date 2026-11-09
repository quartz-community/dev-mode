/**
 * Run a repo's ci.yml on its changesets version PR and report the result as a commit status.
 *
 * changesets/action pushes the version PR with GITHUB_TOKEN, and GITHUB_TOKEN events trigger no
 * workflows, so a version PR shows no checks: the lockfile `version-packages` rewrote is never
 * tested before it's merged and published. The patches below make ci.yml callable
 * (`workflow_call`, checking out a given commit) and add to release.yml: a pending
 * `CI / version PR` status on the PR head, a job calling ci.yml on it, and a job reporting the
 * result. They edit the repo's own files (both release.yml variants: npm token and trusted
 * publishing) instead of replacing them with a template.
 */

export const STATUS_CONTEXT = "CI / version PR";

const WORKFLOW_CALL = `  # Called by release.yml to check the changesets version PR, which gets no CI of its own
  # (its commits are pushed with GITHUB_TOKEN, and GITHUB_TOKEN events trigger no workflows).
  workflow_call:
    inputs:
      ref:
        description: "Commit to check out and check (default: the triggering commit)"
        type: string
        required: false
        default: ""
`;

const RELEASE_PERMISSIONS = `      # Only for the pending commit status on the version PR (see version-pr-status).
      statuses: write
    outputs:
      pr-number: \${{ steps.changesets.outputs.pullRequestNumber }}
      pr-sha: \${{ steps.version-pr.outputs.sha }}
`;

const PENDING_STEP = `      # The version PR's commits are pushed with GITHUB_TOKEN, which triggers no workflows, so
      # the lockfile \`version-packages\` rewrote would never be checked. Pin the PR head and mark
      # it pending; the version-pr-ci job below runs ci.yml on it and reports the result.
      - name: Mark version PR head as pending
        id: version-pr
        if: steps.changesets.outputs.pullRequestNumber != ''
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PR: \${{ steps.changesets.outputs.pullRequestNumber }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
        run: |
          sha=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" --jq .head.sha)
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
          gh api "repos/$GITHUB_REPOSITORY/statuses/$sha" \\
            -f state=pending -f context="${STATUS_CONTEXT}" \\
            -f description="Running ci.yml on the version PR" -f target_url="$RUN_URL"
`;

const VERSION_PR_JOBS = `
  version-pr-ci:
    needs: release
    if: needs.release.outputs.pr-sha != ''
    permissions:
      contents: read
    uses: ./.github/workflows/ci.yml
    with:
      ref: \${{ needs.release.outputs.pr-sha }}

  version-pr-status:
    needs: [release, version-pr-ci]
    if: always() && needs.release.outputs.pr-sha != ''
    runs-on: ubuntu-latest
    permissions:
      statuses: write
    steps:
      - name: Report CI result on the version PR
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          SHA: \${{ needs.release.outputs.pr-sha }}
          RESULT: \${{ needs.version-pr-ci.result }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
        run: |
          case "$RESULT" in
            success) state=success; description="ci.yml passed on the version PR" ;;
            cancelled) state=error; description="ci.yml was cancelled" ;;
            *) state=failure; description="ci.yml failed on the version PR ($RESULT)" ;;
          esac
          gh api "repos/$GITHUB_REPOSITORY/statuses/$SHA" \\
            -f state="$state" -f context="${STATUS_CONTEXT}" \\
            -f description="$description" -f target_url="$RUN_URL"
`;

export type PatchResult =
  | { status: "patched"; text: string }
  | { status: "unchanged" }
  | { status: "manual"; reason: string };

/** Make ci.yml callable from release.yml with the commit to check. */
export function patchCiWorkflow(text: string): PatchResult {
  if (/^\s+workflow_call:/m.test(text)) return { status: "unchanged" };
  if (!/^on:\s*$/m.test(text)) {
    return { status: "manual", reason: "`on:` is not a mapping of triggers" };
  }
  if (!text.includes("\n\njobs:")) {
    return {
      status: "manual",
      reason: "no blank line before `jobs:` after the triggers",
    };
  }
  let next = text.replace("\n\njobs:", `\n${WORKFLOW_CALL}\njobs:`);

  let checkouts = 0;
  let unsupported = false;
  next = next.replace(
    /^( *)- uses: actions\/checkout@[^\s]+\n((?:\1 {2}with:\n)?)/gm,
    (match: string, indent: string, withLine: string) => {
      checkouts++;
      if (withLine) {
        unsupported = true;
        return match;
      }
      return `${match}${indent}  with:\n${indent}    ref: \${{ inputs.ref }}\n`;
    },
  );
  if (checkouts === 0)
    return { status: "manual", reason: "no actions/checkout step" };
  if (unsupported) {
    return {
      status: "manual",
      reason: "an actions/checkout step already has `with:`",
    };
  }
  return { status: "patched", text: next };
}

/** Add the pending status, the ci.yml call on the version PR and the status report to release.yml. */
export function patchReleaseWorkflow(text: string): PatchResult {
  if (text.includes("version-pr-ci:")) return { status: "unchanged" };
  const changesetsStep =
    /^( {6}- name: [^\n]*\n)( {8}uses: changesets\/action@[^\s]+\n)/m;
  const match = changesetsStep.exec(text);
  if (!match) {
    return {
      status: "manual",
      reason: "no `- name:` step using changesets/action",
    };
  }
  if (
    /^ {8}id:/m.test(
      text
        .slice(match.index, match.index + match[0].length + 200)
        .split(/\n {6}- /)[0],
    )
  ) {
    return {
      status: "manual",
      reason: "the changesets step already has an id",
    };
  }
  // the pending step and the jobs are appended: the changesets step must end the last job
  const rest = text.slice(match.index + match[0].length);
  if (/^ {6}- /m.test(rest) || /^ {2}[a-z0-9_-]+:\s*$/m.test(rest)) {
    return {
      status: "manual",
      reason: "the changesets step is not the last step of the last job",
    };
  }
  const permissions = /^( {6}id-token: write\n)/m;
  if (
    !/^ {4}permissions:\n(?: {6}[a-z-]+: \w+\n)*? {6}id-token: write\n/m.test(
      text,
    )
  ) {
    return {
      status: "manual",
      reason: "the release job's permissions don't end with `id-token: write`",
    };
  }
  if (/^ {4}outputs:/m.test(text)) {
    return { status: "manual", reason: "the release job already has outputs" };
  }

  let next = text.replace(permissions, `$1${RELEASE_PERMISSIONS}`);
  next = next.replace(changesetsStep, `$1        id: changesets\n$2`);
  if (!next.endsWith("\n")) next += "\n";
  next += PENDING_STEP + VERSION_PR_JOBS;
  return { status: "patched", text: next };
}
