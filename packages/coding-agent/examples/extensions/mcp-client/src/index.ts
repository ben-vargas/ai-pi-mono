/**
 * MCP Client Extension for Pi
 *
 * Enables integration with any MCP (Model Context Protocol) server.
 * Supports both HTTP (remote) and stdio (local subprocess) transports.
 *
 * Usage:
 *   1. Create ~/.pi/mcp-servers.json with your server configurations
 *   2. Use /mcp command to manage connections
 *   3. Connected server tools become available to the LLM
 *
 * Example config (~/.pi/mcp-servers.json):
 * {
 *   "servers": [
 *     {
 *       "id": "exa",
 *       "name": "Exa Search",
 *       "type": "http",
 *       "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,get_code_context_exa",
 *       "autoConnect": true
 *     }
 *   ]
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MCPManager } from "./mcp-manager.js";
import { jsonSchemaToTypebox } from "./schema-converter.js";
import type { MCPConfig, MCPServerConfig, MCPTool } from "./types.js";

const CONFIG_PATHS = [
	join(homedir(), ".pi", "mcp-servers.json"),
	join(process.cwd(), ".pi", "mcp-servers.json"),
];

export default function (pi: ExtensionAPI) {
	const manager = new MCPManager({
		onToolsChanged: () => {
			// Could update active tools here if needed
		},
	});

	// Track registered tool names to avoid duplicates
	const registeredTools = new Set<string>();

	/**
	 * Register an MCP tool with pi
	 */
	function registerMCPTool(serverId: string, tool: MCPTool) {
		// Prefix tool name to avoid collisions (e.g., "exa:web_search_exa")
		const toolName = `mcp_${serverId}_${tool.name}`;

		if (registeredTools.has(toolName)) {
			return toolName;
		}

		const schema = jsonSchemaToTypebox(tool.inputSchema as any);

		pi.registerTool({
			name: toolName,
			label: `${tool.name} (MCP)`,
			description: tool.description || `MCP tool from ${serverId}`,
			parameters: schema,

			async execute(_toolCallId, params, onUpdate, _ctx, signal) {
				onUpdate?.({ status: "Calling MCP server..." });

				try {
					const result = await manager.callTool(serverId, tool.name, params as Record<string, unknown>);

					// Convert MCP result to pi format
					const textContent = result.content
						.filter((c) => c.type === "text")
						.map((c) => c.text || "")
						.join("\n");

					return {
						content: [{ type: "text", text: textContent || "(empty response)" }],
						details: {
							serverId,
							toolName: tool.name,
							isError: result.isError,
						},
						isError: result.isError,
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `MCP tool error: ${message}` }],
						details: { serverId, toolName: tool.name, error: message },
						isError: true,
					};
				}
			},

			renderCall(args, theme) {
				const argsStr = Object.entries(args)
					.slice(0, 2)
					.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
					.join(", ");
				return new Text(
					theme.fg("toolTitle", theme.bold(`${tool.name} `)) +
						theme.fg("muted", `(mcp:${serverId}) `) +
						theme.fg("accent", argsStr.substring(0, 50) + (argsStr.length > 50 ? "..." : "")),
					0,
					0,
				);
			},

			renderResult(result, { expanded }, theme) {
				const details = result.details as any;
				if (result.isError) {
					return new Text(theme.fg("error", `Error: ${details?.error || "unknown"}`), 0, 0);
				}

				const content = result.content[0];
				if (content?.type === "text") {
					const lines = content.text.split("\n");
					const preview = lines[0]?.substring(0, 60) || "(empty)";
					let text = theme.fg("success", preview);
					if (lines.length > 1) {
						text += theme.fg("muted", ` (+${lines.length - 1} lines)`);
					}
					return new Text(text, 0, 0);
				}

				return new Text(theme.fg("dim", "(no text content)"), 0, 0);
			},
		});

		registeredTools.add(toolName);

		// Track which tools are registered for this server
		const server = manager.getServer(serverId);
		if (server) {
			server.registeredToolNames.push(toolName);
		}

		return toolName;
	}

	/**
	 * Connect to a server and register its tools
	 */
	async function connectServer(config: MCPServerConfig, ctx: { ui: { notify: (msg: string, type?: string) => void } }) {
		try {
			ctx.ui.notify(`Connecting to ${config.name || config.id}...`, "info");
			const server = await manager.connect(config);

			// Register all tools from this server
			for (const tool of server.tools) {
				registerMCPTool(config.id, tool);
			}

			ctx.ui.notify(`Connected to ${config.name || config.id} (${server.tools.length} tools)`, "info");
			return server;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Failed to connect to ${config.name || config.id}: ${message}`, "error");
			throw error;
		}
	}

	/**
	 * Load configuration from file
	 */
	function loadConfig(): MCPConfig | null {
		for (const configPath of CONFIG_PATHS) {
			if (existsSync(configPath)) {
				try {
					const content = readFileSync(configPath, "utf-8");
					return JSON.parse(content) as MCPConfig;
				} catch (error) {
					console.error(`Error loading MCP config from ${configPath}:`, error);
				}
			}
		}
		return null;
	}

	// ==========================================================================
	// Commands
	// ==========================================================================

	pi.registerCommand("mcp", {
		description: "Manage MCP server connections",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "status";

			switch (subcommand) {
				case "status": {
					const servers = manager.getServers();
					if (servers.length === 0) {
						ctx.ui.notify("No MCP servers connected. Use /mcp connect <id> or /mcp list", "info");
					} else {
						const lines = servers.map(
							(s) => `  ${s.config.id}: ${s.config.name || s.config.url || s.config.command} (${s.tools.length} tools)`,
						);
						ctx.ui.notify(`Connected MCP servers:\n${lines.join("\n")}`, "info");
					}
					break;
				}

				case "list": {
					const config = loadConfig();
					if (!config || config.servers.length === 0) {
						ctx.ui.notify(
							`No servers configured. Create ${CONFIG_PATHS[0]} with your server definitions.`,
							"warning",
						);
					} else {
						const lines = config.servers.map((s) => {
							const connected = manager.isConnected(s.id) ? " [connected]" : "";
							return `  ${s.id}: ${s.name || s.type}${connected}`;
						});
						ctx.ui.notify(`Available MCP servers:\n${lines.join("\n")}`, "info");
					}
					break;
				}

				case "connect": {
					const serverId = parts[1];
					if (!serverId) {
						// Show available servers to connect
						const config = loadConfig();
						if (!config || config.servers.length === 0) {
							ctx.ui.notify("No servers configured. Create ~/.pi/mcp-servers.json", "warning");
						} else {
							const options = config.servers.map((s) => `${s.id} - ${s.name || s.type}`);
							const selected = await ctx.ui.select("Select MCP server to connect:", options);
							if (selected) {
								const selectedId = selected.split(" - ")[0];
								const serverConfig = config.servers.find((s) => s.id === selectedId);
								if (serverConfig) {
									await connectServer(serverConfig, ctx);
								}
							}
						}
					} else {
						const config = loadConfig();
						const serverConfig = config?.servers.find((s) => s.id === serverId);
						if (!serverConfig) {
							ctx.ui.notify(`Server '${serverId}' not found in configuration`, "error");
						} else {
							await connectServer(serverConfig, ctx);
						}
					}
					break;
				}

				case "disconnect": {
					const serverId = parts[1];
					if (!serverId) {
						const servers = manager.getServers();
						if (servers.length === 0) {
							ctx.ui.notify("No servers connected", "info");
						} else {
							const options = servers.map((s) => s.config.id);
							const selected = await ctx.ui.select("Select server to disconnect:", options);
							if (selected) {
								await manager.disconnect(selected);
								ctx.ui.notify(`Disconnected from ${selected}`, "info");
							}
						}
					} else {
						await manager.disconnect(serverId);
						ctx.ui.notify(`Disconnected from ${serverId}`, "info");
					}
					break;
				}

				case "tools": {
					const allTools = manager.getAllTools();
					if (allTools.length === 0) {
						ctx.ui.notify("No tools available. Connect to an MCP server first.", "info");
					} else {
						const lines = allTools.map(({ server, tool }) => `  mcp_${server.config.id}_${tool.name}: ${tool.description?.substring(0, 60) || "(no description)"}`);
						ctx.ui.notify(`Available MCP tools:\n${lines.join("\n")}`, "info");
					}
					break;
				}

				case "help":
				default: {
					ctx.ui.notify(
						`MCP Commands:
  /mcp status     - Show connected servers
  /mcp list       - List configured servers
  /mcp connect    - Connect to a server
  /mcp disconnect - Disconnect from a server
  /mcp tools      - List available tools`,
						"info",
					);
					break;
				}
			}
		},
	});

	// ==========================================================================
	// Auto-connect on session start
	// ==========================================================================

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig();
		if (!config) return;

		// Connect to servers marked with autoConnect
		for (const serverConfig of config.servers) {
			if (serverConfig.autoConnect) {
				try {
					await connectServer(serverConfig, ctx);
				} catch {
					// Error already logged in connectServer
				}
			}
		}
	});

	// ==========================================================================
	// Cleanup on shutdown
	// ==========================================================================

	pi.on("session_shutdown", async () => {
		await manager.disconnectAll();
	});
}
