import type { JsonKind, JsonNode, JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";

class Cursor {
  constructor(public readonly s: string, public i = 0) {}
  ws() { while (this.i < this.s.length && " \t\r\n".includes(this.s[this.i])) this.i++; }
  eof() { return this.i >= this.s.length; }
  peek() { return this.s[this.i]; }
}

class ParseError extends Error {}

const kindOf = (v: unknown): JsonKind => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
};

/**
 * Recursive-descent JSON parser that records, per node, the source offset range
 * of its value token. Returns null on any syntax error (incl. trailing junk).
 */
export function parseWithSpans(text: string): { tree: JsonTree; spans: ValueSpan[] } | null {
  const nodes: Record<string, JsonNode> = {};
  const order: string[] = [];
  const spans: ValueSpan[] = [];
  let counter = 0;
  const c = new Cursor(text);

  const fail = (): never => { throw new ParseError(); };

  const parseString = (): string => {
    if (c.s[c.i] !== '"') fail();
    c.i++;
    let out = "";
    while (true) {
      if (c.eof()) fail();
      const ch = c.s[c.i++];
      if (ch === '"') return out;
      if (ch === "\\") {
        const esc = c.s[c.i++];
        switch (esc) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = c.s.slice(c.i, c.i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
            out += String.fromCharCode(parseInt(hex, 16));
            c.i += 4;
            break;
          }
          default: fail();
        }
      } else {
        out += ch;
      }
    }
  };

  const parseLiteralValue = (): unknown => {
    // number / true / false / null — delegate to JSON.parse on the matched slice
    const start = c.i;
    const rest = c.s.slice(c.i);
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(rest);
    if (!m) fail();
    c.i += m[1].length;
    try { return JSON.parse(c.s.slice(start, c.i)); } catch { return fail(); }
  };

  const build = (key: string | null, index: number | null, parentId: string | null, depth: number): string => {
    c.ws();
    const id = `n${counter++}`;
    const start = c.i;
    const ch = c.peek();
    let value: unknown;
    let kind: JsonKind;
    const childIds: string[] = [];

    if (ch === "{") {
      kind = "object";
      c.i++; c.ws();
      const obj: Record<string, unknown> = {};
      if (c.peek() === "}") { c.i++; }
      else {
        while (true) {
          c.ws();
          const k = parseString();
          c.ws();
          if (c.s[c.i++] !== ":") fail();
          const childId = build(k, null, id, depth + 1);
          childIds.push(childId);
          obj[k] = nodes[childId].value;
          c.ws();
          const sep = c.s[c.i++];
          if (sep === "}") break;
          if (sep !== ",") fail();
        }
      }
      value = obj;
    } else if (ch === "[") {
      kind = "array";
      c.i++; c.ws();
      const arr: unknown[] = [];
      if (c.peek() === "]") { c.i++; }
      else {
        let idx = 0;
        while (true) {
          const childId = build(null, idx, id, depth + 1);
          childIds.push(childId);
          arr.push(nodes[childId].value);
          idx++;
          c.ws();
          const sep = c.s[c.i++];
          if (sep === "]") break;
          if (sep !== ",") fail();
        }
      }
      value = arr;
    } else if (ch === '"') {
      kind = "string";
      value = parseString();
    } else {
      value = parseLiteralValue();
      kind = kindOf(value);
    }

    const node: JsonNode = {
      id, parentId, key, index, kind, value, depth,
      childIds, childCount: childIds.length,
    };
    nodes[id] = node;
    order.push(id);
    spans.push({ nodeId: id, start, end: c.i });
    return id;
  };

  try {
    const rootId = build(null, null, null, 0);
    c.ws();
    if (!c.eof()) return null; // trailing junk
    return { tree: { rootId, nodes, order }, spans };
  } catch {
    return null;
  }
}
