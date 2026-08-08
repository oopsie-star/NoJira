// A ToolError is a business-level failure ("task not found", "invalid
// status") that should surface to the model as a normal tool result with
// isError: true, not as a JSON-RPC transport error — see rpc.ts.
export class ToolError extends Error {}
