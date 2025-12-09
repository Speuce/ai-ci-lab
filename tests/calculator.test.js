import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/calculator.js";

test("add adds two numbers", () => {
  assert.equal(add(2, 3), 5);
});