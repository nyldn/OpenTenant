// SPDX-License-Identifier: Apache-2.0
export type * from "./port";
export { InProcessAuthorization } from "./adapters/in-process";
export { syncMembership, syncEntitlement } from "./sync";
export { failClosed } from "./policy";
export { createAuthorization } from "./provider";
