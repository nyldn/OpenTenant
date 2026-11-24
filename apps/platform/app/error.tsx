"use client";

import React from "react";

/** Never render the thrown error, its digest, request data, or provider response. */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert">
      <h1>Something went wrong</h1>
      <p>Please try again. If the problem continues, contact your administrator.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
