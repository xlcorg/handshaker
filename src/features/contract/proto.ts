import type { MessageSchemaIpc, MessageNodeIpc, EnumNodeIpc, FieldNodeIpc } from "@/ipc/bindings";

export type ProtoToken =
  | { kind: "keyword"; text: string }
  | { kind: "scalar"; text: string }
  | { kind: "typeRef"; text: string; target: string; tooltip: string }
  | { kind: "name"; text: string; tooltip?: string }
  | { kind: "punct"; text: string };

export interface ProtoBlock {
  /** Full type name — the click-to-scroll anchor id. */
  fullName: string;
  lines: ProtoToken[][];
}

export interface ProtoDoc {
  blocks: ProtoBlock[];
}

function shortName(full: string): string {
  return full.split(".").pop() ?? full;
}

/** Display name per printed type: short last segment, or the full name when the
 *  short name collides across the document (e.g. `a.Filter` + `b.Filter`). */
function displayNames(schema: MessageSchemaIpc): Map<string, string> {
  const all = [...schema.messages.map((m) => m.full_name), ...schema.enums.map((e) => e.full_name)];
  const counts = new Map<string, number>();
  for (const fn of all) {
    const s = shortName(fn);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return new Map(all.map((fn) => [fn, (counts.get(shortName(fn)) ?? 0) > 1 ? fn : shortName(fn)]));
}

function typeRef(target: string, names: Map<string, string>): ProtoToken {
  return { kind: "typeRef", text: names.get(target) ?? shortName(target), target, tooltip: target };
}

function fieldLine(fl: FieldNodeIpc, names: Map<string, string>, indent: string): ProtoToken[] {
  const out: ProtoToken[] = [{ kind: "punct", text: indent }];
  if (fl.optional) out.push({ kind: "keyword", text: "optional " });
  if (fl.repeated) out.push({ kind: "keyword", text: "repeated " });
  const target = fl.message_type ?? fl.enum_type;
  if (fl.value_kind === "map") {
    // Our own builder format `map<key, Value>` — recover the key label from it.
    const key = fl.type_label.slice("map<".length, fl.type_label.indexOf(","));
    out.push({ kind: "keyword", text: "map<" }, { kind: "scalar", text: key }, { kind: "punct", text: ", " });
    if (target) out.push(typeRef(target, names));
    else out.push({ kind: "scalar", text: fl.type_label.slice(fl.type_label.indexOf(",") + 2, -1) });
    out.push({ kind: "punct", text: "> " });
  } else if (target) {
    out.push(typeRef(target, names), { kind: "punct", text: " " });
  } else {
    const base = fl.repeated ? fl.type_label.replace(/^repeated /, "") : fl.type_label;
    out.push({ kind: "scalar", text: base }, { kind: "punct", text: " " });
  }
  out.push({ kind: "name", text: fl.proto_name, tooltip: fl.json_name });
  out.push({ kind: "punct", text: ` = ${fl.number};` });
  return out;
}

function messageBlock(m: MessageNodeIpc, names: Map<string, string>): ProtoBlock {
  const display = names.get(m.full_name) ?? shortName(m.full_name);
  const header: ProtoToken[] = [
    { kind: "keyword", text: "message " },
    { kind: "name", text: display, tooltip: m.full_name },
  ];
  if (m.fields.length === 0) {
    return { fullName: m.full_name, lines: [[...header, { kind: "punct", text: " {}" }]] };
  }
  const lines: ProtoToken[][] = [[...header, { kind: "punct", text: " {" }]];
  let i = 0;
  while (i < m.fields.length) {
    const group = m.fields[i].oneof_group;
    if (group !== null) {
      lines.push([
        { kind: "punct", text: "  " },
        { kind: "keyword", text: "oneof " },
        { kind: "name", text: group },
        { kind: "punct", text: " {" },
      ]);
      while (i < m.fields.length && m.fields[i].oneof_group === group) {
        lines.push(fieldLine(m.fields[i], names, "    "));
        i++;
      }
      lines.push([{ kind: "punct", text: "  }" }]);
    } else {
      lines.push(fieldLine(m.fields[i], names, "  "));
      i++;
    }
  }
  lines.push([{ kind: "punct", text: "}" }]);
  return { fullName: m.full_name, lines };
}

function enumBlock(e: EnumNodeIpc, names: Map<string, string>): ProtoBlock {
  const display = names.get(e.full_name) ?? shortName(e.full_name);
  return {
    fullName: e.full_name,
    lines: [
      [
        { kind: "keyword", text: "enum " },
        { kind: "name", text: display, tooltip: e.full_name },
        { kind: "punct", text: " {" },
      ],
      ...e.values.map((v): ProtoToken[] => [
        { kind: "punct", text: "  " },
        { kind: "name", text: v.name },
        { kind: "punct", text: ` = ${v.number};` },
      ]),
      [{ kind: "punct", text: "}" }],
    ],
  };
}

/** Proto-source listing of a flat schema: root message first, remaining messages
 *  in schema (BFS) order, then enums. One block per type — recursion needs no
 *  special handling (named references, never inlined). */
export function renderProtoDoc(schema: MessageSchemaIpc): ProtoDoc {
  const names = displayNames(schema);
  const root = schema.messages.filter((m) => m.full_name === schema.root);
  const rest = schema.messages.filter((m) => m.full_name !== schema.root);
  return {
    blocks: [
      ...[...root, ...rest].map((m) => messageBlock(m, names)),
      ...schema.enums.map((e) => enumBlock(e, names)),
    ],
  };
}
