/**
 * Type definitions for the MCP client extension
 */

export interface MCPServerConfig {
	/** Unique identifier for this server connection */
	id: string;
	/** Human-readable name */
	name: string;
	/** Server type: 'http' for remote, 'stdio' for local subprocess */
	type: "http" | "stdio";
	/** For http: the URL (e.g., https://mcp.exa.ai/mcp) */
	url?: string;
	/** For stdio: the command to run (e.g., 'npx') */
	command?: string;
	/** For stdio: command arguments (e.g., ['-y', 'exa-mcp-server']) */
	args?: string[];
	/** Environment variables for stdio subprocess */
	env?: Record<string, string>;
	/** Optional list of tool names to register (if not specified, all tools are registered) */
	tools?: string[];
	/** Whether to connect automatically on extension load */
	autoConnect?: boolean;
	/** Optional headers for HTTP transport */
	headers?: Record<string, string>;
}

export interface MCPConfig {
	/** List of MCP server configurations */
	servers: MCPServerConfig[];
}

export interface ConnectedServer {
	config: MCPServerConfig;
	client: any; // MCP Client instance
	transport: any; // Transport instance
	tools: MCPTool[];
	registeredToolNames: string[];
}

export interface MCPTool {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface MCPToolCallResult {
	content: Array<{
		type: "text" | "image" | "resource";
		text?: string;
		data?: string;
		mimeType?: string;
	}>;
	isError?: boolean;
}
