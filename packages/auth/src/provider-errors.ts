/** Discard provider messages, metadata and causes at the injected port boundary. */
export function secretFreeIdentityPort<T extends object>(port: T): T {
  return new Proxy(port, {
    get(target, key, receiver) {
      const operation = Reflect.get(target, key, receiver);
      if (typeof operation !== "function") return operation;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(operation, target, args);
        } catch {
          throw new Error("Identity provider operation failed");
        }
      };
    },
  });
}
