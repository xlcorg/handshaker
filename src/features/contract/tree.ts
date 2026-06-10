import type { MessageSchemaIpc, MessageNodeIpc, FieldNodeIpc } from "@/ipc/bindings";

export type ContractRow =
  | {
      kind: "field";
      /** Unique row id: `/`-joined json_name path from the root. */
      path: string;
      depth: number;
      field: FieldNodeIpc;
      /** Resolved enum values (full list) when the field is enum-typed. */
      enumValues: string[] | null;
      /** Has a known message type that is NOT an ancestor (chevron shown). */
      expandable: boolean;
      expanded: boolean;
      /** Message type already on the ancestor path (`↻ recursive` marker). */
      recursive: boolean;
    }
  | { kind: "oneof"; path: string; depth: number; label: string };

/** Flatten the schema into display rows honoring the `expanded` path set.
 *  A visited-set along each expansion path stops recursive types.
 *  @param expanded Set of {@link ContractRow.path} values (leading-slash, `/`-joined
 *    json_name paths, e.g. `/filters`) whose message fields are rendered open. */
export function deriveRows(
  schema: MessageSchemaIpc,
  expanded: ReadonlySet<string>,
): ContractRow[] {
  const byName = new Map(schema.messages.map((m) => [m.full_name, m]));
  const enums = new Map(schema.enums.map((e) => [e.full_name, e.values]));
  const out: ContractRow[] = [];

  const walk = (
    node: MessageNodeIpc,
    depth: number,
    prefix: string,
    ancestors: ReadonlySet<string>,
  ) => {
    const seenOneofs = new Set<string>();
    for (const field of node.fields) {
      if (field.oneof_group && !seenOneofs.has(field.oneof_group)) {
        seenOneofs.add(field.oneof_group);
        out.push({
          kind: "oneof",
          path: `${prefix}/oneof:${field.oneof_group}`,
          depth,
          label: field.oneof_group,
        });
      }

      const path = `${prefix}/${field.json_name}`;
      const recursive = field.message_type !== null && ancestors.has(field.message_type);
      const target = field.message_type ? (byName.get(field.message_type) ?? null) : null;
      const expandable = target !== null && !recursive;
      const isExpanded = expandable && expanded.has(path);
      out.push({
        kind: "field",
        path,
        depth,
        field,
        enumValues: field.enum_type ? (enums.get(field.enum_type) ?? null) : null,
        expandable,
        expanded: isExpanded,
        recursive,
      });
      if (isExpanded && target) {
        walk(target, depth + 1, path, new Set([...ancestors, target.full_name]));
      }
    }
  };

  const root = byName.get(schema.root);
  if (root) walk(root, 0, "", new Set([root.full_name]));
  return out;
}
