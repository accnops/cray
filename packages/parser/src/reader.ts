export async function* readJsonlLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<unknown, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            yield JSON.parse(buffer);
          } catch {
            // Skip malformed line
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch {
            // Skip malformed line
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
