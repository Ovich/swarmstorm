import { test } from "node:test";
import assert from "node:assert/strict";
import { pointerHash, readPointer, unknownNames } from "../src/prototype/pointer.ts";

test("a pointer is the viewer's hash, and reads back as itself", () => {
  const p = { id: 12, components: ["ApplicationStrip", "MenuSquare"], variant: "step-2" };
  assert.equal(pointerHash(p), "doc=12&show=ApplicationStrip,MenuSquare&variant=step-2");
  assert.deepEqual(readPointer(`#${pointerHash(p)}`), p);
});

test("a document alone is a pointer at nothing, so the old links keep working", () => {
  assert.equal(pointerHash({ id: 3, components: [] }), "doc=3");
  assert.deepEqual(readPointer("#doc=3"), { id: 3, components: [] });
});

test("a hash is typed and pasted by people: what is malformed is dropped, never thrown", () => {
  assert.equal(readPointer(""), null);
  assert.equal(readPointer("#doc=abc"), null);
  assert.deepEqual(readPointer('#doc=4&show=Ok,"]x[,&variant=a b&other=1'), { id: 4, components: ["Ok"] });
});

test("a name the prototype does not have is answered with the names it has", () => {
  assert.equal(unknownNames(["Pill"], ["Pill", "Dock"], "component"), undefined);
  assert.equal(
    unknownNames(["ShellMiddle", "Pill"], ["Pill", "Dock"], "component"),
    "no component named ShellMiddle in this prototype; it has: Pill, Dock",
  );
  assert.equal(unknownNames(["step-2"], [], "variant"), "no variant named step-2 in this prototype; it declares none");
});
