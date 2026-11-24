import { expect, it } from "vitest";
import { lifecycleTransition } from "./tenant-lifecycle-policy";

it.each(["active", "suspended"])("cancels deletion back to %s only during retention", priorStatus => {
  expect(lifecycleTransition("deleted", "cancel_delete", new Date(0), 0, { priorStatus, eraseAfter: new Date(1000), erasureStarted: false })).toEqual({ status: priorStatus });
});
it.each([
  { priorStatus: "active", eraseAfter: new Date(1000), erasureStarted: true },
  { priorStatus: "active", eraseAfter: new Date(0), erasureStarted: false },
  { priorStatus: "provisioning", eraseAfter: new Date(1000), erasureStarted: false },
  { priorStatus: undefined, eraseAfter: new Date(1000), erasureStarted: false },
  { priorStatus: "suspended", eraseAfter: null, erasureStarted: false },
])("rejects unsafe cancellation %j", checkpoint => {
  expect(() => lifecycleTransition("deleted", "cancel_delete", new Date(0), 0, checkpoint)).toThrow();
});
