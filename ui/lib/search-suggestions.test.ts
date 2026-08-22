import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SearchDocument } from "./search-ql";
import { applySuggestion, suggestSearch } from "./search-suggestions";

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
    allText: [partial.name, ...fieldNames, ...fieldValues].join(" "),
  };
}

describe("suggestSearch", () => {
  const catalog = catalogFromDocs([
    doc({
      id: "1",
      name: "checkout-api",
      fieldNames: ["region"],
      fieldValues: ["us-east"],
      warnAlerts: 2,
    }),
    doc({
      id: "2",
      name: "cart",
      fieldNames: ["tier"],
      fieldValues: ["gold lane"],
      errorAlert: 1,
    }),
  ]);

  it("suggests filter keys for a partial key", () => {
    const query = "na";
    const rows = suggestSearch({ query, cursor: query.length, catalog });
    assert.ok(rows.some((row) => row.insertText === "name:"));
    assert.ok(rows.every((row) => row.kind === "key"));
  });

  it("suggests catalog names for a partial name value", () => {
    const query = "name:che";
    const rows = suggestSearch({ query, cursor: query.length, catalog });
    assert.ok(rows.some((row) => row.label === "checkout-api"));
    assert.ok(rows.every((row) => row.kind === "value"));
  });

  it("quotes values that need quoting", () => {
    const query = "fieldValue:gol";
    const rows = suggestSearch({ query, cursor: query.length, catalog });
    const hit = rows.find((row) => row.label === "gold lane");
    assert.ok(hit);
    assert.equal(hit.insertText, '"gold lane"');
  });

  it("suggests operators for number keys", () => {
    const query = "warnAlerts:";
    const rows = suggestSearch({ query, cursor: query.length, catalog });
    assert.ok(rows.some((row) => row.insertText === ">="));
    assert.ok(rows.every((row) => row.kind === "operator"));
  });

  it("applySuggestion replaces the partial token", () => {
    const query = "name:che";
    const rows = suggestSearch({ query, cursor: query.length, catalog });
    const hit = rows.find((row) => row.label === "checkout-api");
    assert.ok(hit);
    const applied = applySuggestion(query, hit);
    assert.equal(applied.query, "name:checkout-api");
    assert.equal(applied.cursor, "name:checkout-api".length);
  });
});
