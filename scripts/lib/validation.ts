const VALID_PLUGIN_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_PLUGIN_NAME_LENGTH = 64;

export function validatePluginName(name: string): void {
  if (!name) throw new Error("Plugin name is required");
  if (name.length > MAX_PLUGIN_NAME_LENGTH) {
    throw new Error(
      `Plugin name too long (max ${MAX_PLUGIN_NAME_LENGTH} chars): ${name}`,
    );
  }
  if (!VALID_PLUGIN_NAME.test(name)) {
    throw new Error(
      `Invalid plugin name: "${name}". Names must contain only lowercase letters, numbers, and hyphens, and must start/end with a letter or number.`,
    );
  }
}
