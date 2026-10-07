import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "./app.error.js";

export function toToolError(error: unknown): CallToolResult {
  let text: string;
  if (error instanceof AppError) {
    text = error.message;
  } else if (error instanceof Error && error.name === "AbortError") {
    text = "Reports API request timed out.";
  } else if (error instanceof Error) {
    text = `Unexpected error: ${error.message}`;
  } else {
    text = `Unexpected error: ${String(error)}`;
  }
  return { isError: true, content: [{ type: "text", text }] };
}

export function toToolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
