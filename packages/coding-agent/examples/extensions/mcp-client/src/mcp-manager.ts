/**
 * MCP Manager - Handles connections to MCP servers
 *
 * Supports both HTTP (remote) and stdio (local subprocess) transports.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ConnectedServer, MCPServerConfig, MCPTool, MCPToolCallResult } from "./types.js";

export class MCPManager {
	private servers: Map<string, ConnectedServer> = new Map();
	private onToolsChanged?: () => void;

	constructor(options?: { onToolsChanged?: () => void }) {
		this.onToolsChanged = options?.onToolsChanged;
	}

	/**
	 * Connect to an MCP server
	 */
	async connect(config: MCPServerConfig): Promise<ConnectedServer> {
		// Disconnect existing connection with same ID
		if (this.servers.has(config.id)) {
			await this.disconnect(config.id);
		}

		const client = new Client(
			{
				name: "pi-mcp-client",
				version: "1.0.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		let transport: SSEClientTransport | StdioClientTransport;

		if (config.type === "http") {
			if (!config.url) {
				throw new Error(`HTTP server ${config.id} requires a URL`);
			}
			transport = new SSEClientTransport(new URL(config.url), {
				requestInit: config.headers
					? {
							headers: config.headers,
						}
					: undefined,
			});
		} else if (config.type === "stdio") {
			if (!config.command) {
				throw new Error(`Stdio server ${config.id} requires a command`);
			}
			transport = new StdioClientTransport({
				command: config.command,
				args: config.args || [],
				env: config.env ? { ...process.env, ...config.env } : undefined,
			});
		} else {
			throw new Error(`Unknown transport type: ${config.type}`);
		}

		await client.connect(transport);

		// Discover available tools
		const toolsResponse = await client.listTools();
		const allTools: MCPTool[] = toolsResponse.tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema as Record<string, unknown>,
		}));

		// Filter tools based on allowlist and denylist
		let tools = allTools;

		// Apply allowlist first (if specified, only these tools pass through)
		if (config.allowedTools && config.allowedTools.length > 0) {
			const allowedSet = new Set(config.allowedTools);
			tools = tools.filter((t) => allowedSet.has(t.name));
		}

		// Apply denylist second (remove any denied tools)
		if (config.deniedTools && config.deniedTools.length > 0) {
			const deniedSet = new Set(config.deniedTools);
			tools = tools.filter((t) => !deniedSet.has(t.name));
		}

		const connectedServer: ConnectedServer = {
			config,
			client,
			transport,
			tools,
			registeredToolNames: [],
		};

		this.servers.set(config.id, connectedServer);
		this.onToolsChanged?.();

		return connectedServer;
	}

	/**
	 * Disconnect from an MCP server
	 */
	async disconnect(serverId: string): Promise<void> {
		const server = this.servers.get(serverId);
		if (!server) return;

		try {
			await server.client.close();
		} catch {
			// Ignore close errors
		}

		this.servers.delete(serverId);
		this.onToolsChanged?.();
	}

	/**
	 * Disconnect from all servers
	 */
	async disconnectAll(): Promise<void> {
		const ids = Array.from(this.servers.keys());
		await Promise.all(ids.map((id) => this.disconnect(id)));
	}

	/**
	 * Call a tool on an MCP server
	 */
	async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
		const server = this.servers.get(serverId);
		if (!server) {
			throw new Error(`Server ${serverId} not connected`);
		}

		const result = await server.client.callTool({
			name: toolName,
			arguments: args,
		});

		return {
			content: (result.content as MCPToolCallResult["content"]) || [],
			isError: result.isError,
		};
	}

	/**
	 * Get a connected server by ID
	 */
	getServer(serverId: string): ConnectedServer | undefined {
		return this.servers.get(serverId);
	}

	/**
	 * Get all connected servers
	 */
	getServers(): ConnectedServer[] {
		return Array.from(this.servers.values());
	}

	/**
	 * Find which server provides a specific tool
	 */
	findServerForTool(toolName: string): ConnectedServer | undefined {
		for (const server of this.servers.values()) {
			if (server.registeredToolNames.includes(toolName)) {
				return server;
			}
		}
		return undefined;
	}

	/**
	 * Check if a server is connected
	 */
	isConnected(serverId: string): boolean {
		return this.servers.has(serverId);
	}

	/**
	 * Get all available tools across all connected servers
	 */
	getAllTools(): Array<{ server: ConnectedServer; tool: MCPTool }> {
		const result: Array<{ server: ConnectedServer; tool: MCPTool }> = [];
		for (const server of this.servers.values()) {
			for (const tool of server.tools) {
				result.push({ server, tool });
			}
		}
		return result;
	}
}
