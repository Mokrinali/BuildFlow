"use client";

// Replaces the root layout when it fails, so it must render <html> and <body> itself.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ka">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#F5F7FA",
          color: "#092648",
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 16,
        }}
      >
        <div>
          <h1>რაღაც შეცდომა მოხდა</h1>
          <p>სისტემა დროებით მიუწვდომელია. სცადეთ თავიდან.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#FF7900",
              color: "#092648",
              border: 0,
              borderRadius: 6,
              padding: "10px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            თავიდან ცდა
          </button>
        </div>
      </body>
    </html>
  );
}
