import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSearchCatalog,
  composeFocusIds,
  countsFromAlerts,
  evaluateSearch,
  hintAt,
  parseQuery,
  type SearchDocument,
} from "./search-ql";

function catalogFromDocs(docs: SearchDocument[]) {
  return {
    docs,
    byId: new Map(docs.map((doc) => [doc.id, doc])),
  };
}

function doc(
  partial: Partial<SearchDocument> & Pick<SearchDocument, "id" | "name">,
): SearchDocument {
  const fieldNames = partial.fieldNames ?? [];
  const fieldValues = partial.fieldValues ?? [];
  return {
    id: partial.id,
    name: partial.name,
    fieldNames,
    fieldValues,
    warnAlerts: partial.warnAlerts ?? 0,
    errorAlert: partial.errorAlert ?? 0,
    allText:
      partial.allText ??
      [partial.name, ...fieldNames, ...fieldValues].join(" "),
  };
}

describe("parseQuery", () => {
  it("parses key inheritance name:a|b", () => {
    const parsed = parseQuery("name:a|b");
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.ast) {
      assert.fail("expected ast");
    }
    assert.equal(parsed.ast.kind, "or");
    if (parsed.ast.kind !== "or") {
      return;
    }
    assert.equal(parsed.ast.left.kind, "atom");
    assert.equal(parsed.ast.right.kind, "atom");
    if (parsed.ast.left.kind === "atom" && parsed.ast.right.kind === "atom") {
      assert.equal(parsed.ast.left.atom.kind, "name");
      assert.equal(parsed.ast.right.atom.kind, "name");
      if (
        parsed.ast.left.atom.kind === "name" &&
        parsed.ast.right.atom.kind === "name"
      ) {
        assert.deepEqual(parsed.ast.left.atom.pred, {
          kind: "contains",
          text: "a",
        });
        assert.deepEqual(parsed.ast.right.atom.pred, {
          kind: "contains",
          text: "b",
        });
      }
    }
  });

  it("parses all range bracket forms", () => {
    const forms = [
      { q: "warnAlerts:[1,3]", loInclusive: true, hiInclusive: true },
      { q: "warnAlerts:[1,3)", loInclusive: true, hiInclusive: false },
      { q: "warnAlerts:(1,3]", loInclusive: false, hiInclusive: true },
      { q: "warnAlerts:(1,3)", loInclusive: false, hiInclusive: false },
    ] as const;

    for (const form of forms) {
      const parsed = parseQuery(form.q);
      assert.equal(parsed.ok, true, form.q);
      if (!parsed.ok || !parsed.ast || parsed.ast.kind !== "atom") {
        assert.fail(form.q);
      }
      assert.equal(parsed.ast.atom.kind, "warnAlerts");
      if (parsed.ast.atom.kind !== "warnAlerts") {
        return;
      }
      assert.deepEqual(parsed.ast.atom.pred, {
        kind: "range",
        lo: 1,
        hi: 3,
        loInclusive: form.loInclusive,
        hiInclusive: form.hiInclusive,
      });
    }
  });

  it("parses escapes in unquoted values", () => {
    const parsed = parseQuery('name:a\\|b\\&c\\"d\\(e\\)');
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.ast || parsed.ast.kind !== "atom") {
      assert.fail("expected atom");
    }
    assert.equal(parsed.ast.atom.kind, "name");
    if (parsed.ast.atom.kind !== "name") {
      return;
    }
    assert.deepEqual(parsed.ast.atom.pred, {
      kind: "contains",
      text: 'a|b&c"d(e)',
    });
  });

  it("parses negation", () => {
    const parsed = parseQuery("!name:api");
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.ast) {
      assert.fail("expected ast");
    }
    assert.equal(parsed.ast.kind, "not");
  });

  it("parses LTR & and | without precedence", () => {
    const parsed = parseQuery("name:a|name:b&name:c");
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.ast || parsed.ast.kind !== "and") {
      assert.fail("expected and at root (LTR)");
    }
    assert.equal(parsed.ast.left.kind, "or");
    assert.equal(parsed.ast.right.kind, "atom");
  });

  it("parses quoted exact", () => {
    const parsed = parseQuery('name:"Exact Name"');
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.ast || parsed.ast.kind !== "atom") {
      assert.fail("expected atom");
    }
    if (parsed.ast.atom.kind !== "name") {
      assert.fail("expected name");
    }
    assert.deepEqual(parsed.ast.atom.pred, {
      kind: "exact",
      text: "Exact Name",
    });
  });

  it("rejects wrong value shape for number keys", () => {
    const parsed = parseQuery("warnAlerts:oops");
    assert.equal(parsed.ok, false);
  });
});

describe("evaluateSearch", () => {
  const docs = [
    doc({
      id: "1",
      name: "API Gateway",
      fieldNames: ["region", "plan"],
      fieldValues: ["us-east", "pro"],
      warnAlerts: 2,
      errorAlert: 0,
    }),
    doc({
      id: "2",
      name: "DB Primary",
      fieldNames: ["engine"],
      fieldValues: ["postgres"],
      warnAlerts: 0,
      errorAlert: 3,
    }),
    doc({
      id: "3",
      name: "Cache",
      fieldNames: ["tier"],
      fieldValues: ["redis"],
      warnAlerts: 1,
      errorAlert: 1,
    }),
  ];
  const catalog = catalogFromDocs(docs);

  it("returns null matchIds for blank query", () => {
    const result = evaluateSearch("   ", catalog);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.matchIds, null);
    }
  });

  it("returns null matchIds for bad parse", () => {
    const result = evaluateSearch("warnAlerts:nope", catalog);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.matchIds, null);
    }
  });

  it("matches bare fuzzy over allText", () => {
    const result = evaluateSearch("postgres", catalog);
    assert.equal(result.ok, true);
    if (!result.ok || !result.matchIds) {
      assert.fail("expected matches");
    }
    assert.deepEqual([...result.matchIds], ["2"]);
  });

  it("matches quoted exact name", () => {
    const result = evaluateSearch('name:"API Gateway"', catalog);
    assert.equal(result.ok, true);
    if (!result.ok || !result.matchIds) {
      assert.fail("expected matches");
    }
    assert.deepEqual([...result.matchIds], ["1"]);
  });

  it("does not exact-match partial quoted name", () => {
    const result = evaluateSearch('name:"API"', catalog);
    assert.equal(result.ok, true);
    if (!result.ok || result.matchIds == null) {
      assert.fail("expected empty set");
    }
    assert.equal(result.matchIds.size, 0);
  });

  it("matches warnAlerts and errorAlert", () => {
    const warn = evaluateSearch("warnAlerts:>=2", catalog);
    assert.equal(warn.ok, true);
    if (!warn.ok || !warn.matchIds) {
      assert.fail("warn");
    }
    assert.deepEqual([...warn.matchIds], ["1"]);

    const err = evaluateSearch("errorAlert:>1", catalog);
    assert.equal(err.ok, true);
    if (!err.ok || !err.matchIds) {
      assert.fail("err");
    }
    assert.deepEqual([...err.matchIds], ["2"]);
  });

  it("matches ranges", () => {
    const result = evaluateSearch("warnAlerts:[1,2]", catalog);
    assert.equal(result.ok, true);
    if (!result.ok || !result.matchIds) {
      assert.fail("expected matches");
    }
    assert.deepEqual([...result.matchIds].sort(), ["1", "3"]);
  });

  it("applies negation", () => {
    const result = evaluateSearch("!name:api", catalog);
    assert.equal(result.ok, true);
    if (!result.ok || !result.matchIds) {
      assert.fail("expected matches");
    }
    assert.deepEqual([...result.matchIds].sort(), ["2", "3"]);
  });

  it("applies LTR and/or", () => {
    // (name:api | name:db) & errorAlert:>0  → only DB
    const result = evaluateSearch("name:api|name:db&errorAlert:>0", catalog);
    assert.equal(result.ok, true);
    if (!result.ok || !result.matchIds) {
      assert.fail("expected matches");
    }
    assert.deepEqual([...result.matchIds], ["2"]);
  });

  it("inherits key across |", () => {
    const result = evaluateSearch("name:api|cache", catalog);
    assert.equal(result.ok, true);
    if (!result.ok || !result.matchIds) {
      assert.fail("expected matches");
    }
    assert.deepEqual([...result.matchIds].sort(), ["1", "3"]);
  });
});

describe("catalog + compose", () => {
  it("countsFromAlerts and buildSearchCatalog join alerts off services", () => {
    const counts = countsFromAlerts([
      { resourceId: "a", type: "warning" },
      { resourceId: "a", type: "warning" },
      { resourceId: "a", type: "error" },
      { resourceId: "b", type: "error" },
    ]);
    assert.deepEqual(counts.get("a"), { warn: 2, error: 1 });
    assert.deepEqual(counts.get("b"), { warn: 0, error: 1 });

    const catalog = buildSearchCatalog(
      [
        {
          id: "a",
          name: "Alpha",
          fields: {
            meta: {
              region: "us-west",
              enabled: true,
              nested: {
                fields: {
                  secret: { type: "secret", value: "tok" },
                  hidden: { type: "hidden" },
                  graph: {
                    type: "graph",
                    vertices: ["v1", "v2"],
                    edges: [["v1", "v2"]],
                  },
                },
              },
            },
          },
        },
      ],
      counts,
    );

    const built = catalog.byId.get("a");
    assert.ok(built);
    assert.equal(built.warnAlerts, 2);
    assert.equal(built.errorAlert, 1);
    assert.ok(built.fieldNames.includes("region"));
    assert.ok(built.fieldNames.includes("secret"));
    assert.ok(!built.fieldNames.includes("meta"));
    assert.ok(built.fieldValues.includes("us-west"));
    assert.ok(built.fieldValues.includes("true"));
    assert.ok(built.fieldValues.includes("tok"));
    assert.ok(built.fieldValues.includes("v1"));
    assert.ok(!built.fieldValues.includes("hidden"));
  });

  it("composeFocusIds intersects when both active", () => {
    assert.equal(
      composeFocusIds({ searchMatchIds: null, selectionIds: null }),
      null,
    );
    const search = new Set(["1", "2"]);
    const selection = new Set(["2", "3"]);
    assert.deepEqual(
      [...(composeFocusIds({ searchMatchIds: search, selectionIds: null }) ?? [])],
      ["1", "2"],
    );
    assert.deepEqual(
      [
        ...(composeFocusIds({
          searchMatchIds: null,
          selectionIds: selection,
        }) ?? []),
      ],
      ["2", "3"],
    );
    assert.deepEqual(
      [
        ...(composeFocusIds({
          searchMatchIds: search,
          selectionIds: selection,
        }) ?? []),
      ],
      ["2"],
    );
  });

  it("hintAt is callable", () => {
    const hint = hintAt("name:ap", 7);
    assert.ok(Array.isArray(hint.keys));
    assert.ok(hint.keys.includes("name"));
    assert.equal(typeof hint.partial, "string");
  });
});
