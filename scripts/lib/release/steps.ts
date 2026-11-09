import type { PlannedRelease, RangeUpdate, ReleasePlan } from "./graph.js";

/**
 * - local: edits files / commits in a local clone only. Safe for an agent.
 * - network: read-only network access (npm registry polling, git pull).
 * - outward: visible to others (push, merge, tag, publish). An agent must ask
 *   the human before running these.
 */
export type StepKind = "local" | "network" | "outward";

export interface ReleaseStep {
  index: number;
  wave: number;
  repo?: string;
  kind: StepKind;
  requiresHuman: boolean;
  command: string;
  description: string;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./^-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function rangeCommand(repo: string, update: RangeUpdate): string {
  return `(cd repos/${repo} && npm pkg set ${shellQuote(`${update.kind}.${update.dependency}=${update.to}`)})`;
}

function changesetSummary(release: PlannedRelease): string {
  if (release.reasons.includes("requested")) return "<describe the change>";
  return `Update ${release.rangeUpdates.map((u) => `${u.dependency} to ${u.to}`).join(", ")}`;
}

export function buildReleaseSteps(
  plan: ReleasePlan,
  options: { scriptPath?: string } = {},
): ReleaseStep[] {
  const script = options.scriptPath ?? "pnpm tsx scripts/release.ts";
  const steps: Omit<ReleaseStep, "index">[] = [];
  const add = (step: Omit<ReleaseStep, "index" | "requiresHuman">) =>
    steps.push({ ...step, requiresHuman: step.kind === "outward" });

  const repos = plan.releases.map((release) => release.repo);
  if (repos.length > 0) {
    add({
      wave: 0,
      kind: "local",
      command: `${script} verify ${repos.join(" ")}`,
      description:
        "pre-flight: build/typecheck/lint/format/test the release set and its dependents",
    });
  }

  for (const release of plan.releases) {
    const { repo, name, to, wave } = release;
    const tagged = `${name}@${to}`;

    for (const update of [
      ...release.rangeUpdates,
      ...release.suggestedRangeUpdates,
    ]) {
      const required = release.rangeUpdates.includes(update);
      add({
        wave,
        repo,
        kind: "local",
        command: rangeCommand(repo, update),
        description: `${required ? "required" : "suggested (only if it uses new APIs)"}: ${update.kind} ${update.dependency} ${update.from} -> ${update.to}`,
      });
    }
    if (
      release.rangeUpdates.length + release.suggestedRangeUpdates.length >
      0
    ) {
      add({
        wave,
        repo,
        kind: "network",
        command: `just regen-lockfile ${repo}`,
        description:
          "refresh the standalone package-lock.json (needs the new dependency versions on npm: run after the previous wave's wait steps)",
      });
    }

    if (release.kind === "changesets") {
      if (release.bump !== null) {
        if (!release.hasPendingChangeset || release.rangeUpdates.length > 0) {
          add({
            wave,
            repo,
            kind: "local",
            command: `${script} changeset --bump ${release.bump} --summary ${shellQuote(changesetSummary(release))} ${repo}`,
            description: `write .changeset entry (${release.bump}: ${release.from} -> ${to})`,
          });
        }
        add({
          wave,
          repo,
          kind: "local",
          command: `just commit ${repo} ${shellQuote(`chore: release ${tagged}`)}`,
          description:
            "commit changeset (and range edits); run `npm run format` in the repo first if files changed",
        });
        add({
          wave,
          repo,
          kind: "outward",
          command: `just push-repo ${repo}`,
          description:
            "push to main (runs `just check` first); CI opens the 'chore: version package' PR",
        });
        add({
          wave,
          repo,
          kind: "outward",
          command: release.githubRepo
            ? `gh pr merge changeset-release/main -R ${release.githubRepo} --merge`
            : `merge the 'chore: version package' PR of ${repo}`,
          description: `merge the version PR; CI publishes ${tagged} to npm`,
        });
      } else {
        add({
          wave,
          repo,
          kind: "outward",
          command: release.githubRepo
            ? `gh run list -R ${release.githubRepo} --workflow release.yml --limit 3`
            : `check the Release workflow of ${repo}`,
          description: `${tagged} is bumped but unpublished: inspect / re-run the Release workflow`,
        });
      }
    } else if (release.kind === "tag") {
      if (release.bump !== null) {
        add({
          wave,
          repo,
          kind: "local",
          command: `(cd repos/${repo} && npm version ${release.bump} --no-git-tag-version)`,
          description: `bump ${release.from} -> ${to}`,
        });
        add({
          wave,
          repo,
          kind: "local",
          command: `just commit ${repo} ${shellQuote(`chore: release ${to}`)}`,
          description: "commit version bump",
        });
        add({
          wave,
          repo,
          kind: "outward",
          command: `just push-repo ${repo}`,
          description: "push the bump commit (runs `just check` first)",
        });
      }
      add({
        wave,
        repo,
        kind: "outward",
        command: `just publish-tag ${repo}`,
        description: `push tag v${to}; CI publishes ${tagged} to npm`,
      });
    } else if (release.kind === "github-release") {
      if (release.bump !== null) {
        add({
          wave,
          repo,
          kind: "local",
          command: `(cd repos/${repo} && npm_package_version=${to} node version-bump.mjs)`,
          description: `bump ${release.from} -> ${to} (package.json, manifest.json, versions.json)`,
        });
        add({
          wave,
          repo,
          kind: "local",
          command: `just commit ${repo} ${shellQuote(`chore: release ${to}`)}`,
          description: "commit version bump",
        });
        add({
          wave,
          repo,
          kind: "outward",
          command: `just push-repo ${repo}`,
          description: "push the bump commit",
        });
      }
      add({
        wave,
        repo,
        kind: "outward",
        command: `git -C repos/${repo} tag -a ${to} -m ${shellQuote(`Release ${to}`)} && git -C repos/${repo} push origin ${to}`,
        description: "push the version tag; CI builds the GitHub release",
      });
      continue;
    }

    add({
      wave,
      repo,
      kind: "network",
      command: `${script} wait-npm ${tagged}`,
      description: "block until the version is visible on the npm registry",
    });
    if (release.kind === "changesets" && release.bump !== null) {
      add({
        wave,
        repo,
        kind: "network",
        command: `git -C repos/${repo} pull --ff-only`,
        description:
          "pull the version-bump commit (CHANGELOG + package.json) back locally",
      });
    }
  }

  const finalWave =
    plan.releases.reduce((max, release) => Math.max(max, release.wave), 0) + 1;
  for (const consumer of plan.consumerUpdates) {
    for (const update of consumer.rangeUpdates) {
      add({
        wave: finalWave,
        repo: consumer.repo,
        kind: "local",
        command: rangeCommand(consumer.repo, update),
        description: `required: ${update.kind} ${update.dependency} ${update.from} -> ${update.to}`,
      });
    }
  }
  if (plan.lockfileUpdate || plan.consumerUpdates.length > 0) {
    add({
      wave: finalWave,
      repo: "quartz",
      kind: "network",
      command: "just update-quartz-lockfile",
      description:
        "regenerate + commit repos/quartz/package-lock.json against the new npm versions",
    });
    add({
      wave: finalWave,
      repo: "quartz",
      kind: "outward",
      command: "just push-repo quartz",
      description: "push the Quartz lockfile update",
    });
  }

  return steps.map((step, index) => ({ index: index + 1, ...step }));
}
