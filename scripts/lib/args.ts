export function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const eqIndex = raw.indexOf("=");
      if (eqIndex !== -1) {
        flags[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[raw] = next;
          i += 1;
        } else {
          flags[raw] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}
