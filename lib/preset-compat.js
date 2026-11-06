import { removeTreeNoFollowSync } from "./remove-tree.js";
// Translate legacy child-tool policies to native child Agent Presets. The user's
// source YAML is deliberately retained: migration changes the registered
// composition, not their persona, comments, expressions or other settings.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const SUBAGENT = "@deepseek-ai/dsh-tool-subagent";
const TOOL_NAMES = new Map([
  ["@deepseek-ai/dsh-tool-workflow", "workflow"],
  ["@deepseek-ai/dsh-tool-ralph", "ralph"],
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function toolName(row) {
  return row.name === SUBAGENT
    ? (row.config?.toolName ?? "subagent")
    : TOOL_NAMES.get(row.name);
}
function visit(rows, fn, parent = []) {
  for (const [i, row] of rows.entries()) {
    const at = [...parent, i];
    fn(row, at);
    if (row.group === true) visit(row.config, fn, [...at, "config"]);
  }
}
function rowAt(rows, at) {
  return at.reduce((value, key) => value[key], rows);
}

/** Build declarations without executing expressions or changing the input. */
export function migratePresetDefinition(definition) {
  const parent = structuredClone(definition);
  const policies = [];
  visit(parent.plugins, (row, at) => {
    if (row.name !== SUBAGENT || !Object.hasOwn(row.config ?? {}, "toolFilter"))
      return;
    const config = row.config;
    const filter = config.toolFilter;
    if (
      config.provider !== "spawn" ||
      config.agentPreset !== undefined ||
      config.allowedAgentPresets !== undefined
    )
      throw Error(
        `${definition.id}/${row.id}: legacy toolFilter requires an unambiguous spawn provider; configuration retained`,
      );
    if (
      !filter ||
      Object.keys(filter).some((key) => key !== "deny") ||
      !Array.isArray(filter.deny) ||
      filter.deny.some((value) => typeof value !== "string" || !value) ||
      new Set(filter.deny).size !== filter.deny.length
    )
      throw Error(
        `${definition.id}/${row.id}: unsupported legacy toolFilter; configuration retained`,
      );
    const names = new Set();
    visit(parent.plugins, (item) => {
      const name = toolName(item);
      if (name) names.add(name);
    });
    const unknown = filter.deny.filter((name) => !names.has(name));
    if (unknown.length)
      throw Error(
        `${definition.id}/${row.id}: cannot preserve toolFilter for ${unknown.join(", ")}; configuration retained`,
      );
    const childId = `${definition.id}-child-${hash(JSON.stringify({ at, deny: filter.deny })).slice(0, 10)}`;
    policies.push({
      at,
      childId,
      deny: [...filter.deny],
      rowId: row.id ?? at.join("."),
    });
  });
  // A child with another independently filtered spawn needs a policy graph,
  // not a guessed recursive reference. Refuse until that graph is supported.
  if (policies.length > 1)
    throw Error(
      `${definition.id}: multiple legacy child policies require explicit migration; configuration retained`,
    );
  if (!policies.length) return { definitions: [parent], policies };

  const policy = policies[0];
  const child = structuredClone(parent);
  child.id = policy.childId;
  child.name = `${definition.name ?? definition.id} · 子任务`;
  child.description = `兼容子预设：继承父预设提示词和设置，排除 ${policy.deny.join("、")}。主会话请选择 ${definition.name ?? definition.id}。`;
  child.order = (definition.order ?? 20) + 0.1;
  // Keep the child's spawn/depth settings; omitting agentPreset there means
  // inheritance, and avoids a self-referential read during eager registration.
  delete rowAt(child.plugins, policy.at).config.toolFilter;
  const filterRows = (rows) =>
    rows
      .filter((row) => !policy.deny.includes(toolName(row)))
      .map((row) => {
        if (row.group === true) row.config = filterRows(row.config);
        return row;
      });
  child.plugins = filterRows(child.plugins);
  const config = rowAt(parent.plugins, policy.at).config;
  delete config.toolFilter;
  config.agentPreset = child.id;
  return { definitions: [child, parent], policies };
}

/** Immutable, content-addressed backup, made before registering the migration.
 * A pre-existing partial/corrupt backup is an error, never silently accepted.
 */
export function backupPresetMigration({ home, dir, id, policies }) {
  if (!policies.length) return undefined;
  if (!home)
    throw Error(
      "Preset migration requires a writable DSH_HOME backup directory",
    );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id))
    throw Error("Invalid preset id for migration backup");
  const files = ["agent.cordis.yml", "preset.yml"].map((name) => ({
    name,
    bytes: fs.readFileSync(path.join(dir, name)),
  }));
  const digest = hash(
    Buffer.concat(
      files.flatMap((file) => [Buffer.from(file.name + "\0"), file.bytes]),
    ),
  );
  const base = path.join(home, "dsh-purge-community", "preset-migrations");
  const target = path.join(base, `${id}-${digest.slice(0, 16)}`);
  const validate = () => {
    for (const file of files)
      if (!fs.readFileSync(path.join(target, file.name)).equals(file.bytes))
        throw Error(`Preset backup mismatch: ${file.name}`);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, "manifest.json"), "utf8"),
    );
    if (manifest.digest !== digest)
      throw Error("Preset backup manifest mismatch");
  };
  if (fs.existsSync(target)) {
    validate();
    return target;
  }
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(base, ".staging-"));
  try {
    for (const file of files)
      fs.writeFileSync(path.join(staging, file.name), file.bytes, {
        mode: 0o600,
        flag: "wx",
      });
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify(
        {
          schema: 1,
          id,
          digest,
          created: new Date().toISOString(),
          policies,
          files: files.map((file) => ({
            name: file.name,
            sha256: hash(file.bytes),
          })),
          sourceUnchanged: true,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    fs.renameSync(staging, target);
    validate();
  } finally {
    removeTreeNoFollowSync(staging);
  }
  return target;
}

/**
 * A row the Loader could not start. The registry reports it as
 * `<row id> (<module name>): never started`, where the module is the row's
 * `name` and usually the host package that a new host release removed.
 */
const ROW_NEVER_STARTED = /(\S+) \((.+?)\): never started/;

/**
 * Remove every row whose module name equals `name`, descending into groups.
 * @returns the filtered rows and how many were removed; the input is not changed.
 */
export function dropPresetRow(rows, name) {
  if (!Array.isArray(rows)) return { rows, dropped: 0 };
  let dropped = 0;
  const kept = [];
  for (const row of rows) {
    if (row && row.name === name) {
      dropped += 1;
      continue;
    }
    if (row && row.group === true && Array.isArray(row.config)) {
      const nested = dropPresetRow(row.config, name);
      dropped += nested.dropped;
      kept.push(nested.dropped ? { ...row, config: nested.rows } : row);
      continue;
    }
    kept.push(row);
  }
  return { rows: kept, dropped };
}

/**
 * A host release can delete a plugin that an older preset still lists. Such a
 * row never starts, and the whole preset then reports `broken` — the mode
 * dropdown shows "加载失败" or, for an eagerly registered preset, the mode
 * disappears entirely. Drop only the dead rows and retry, so the rest of the
 * preset keeps working; anything else is still thrown to the caller.
 */
async function registerAll(registry, definitions) {
  const releases = [];
  try {
    for (const definition of definitions) {
      releases.push(await registry.register(definition));
      // register() may succeed with a broken record. Do not equate its disposer
      // with successful activation. resolve() audits the actual Loader tree.
      if (typeof registry.resolve === "function") {
        const state = await registry.resolve(definition.id);
        if (state.broken) throw Error(`${definition.id}: ${state.broken}`);
      }
    }
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    for (const release of releases.reverse()) await release();
  };
}

/**
 * Register helpers before their parent; unwind all declarations on failure.
 * @param definitions Preset declarations in registration order.
 * @param [options] `onPruned(name, count)` fires once per dropped module.
 */
export async function registerPresetDefinitions(
  registry,
  definitions,
  options = {},
) {
  const limit = Number.isInteger(options.maxRowDrops) ? options.maxRowDrops : 12;
  let current = definitions;
  for (let round = 0; ; round += 1) {
    try {
      return await registerAll(registry, current);
    } catch (error) {
      const match = ROW_NEVER_STARTED.exec(
        error && typeof error.message === "string" ? error.message : "",
      );
      if (!match || round >= limit) throw error;
      const name = match[2];
      let dropped = 0;
      const pruned = current.map((definition) => {
        const result = dropPresetRow(definition.plugins, name);
        dropped += result.dropped;
        return result.dropped
          ? { ...definition, plugins: result.rows }
          : definition;
      });
      // The broken row is not one this preset declares: do not guess.
      if (!dropped) throw error;
      options.onPruned?.(name, dropped);
      current = pruned;
    }
  }
}
